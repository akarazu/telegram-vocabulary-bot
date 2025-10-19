// services/batch-sheets-service.js
import { GoogleSheetsService } from './google-sheets.js';

export class BatchSheetsService {
    constructor(sheetsService) {
        this.sheetsService = sheetsService;
        this.batchQueue = new Map();
        this.batchTimeout = null;
        
        // Оптимизация: настройки батчинга
        this.BATCH_DELAY = 15000; // 15 секунд для большего накопления
        this.MAX_BATCH_SIZE = 25; // Увеличено для эффективности
        this.MIN_BATCH_SIZE = 5;  // Минимальный размер для отправки
        this.MAX_QUEUE_SIZE = 1000; // Максимальный размер очереди
        
        // Оптимизация: статистика
        this.stats = {
            totalBatches: 0,
            totalUpdates: 0,
            successfulUpdates: 0,
            failedUpdates: 0,
            queueOverflows: 0,
            lastBatchSize: 0
        };

        // Оптимизация: обработка ошибок
        this.retryQueue = new Map();
        this.maxRetries = 3;
        
        // Оптимизация: мониторинг
        this.lastProcessed = Date.now();
        
        console.log('🔧 BatchSheetsService initialized with optimizations');
        
        // Запускаем периодическую обработку
        this.startPeriodicProcessing();
    }
    
    // ✅ ОСНОВНАЯ ФУНКЦИЯ: Добавление в батч-очередь
    async updateWordReviewBatch(chatId, english, interval, nextReview, lastReview) {
        const key = `${chatId}_${english.toLowerCase()}`;
        
        // Проверяем размер очереди
        if (this.getTotalQueueSize() >= this.MAX_QUEUE_SIZE) {
            this.stats.queueOverflows++;
            console.log(`🚫 Batch queue overflow, processing immediately`);
            await this.processAllBatches();
        }
        
        if (!this.batchQueue.has(chatId)) {
            this.batchQueue.set(chatId, new Map());
        }
        
        const userBatch = this.batchQueue.get(chatId);
        userBatch.set(english, { 
            interval, 
            nextReview, 
            lastReview,
            timestamp: Date.now(),
            retryCount: 0
        });
        
        this.stats.totalUpdates++;
        
        console.log(`📦 Added to batch: "${english}" for user ${chatId}. Queue size: ${userBatch.size}`);
        
        // Принудительно обрабатываем если накопилось много изменений
        if (userBatch.size >= this.MAX_BATCH_SIZE) {
            console.log(`🚨 Batch size limit reached for user ${chatId}, processing immediately`);
            await this.processUserBatch(chatId);
            return true;
        }
        
        // Запускаем таймер если его нет
        if (!this.batchTimeout) {
            this.batchTimeout = setTimeout(() => {
                this.processAllBatches().catch(console.error);
            }, this.BATCH_DELAY);
        }
        
        return true;
    }
    
    // ✅ ОБРАБОТКА ВСЕХ БАТЧЕЙ
    async processAllBatches() {
        if (this.batchTimeout) {
            clearTimeout(this.batchTimeout);
            this.batchTimeout = null;
        }
        
        const startTime = Date.now();
        console.log(`🔄 Processing all batches...`);
        
        let totalProcessed = 0;
        const userCount = this.batchQueue.size;
        
        // Обрабатываем пользователей параллельно с ограничением
        const users = Array.from(this.batchQueue.keys());
        const BATCH_CONCURRENCY = 3; // Ограничиваем параллелизм
        
        for (let i = 0; i < users.length; i += BATCH_CONCURRENCY) {
            const userBatch = users.slice(i, i + BATCH_CONCURRENCY);
            const promises = userBatch.map(chatId => this.processUserBatch(chatId));
            
            const results = await Promise.allSettled(promises);
            totalProcessed += results.filter(r => r.status === 'fulfilled').length;
            
            // Небольшая задержка между группами пользователей
            if (i + BATCH_CONCURRENCY < users.length) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        
        // Обрабатываем очередь повторных попыток
        await this.processRetryQueue();
        
        const processingTime = Date.now() - startTime;
        this.lastProcessed = Date.now();
        
        console.log(`✅ Batch processing completed: ${totalProcessed}/${userCount} users, ` +
                   `${this.stats.lastBatchSize} updates, ${processingTime}ms`);
        
        this.stats.totalBatches++;
    }
    
    // ✅ ОБРАБОТКА БАТЧА ПОЛЬЗОВАТЕЛЯ
    async processUserBatch(chatId) {
        const userBatch = this.batchQueue.get(chatId);
        if (!userBatch || userBatch.size === 0) {
            this.batchQueue.delete(chatId);
            return true;
        }
        
        try {
            console.log(`👤 Processing batch for user ${chatId}: ${userBatch.size} words`);
            
            // Преобразуем в формат для массового обновления
            const wordUpdates = Array.from(userBatch.entries());
            
            // Отправляем массовое обновление
            const success = await this.sheetsService.batchUpdateWords(chatId, wordUpdates);
            
            if (success) {
                this.stats.successfulUpdates += userBatch.size;
                this.stats.lastBatchSize = userBatch.size;
                
                console.log(`✅ User ${chatId} batch successful: ${userBatch.size} words`);
                
                // Очищаем успешно обработанный батч
                this.batchQueue.delete(chatId);
                return true;
            } else {
                throw new Error('Batch update failed');
            }
            
        } catch (error) {
            console.error(`❌ User ${chatId} batch failed:`, error.message);
            await this.handleBatchFailure(chatId, userBatch, error);
            return false;
        }
    }
    
    // ✅ ОБРАБОТКА НЕУДАЧНЫХ БАТЧЕЙ
    async handleBatchFailure(chatId, userBatch, error) {
        const failedUpdates = Array.from(userBatch.entries());
        
        for (const [english, data] of failedUpdates) {
            const key = `${chatId}_${english}`;
            
            if (data.retryCount < this.maxRetries) {
                // Добавляем в очередь повторных попыток
                if (!this.retryQueue.has(chatId)) {
                    this.retryQueue.set(chatId, new Map());
                }
                
                const retryData = {
                    ...data,
                    retryCount: data.retryCount + 1,
                    lastError: error.message,
                    nextRetry: Date.now() + (Math.pow(2, data.retryCount) * 5000) // Экспоненциальная задержка
                };
                
                this.retryQueue.get(chatId).set(english, retryData);
                console.log(`🔄 Queued for retry: "${english}" (attempt ${retryData.retryCount})`);
            } else {
                // Превышен лимит повторных попыток
                this.stats.failedUpdates++;
                console.error(`💥 Max retries exceeded for: "${english}"`);
                
                // Можно добавить логику для уведомления администратора
                this.notifyAdminAboutFailure(chatId, english, error);
            }
        }
        
        // Очищаем основной батч даже при ошибке
        this.batchQueue.delete(chatId);
    }
    
    // ✅ ОБРАБОТКА ОЧЕРЕДИ ПОВТОРНЫХ ПОПЫТОК
    async processRetryQueue() {
        if (this.retryQueue.size === 0) return;
        
        console.log(`🔄 Processing retry queue: ${this.retryQueue.size} users`);
        
        const now = Date.now();
        let retryCount = 0;
        
        for (const [chatId, retryBatch] of this.retryQueue.entries()) {
            const readyForRetry = Array.from(retryBatch.entries())
                .filter(([english, data]) => data.nextRetry <= now);
            
            if (readyForRetry.length > 0) {
                console.log(`🔄 Retrying ${readyForRetry.length} words for user ${chatId}`);
                
                // Возвращаем в основную очередь
                if (!this.batchQueue.has(chatId)) {
                    this.batchQueue.set(chatId, new Map());
                }
                
                const userBatch = this.batchQueue.get(chatId);
                
                for (const [english, data] of readyForRetry) {
                    userBatch.set(english, data);
                    retryBatch.delete(english);
                    retryCount++;
                }
                
                // Если все слова пользователя обработаны, удаляем из очереди повторных попыток
                if (retryBatch.size === 0) {
                    this.retryQueue.delete(chatId);
                }
            }
        }
        
        if (retryCount > 0) {
            console.log(`✅ Retry queue processed: ${retryCount} words moved back to main queue`);
        }
    }
    
    // ✅ ПРИНУДИТЕЛЬНАЯ ОБРАБОТКА ВСЕХ ОЖИДАЮЩИХ БАТЧЕЙ
    async flushAll() {
        console.log(`🚀 Flushing all batches...`);
        
        if (this.batchTimeout) {
            clearTimeout(this.batchTimeout);
            this.batchTimeout = null;
        }
        
        await this.processAllBatches();
        console.log(`✅ All batches flushed successfully`);
    }
    
    // ✅ ПЕРИОДИЧЕСКАЯ ОБРАБОТКА (на случай зависших батчей)
    startPeriodicProcessing() {
        // Каждые 5 минут проверяем и обрабатываем старые батчи
        setInterval(() => {
            const now = Date.now();
            const STALE_THRESHOLD = 2 * 60 * 1000; // 2 минуты
            
            // Проверяем основные батчи
            let staleBatches = 0;
            for (const [chatId, userBatch] of this.batchQueue.entries()) {
                const oldestUpdate = Math.min(...Array.from(userBatch.values()).map(d => d.timestamp));
                if (now - oldestUpdate > STALE_THRESHOLD) {
                    staleBatches++;
                    console.log(`⏰ Processing stale batch for user ${chatId}`);
                    this.processUserBatch(chatId).catch(console.error);
                }
            }
            
            // Проверяем очередь повторных попыток
            for (const [chatId, retryBatch] of this.retryQueue.entries()) {
                const readyForRetry = Array.from(retryBatch.entries())
                    .filter(([english, data]) => data.nextRetry <= now);
                
                if (readyForRetry.length > 0) {
                    console.log(`⏰ Processing stale retry batch for user ${chatId}`);
                    this.processRetryQueue().catch(console.error);
                }
            }
            
            if (staleBatches > 0) {
                console.log(`🕒 Processed ${staleBatches} stale batches`);
            }
            
            // Логируем статистику раз в 10 минут
            if (Math.random() < 0.1) {
                this.logStats();
            }
            
        }, 30 * 1000); // Проверяем каждые 30 секунд
    }
    
    // ✅ СТАТИСТИКА И МОНИТОРИНГ
    getStats() {
        const successRate = this.stats.totalUpdates > 0 
            ? (this.stats.successfulUpdates / this.stats.totalUpdates * 100).toFixed(1)
            : 0;
            
        return {
            ...this.stats,
            successRate: `${successRate}%`,
            currentQueueSize: this.getTotalQueueSize(),
            currentUsersInQueue: this.batchQueue.size,
            currentRetryQueueSize: this.getTotalRetryQueueSize(),
            lastProcessed: new Date(this.lastProcessed).toISOString(),
            settings: {
                batchDelay: this.BATCH_DELAY,
                maxBatchSize: this.MAX_BATCH_SIZE,
                maxQueueSize: this.MAX_QUEUE_SIZE,
                maxRetries: this.maxRetries
            }
        };
    }
    
    logStats() {
        const stats = this.getStats();
        console.log(`📊 Batch Stats - Total: ${stats.totalBatches}, ` +
                   `Success: ${stats.successfulUpdates}/${stats.totalUpdates} (${stats.successRate}), ` +
                   `Queue: ${stats.currentQueueSize}, Retry: ${stats.currentRetryQueueSize}`);
    }
    
    // ✅ ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ
    getTotalQueueSize() {
        let total = 0;
        for (const userBatch of this.batchQueue.values()) {
            total += userBatch.size;
        }
        return total;
    }
    
    getTotalRetryQueueSize() {
        let total = 0;
        for (const retryBatch of this.retryQueue.values()) {
            total += retryBatch.size;
        }
        return total;
    }
    
    // ✅ УВЕДОМЛЕНИЕ АДМИНИСТРАТОРА О СБОЯХ
    notifyAdminAboutFailure(chatId, english, error) {
        // Здесь можно добавить интеграцию с Telegram для уведомления админа
        // или логирование в специальный канал
        console.error(`🚨 CRITICAL: Failed to update word "${english}" for user ${chatId}:`, error.message);
        
        // Пример интеграции с Telegram (раскомментировать при необходимости)
        /*
        if (process.env.ADMIN_CHAT_ID) {
            const message = `🚨 Batch Update Failed\nUser: ${chatId}\nWord: ${english}\nError: ${error.message}`;
            // await bot.sendMessage(process.env.ADMIN_CHAT_ID, message);
        }
        */
    }
    
    // ✅ ОЧИСТКА ОЧЕРЕДЕЙ (для тестирования)
    clearAllQueues() {
        const mainQueueSize = this.getTotalQueueSize();
        const retryQueueSize = this.getTotalRetryQueueSize();
        
        this.batchQueue.clear();
        this.retryQueue.clear();
        
        if (this.batchTimeout) {
            clearTimeout(this.batchTimeout);
            this.batchTimeout = null;
        }
        
        console.log(`🧹 Queues cleared: ${mainQueueSize} main, ${retryQueueSize} retry`);
        
        return {
            mainQueueCleared: mainQueueSize,
            retryQueueCleared: retryQueueSize
        };
    }
    
    // ✅ ПРОВЕРКА СОСТОЯНИЯ СЕРВИСА
    healthCheck() {
        const queueSize = this.getTotalQueueSize();
        const retrySize = this.getTotalRetryQueueSize();
        const timeSinceLastProcess = Date.now() - this.lastProcessed;
        
        const status = queueSize < this.MAX_QUEUE_SIZE * 0.8 ? 'healthy' : 'warning';
        
        return {
            status,
            queueSize,
            retryQueueSize: retrySize,
            usersInQueue: this.batchQueue.size,
            timeSinceLastProcess: `${Math.round(timeSinceLastProcess / 1000)}s`,
            stats: this.getStats()
        };
    }
    
    // ✅ ИЗМЕНЕНИЕ НАСТРОЕК В РАНТАЙМЕ
    updateSettings(newSettings) {
        if (newSettings.batchDelay !== undefined) {
            this.BATCH_DELAY = Math.max(5000, newSettings.batchDelay);
        }
        if (newSettings.maxBatchSize !== undefined) {
            this.MAX_BATCH_SIZE = Math.max(1, newSettings.maxBatchSize);
        }
        if (newSettings.maxQueueSize !== undefined) {
            this.MAX_QUEUE_SIZE = Math.max(10, newSettings.maxQueueSize);
        }
        if (newSettings.maxRetries !== undefined) {
            this.maxRetries = Math.max(0, newSettings.maxRetries);
        }
        
        console.log(`⚙️ Batch settings updated:`, {
            batchDelay: this.BATCH_DELAY,
            maxBatchSize: this.MAX_BATCH_SIZE,
            maxQueueSize: this.MAX_QUEUE_SIZE,
            maxRetries: this.maxRetries
        });
        
        return this.getStats().settings;
    }
    
    // ✅ GRACEFUL SHUTDOWN
    async shutdown() {
        console.log('🔄 BatchSheetsService shutting down...');
        
        // Останавливаем таймер
        if (this.batchTimeout) {
            clearTimeout(this.batchTimeout);
            this.batchTimeout = null;
        }
        
        // Обрабатываем все оставшиеся батчи
        await this.flushAll();
        
        // Логируем финальную статистику
        this.logStats();
        
        console.log('✅ BatchSheetsService shutdown completed');
    }
}

// Создаем глобальный экземпляр
let batchServiceInstance = null;

export function getBatchSheetsService(sheetsService) {
    if (!batchServiceInstance) {
        if (!sheetsService) {
            throw new Error('GoogleSheetsService is required for BatchSheetsService');
        }
        batchServiceInstance = new BatchSheetsService(sheetsService);
    }
    
    return batchServiceInstance;
}

// Graceful shutdown
process.on('SIGINT', async () => {
    if (batchServiceInstance) {
        await batchServiceInstance.shutdown();
    }
    process.exit(0);
});

process.on('SIGTERM', async () => {
    if (batchServiceInstance) {
        await batchServiceInstance.shutdown();
    }
    process.exit(0);
});
