// services/yandex-dictionary-service.js
import axios from 'axios';

export class YandexDictionaryService {
    constructor() {
        this.useYandex = !!process.env.YANDEX_DICTIONARY_API_KEY;
        
        // Оптимизация: кеширование результатов
        this.cache = new Map();
        this.CACHE_TTL = 24 * 60 * 60 * 1000; // 24 часа для транскрипций
        
        // Оптимизация: ограничение параллельных запросов
        this.concurrentRequests = 0;
        this.maxConcurrentRequests = 3;
        
        // Оптимизация: настройки HTTP клиента
        this.http = axios.create({
            timeout: 8000, // Уменьшено с 10 до 8 секунд
            retry: 1,
            retryDelay: 1000
        });

        // Оптимизация: черный список проблемных слов
        this.problemWords = new Set();
        
        // Оптимизация: статистика использования
        this.stats = {
            totalRequests: 0,
            cacheHits: 0,
            apiHits: 0,
            errors: 0
        };

        // Оптимизация: fallback транскрипции для частых слов
        this.commonWordsTranscriptions = new Map([
            ['hello', '/həˈləʊ/'],
            ['world', '/wɜːld/'],
            ['time', '/taɪm/'],
            ['people', '/ˈpiːp(ə)l/'],
            ['water', '/ˈwɔːtə/'],
            ['food', '/fuːd/'],
            ['house', '/haʊs/'],
            ['work', '/wɜːk/'],
            ['school', '/skuːl/'],
            ['book', '/bʊk/'],
            ['friend', '/frend/'],
            ['family', '/ˈfæm(ə)li/'],
            ['music', '/ˈmjuːzɪk/'],
            ['love', '/lʌv/'],
            ['english', '/ˈɪŋɡlɪʃ/'],
            ['russian', '/ˈrʌʃ(ə)n/'],
            ['dictionary', '/ˈdɪkʃ(ə)n(ə)ri/'],
            ['word', '/wɜːd/'],
            ['learn', '/lɜːn/'],
            ['study', '/ˈstʌdi/']
        ]);

        console.log(`🔧 [Yandex] Initialized: ${this.useYandex ? 'API ENABLED' : 'API DISABLED'}`);
        
        // Запускаем очистку кеша
        this.startCacheCleanup();
    }

    // Оптимизация: кеширование с приоритетом common words
    async getCachedTranscriptionAndAudio(word) {
        const lowerWord = word.toLowerCase().trim();
        const cacheKey = `yandex_${lowerWord}`;
        
        // Сначала проверяем кеш
        const cached = this.cache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
            this.stats.cacheHits++;
            console.log(`📚 [Yandex] Cache HIT for: "${word}"`);
            return cached.data;
        }
        
        // Проверяем common words
        if (this.commonWordsTranscriptions.has(lowerWord)) {
            const commonData = {
                transcription: this.commonWordsTranscriptions.get(lowerWord),
                audioUrl: this.generateFallbackAudioUrl(word)
            };
            
            // Сохраняем в кеш
            this.cache.set(cacheKey, {
                data: commonData,
                timestamp: Date.now()
            });
            
            this.stats.cacheHits++;
            console.log(`⭐ [Yandex] Common word: "${word}"`);
            return commonData;
        }
        
        // Проверяем черный список
        if (this.problemWords.has(lowerWord)) {
            console.log(`🚫 [Yandex] Skipping blacklisted word: "${word}"`);
            return this.getFallbackData(word);
        }
        
        console.log(`🔍 [Yandex] Cache MISS for: "${word}"`);
        const data = await this.fetchFromYandex(word);
        
        // Кешируем результат (даже если это fallback)
        this.cache.set(cacheKey, {
            data: data,
            timestamp: Date.now()
        });
        
        // Ограничиваем размер кеша
        if (this.cache.size > 1000) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        
        return data;
    }

    // Основной метод с кешированием
    async getTranscriptionAndAudio(word) {
        this.stats.totalRequests++;
        return this.getCachedTranscriptionAndAudio(word);
    }

    // Оптимизация: управление параллельными запросами
    async fetchFromYandex(word) {
        if (!this.useYandex) {
            console.log(`🔇 [Yandex] API disabled, using fallback for: "${word}"`);
            return this.getFallbackData(word);
        }

        // Проверяем лимит параллельных запросов
        if (this.concurrentRequests >= this.maxConcurrentRequests) {
            console.log(`⏳ [Yandex] Rate limit reached, using fallback for: "${word}"`);
            return this.getFallbackData(word);
        }

        this.concurrentRequests++;
        this.stats.apiHits++;
        
        try {
            console.log(`🌐 [Yandex] API Request for: "${word}"`);
            
            const response = await Promise.race([
                this.http.get('https://dictionary.yandex.net/api/v1/dicservice.json/lookup', {
                    params: {
                        key: process.env.YANDEX_DICTIONARY_API_KEY,
                        lang: 'en-ru',
                        text: word,
                        ui: 'ru'
                    }
                }),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Yandex API timeout')), 8000)
                )
            ]);

            console.log(`✅ [Yandex] API Success: "${word}" - Status: ${response.status}`);
            
            const result = {
                transcription: '',
                audioUrl: this.generateFallbackAudioUrl(word)
            };

            // Извлекаем транскрипцию
            if (response.data.def && response.data.def.length > 0 && response.data.def[0].ts) {
                result.transcription = `/${response.data.def[0].ts}/`;
                console.log(`🔤 [Yandex] Transcription: ${result.transcription}`);
            } else {
                console.log(`ℹ️ [Yandex] No transcription found for: "${word}"`);
            }

            return result;
            
        } catch (error) {
            this.stats.errors++;
            console.error(`❌ [Yandex] API ERROR for "${word}":`, error.message);
            
            // Добавляем проблемные слова в черный список
            if (error.message.includes('timeout') || error.message.includes('ENOTFOUND') || error.response?.status === 401) {
                this.problemWords.add(word.toLowerCase());
                console.log(`🚫 [Yandex] Added to blacklist: "${word}"`);
                
                // Если это ошибка аутентификации, отключаем Yandex API
                if (error.response?.status === 401) {
                    console.log('🔒 [Yandex] Authentication failed, disabling Yandex API');
                    this.useYandex = false;
                }
            }
            
            return this.getFallbackData(word);
        } finally {
            this.concurrentRequests--;
        }
    }

    // Оптимизация: улучшенный fallback
    getFallbackData(word) {
        // Пытаемся сгенерировать транскрипцию на основе правил
        const generatedTranscription = this.generateTranscription(word);
        
        return {
            transcription: generatedTranscription,
            audioUrl: this.generateFallbackAudioUrl(word)
        };
    }

    // Оптимизация: генерация транскрипции по правилам (basic)
    generateTranscription(word) {
        const lowerWord = word.toLowerCase();
        
        // Простые правила для частых паттернов
        const rules = [
            // Окончания
            { pattern: /ing$/, replacement: 'ɪŋ' },
            { pattern: /ed$/, replacement: 'd' },
            { pattern: /s$/, replacement: 's' },
            { pattern: /es$/, replacement: 'ɪz' },
            
            // Сочетания гласных
            { pattern: /ee/, replacement: 'iː' },
            { pattern: /oo/, replacement: 'uː' },
            { pattern: /oa/, replacement: 'əʊ' },
            { pattern: /ai/, replacement: 'eɪ' },
            { pattern: /ay/, replacement: 'eɪ' },
            { pattern: /ea/, replacement: 'iː' },
            
            // Сочетания согласных
            { pattern: /th/, replacement: 'θ' },
            { pattern: /sh/, replacement: 'ʃ' },
            { pattern: /ch/, replacement: 'tʃ' },
            { pattern: /ph/, replacement: 'f' },
            
            // Отдельные буквы
            { pattern: /a/, replacement: 'æ' },
            { pattern: /e/, replacement: 'e' },
            { pattern: /i/, replacement: 'ɪ' },
            { pattern: /o/, replacement: 'ɒ' },
            { pattern: /u/, replacement: 'ʌ' }
        ];

        let transcription = lowerWord;
        
        // Применяем правила (очень базовые)
        for (const rule of rules) {
            transcription = transcription.replace(rule.pattern, rule.replacement);
        }
        
        return transcription ? `/${transcription}/` : '';
    }

    // Генерация URL для Google TTS
    generateFallbackAudioUrl(word) {
        // Оптимизация: кешируем сгенерированные URL
        const encodedWord = encodeURIComponent(word);
        return `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodedWord}&tl=en-gb&client=tw-ob`;
    }

    // Оптимизация: массовый запрос транскрипций
    async getMultipleTranscriptions(words) {
        const results = {};
        const BATCH_SIZE = 5;
        const DELAY_BETWEEN_BATCHES = 1000;
        
        console.log(`🔄 [Yandex] Batch processing ${words.length} words`);
        
        for (let i = 0; i < words.length; i += BATCH_SIZE) {
            const batch = words.slice(i, i + BATCH_SIZE);
            console.log(`📦 [Yandex] Processing batch ${Math.floor(i/BATCH_SIZE) + 1}`);
            
            const batchPromises = batch.map(word => 
                this.getTranscriptionAndAudio(word).then(data => {
                    results[word] = data;
                    return data;
                })
            );
            
            await Promise.allSettled(batchPromises);
            
            // Задержка между батчами
            if (i + BATCH_SIZE < words.length) {
                await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
            }
        }
        
        console.log(`✅ [Yandex] Batch processing completed: ${Object.keys(results).length} words`);
        return results;
    }

    // Оптимизация: предзагрузка частых слов
    async preloadCommonWords(commonWords = []) {
        if (commonWords.length === 0) return;
        
        console.log(`🔮 [Yandex] Preloading ${commonWords.length} common words`);
        
        const preloadResults = {};
        for (const word of commonWords.slice(0, 15)) { // Ограничиваем предзагрузку
            try {
                const data = await this.getTranscriptionAndAudio(word);
                preloadResults[word] = data;
                console.log(`✅ [Yandex] Preloaded: "${word}"`);
            } catch (error) {
                console.error(`❌ [Yandex] Preload failed for "${word}":`, error.message);
            }
            
            // Задержка между предзагрузками
            await new Promise(resolve => setTimeout(resolve, 300));
        }
        
        return preloadResults;
    }

    // Оптимизация: очистка кеша
    startCacheCleanup() {
        setInterval(() => {
            const now = Date.now();
            let cleanedCount = 0;
            
            for (const [key, value] of this.cache.entries()) {
                if (now - value.timestamp > this.CACHE_TTL) {
                    this.cache.delete(key);
                    cleanedCount++;
                }
            }
            
            if (cleanedCount > 0) {
                console.log(`🧹 [Yandex] Cache cleanup: removed ${cleanedCount} expired entries`);
            }
            
            // Логируем статистику раз в час
            if (Math.random() < 0.02) { // 2% chance
                this.logStats();
            }
            
        }, 30 * 60 * 1000); // Каждые 30 минут
    }

    // Методы для мониторинга
    logStats() {
        const hitRate = this.stats.totalRequests > 0 
            ? (this.stats.cacheHits / this.stats.totalRequests * 100).toFixed(1)
            : 0;
            
        console.log(`📊 [Yandex] Stats - Total: ${this.stats.totalRequests}, ` +
                   `Cache: ${this.stats.cacheHits}, API: ${this.stats.apiHits}, ` +
                   `Errors: ${this.stats.errors}, Hit Rate: ${hitRate}%`);
    }

    getStats() {
        const hitRate = this.stats.totalRequests > 0 
            ? (this.stats.cacheHits / this.stats.totalRequests * 100)
            : 0;
            
        return {
            ...this.stats,
            hitRate,
            cacheSize: this.cache.size,
            blacklistSize: this.problemWords.size,
            commonWordsCount: this.commonWordsTranscriptions.size,
            apiEnabled: this.useYandex,
            concurrentRequests: this.concurrentRequests
        };
    }

    clearCache() {
        const previousSize = this.cache.size;
        this.cache.clear();
        console.log(`🗑️ [Yandex] Cache cleared: ${previousSize} entries removed`);
        return previousSize;
    }

    removeFromBlacklist(word) {
        const removed = this.problemWords.delete(word.toLowerCase());
        if (removed) {
            console.log(`✅ [Yandex] Removed from blacklist: "${word}"`);
        }
        return removed;
    }

    // Оптимизация: добавление пользовательских транскрипций
    addCustomTranscription(word, transcription) {
        const lowerWord = word.toLowerCase();
        this.commonWordsTranscriptions.set(lowerWord, transcription);
        
        // Обновляем кеш
        const cacheKey = `yandex_${lowerWord}`;
        this.cache.set(cacheKey, {
            data: {
                transcription: transcription,
                audioUrl: this.generateFallbackAudioUrl(word)
            },
            timestamp: Date.now()
        });
        
        console.log(`✏️ [Yandex] Added custom transcription for: "${word}"`);
        return true;
    }

    // Оптимизация: проверка доступности сервиса
    async healthCheck() {
        if (!this.useYandex) {
            return {
                status: 'fallback_mode',
                message: 'Yandex API disabled, using fallback mode'
            };
        }

        try {
            const testWord = 'test';
            const response = await this.http.get('https://dictionary.yandex.net/api/v1/dicservice.json/lookup', {
                params: {
                    key: process.env.YANDEX_DICTIONARY_API_KEY,
                    lang: 'en-ru',
                    text: testWord,
                    ui: 'ru'
                },
                timeout: 5000
            });
            
            return {
                status: 'healthy',
                apiEnabled: true,
                responseTime: response.duration,
                statusCode: response.status
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                apiEnabled: false,
                error: error.message
            };
        }
    }

    // Оптимизация: graceful shutdown
    async shutdown() {
        console.log('🔄 [Yandex] Shutting down service...');
        this.logStats();
        this.cache.clear();
        this.problemWords.clear();
        console.log('✅ [Yandex] Service shutdown completed');
    }

    // Оптимизация: включение/выключение API
    enableApi() {
        this.useYandex = true;
        console.log('✅ [Yandex] API enabled');
    }

    disableApi() {
        this.useYandex = false;
        console.log('🔇 [Yandex] API disabled');
    }
}

// Создаем глобальный экземпляр для повторного использования
let yandexServiceInstance = null;

export function getYandexService() {
    if (!yandexServiceInstance) {
        yandexServiceInstance = new YandexDictionaryService();
        
        // Предзагружаем частые слова при инициализации
        const commonWords = Array.from(yandexServiceInstance.commonWordsTranscriptions.keys());
        
        setTimeout(() => {
            yandexServiceInstance.preloadCommonWords(commonWords)
                .catch(error => console.error('❌ Yandex preload failed:', error));
        }, 3000);
    }
  
    return yandexServiceInstance;
}

// Graceful shutdown
process.on('SIGINT', async () => {
    if (yandexServiceInstance) {
        await yandexServiceInstance.shutdown();
    }
    process.exit(0);
});

process.on('SIGTERM', async () => {
    if (yandexServiceInstance) {
        await yandexServiceInstance.shutdown();
    }
    process.exit(0);
});
