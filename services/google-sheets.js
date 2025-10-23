import { google } from 'googleapis';

export class GoogleSheetsService {
    constructor() {
        this.initialized = false;
        this.sheets = null;
        this.spreadsheetId = process.env.GOOGLE_SHEET_ID;
        
        // ОПТИМИЗАЦИЯ: Минимальный кеш
        this.cache = new Map();
        this.CACHE_TTL = 5 * 60 * 1000;
        this.MAX_CACHE_SIZE = 40;

        if (!this.spreadsheetId) console.error('❌ GOOGLE_SHEET_ID not set');
        this.init();
    }

    async init() {
        if (!this.spreadsheetId) return;

        try {
            const auth = new google.auth.GoogleAuth({
                credentials: this.getCredentialsFromEnv(),
                scopes: ['https://www.googleapis.com/auth/spreadsheets'],
            });

            this.sheets = google.sheets({ version: 'v4', auth });
            this.initialized = true;
            
            // ✅ Инициализируем столбцы для обратных карточек
            await this.initializeReverseColumns();
        } catch (e) {
            console.error('❌ Google Sheets init failed');
        }
    }

    // ✅ ДОБАВЛЕНО: Инициализация столбцов для обратных карточек
    async initializeReverseColumns() {
        if (!this.initialized) return false;
        
        try {
            // Получаем текущие заголовки
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: 'Words!1:1'
            });

            const currentHeaders = response.data.values ? response.data.values[0] : [];
            const reverseColumns = [
                'ReverseDue',
                'ReverseStability', 
                'ReverseDifficulty',
                'ReverseInterval',
                'ReverseLastReview',
                'ReverseReps',
                'ReverseLapses'
            ];

            // Проверяем, какие столбцы отсутствуют
            const missingColumns = reverseColumns.filter(col => 
                !currentHeaders.includes(col)
            );

            if (missingColumns.length > 0) {
                console.log('🔧 Adding missing reverse columns:', missingColumns);
                
                // Добавляем недостающие столбцы
                const newHeaders = [...currentHeaders, ...missingColumns];
                await this.sheets.spreadsheets.values.update({
                    spreadsheetId: this.spreadsheetId,
                    range: 'Words!1:1',
                    valueInputOption: 'RAW',
                    resource: {
                        values: [newHeaders]
                    }
                });
                
                console.log('✅ Reverse columns initialized successfully');
            } else {
                console.log('✅ All reverse columns already exist');
            }
            
            return true;
        } catch (error) {
            console.error('❌ Error initializing reverse columns:', error);
            return false;
        }
    }

    // ОПТИМИЗАЦИЯ: Упрощенный кеш
    async getCachedData(cacheKey, fetchFn) {
        const cached = this.cache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
            return cached.data;
        }
        
        const data = await fetchFn();
        
        if (this.cache.size >= this.MAX_CACHE_SIZE) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        
        this.cache.set(cacheKey, { data, timestamp: Date.now() });
        return data;
    }

    // ОПТИМИЗАЦИЯ: Автоочистка кеша
    startCacheCleanup() {
        setInterval(() => {
            const now = Date.now();
            for (const [key, val] of this.cache.entries()) {
                if (now - val.timestamp > this.CACHE_TTL) {
                    this.cache.delete(key);
                }
            }
        }, 5 * 60 * 1000);
    }

    // ОПТИМИЗАЦИЯ: Обновление слова с сохранением ВСЕХ полей FSRS
    async updateWordAfterFSRSReview(userId, english, fsrsCard, rating) {
        if (!this.initialized) return false;
        try {
            const words = await this.getUserWords(userId);
            const word = words.find(w => w.english.toLowerCase() === english.toLowerCase());
            if (!word) return false;

            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: 'Words!A:V' // Обновлено до V для новых столбцов
            });

            const rows = response.data.values || [];
            const rowIndex = rows.findIndex(r => r[0] === userId.toString() && r[1].toLowerCase() === english.toLowerCase()) + 1;
            if (rowIndex === 0) return false;

            const dueDate = fsrsCard.due?.toISOString?.() || new Date().toISOString();
            const interval = fsrsCard.interval?.toString() || '2';
            const ease = fsrsCard.ease?.toFixed(2) || '2.50';
            const repetitions = fsrsCard.repetitions?.toString() || '1';
            
            // ВАЖНО: Сохраняем ВСЕ поля FSRS для правильной работы алгоритма
            const stability = fsrsCard.stability?.toFixed(4) || '0.1000';
            const difficulty = fsrsCard.difficulty?.toFixed(4) || '5.0000';
            const elapsed_days = fsrsCard.elapsed_days?.toString() || '0';
            const scheduled_days = fsrsCard.scheduled_days?.toString() || '1';
            const lapses = fsrsCard.lapses?.toString() || '0';
            const state = fsrsCard.state?.toString() || '1';
            
            let firstLearnedDate = fsrsCard.firstLearnedDate || word.firstLearnedDate;
            if ((!firstLearnedDate || firstLearnedDate.trim() === '') && word.interval === 1) {
                firstLearnedDate = new Date().toISOString();
            }

            await this.sheets.spreadsheets.values.update({
                spreadsheetId: this.spreadsheetId,
                range: `Words!G${rowIndex}:O${rowIndex}`,
                valueInputOption: 'RAW',
                resource: {
                    values: [[
                        new Date().toISOString(),           // LastReview
                        dueDate,                            // NextReview
                        interval,                           // Interval
                        'active',                           // Status
                        firstLearnedDate || '',             // FirstLearnedDate
                        ease,                               // Ease
                        repetitions,                        // Repetitions
                        rating,                             // Rating
                        // Дополнительные поля FSRS в колонке O (JSON)
                        JSON.stringify({
                            stability: parseFloat(stability),
                            difficulty: parseFloat(difficulty),
                            elapsed_days: parseInt(elapsed_days),
                            scheduled_days: parseInt(scheduled_days),
                            lapses: parseInt(lapses),
                            state: parseInt(state)
                        })
                    ]]
                }
            });

            this.cache.delete(`words_${userId}`);
            this.cache.delete(`review_${userId}`);
            return true;
        } catch (e) {
            return false;
        }
    }

    // ✅ ДОБАВЛЕНО: Обновление прогресса обратной карточки
    async updateReverseCardProgress(chatId, englishWord, fsrsResult, rating) {
        if (!this.initialized) return false;
        try {
            const words = await this.getUserWords(chatId);
            const word = words.find(w => w.english.toLowerCase() === englishWord.toLowerCase());
            if (!word) return false;

            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: 'Words!A:V'
            });

            const rows = response.data.values || [];
            const rowIndex = rows.findIndex(r => r[0] === chatId.toString() && r[1].toLowerCase() === englishWord.toLowerCase()) + 1;
            if (rowIndex === 0) return false;

            const reverseDue = fsrsResult.due?.toISOString?.() || new Date().toISOString();
            const reverseStability = fsrsResult.stability?.toFixed(4) || '0.1000';
            const reverseDifficulty = fsrsResult.difficulty?.toFixed(4) || '6.0000';
            const reverseInterval = fsrsResult.interval?.toString() || '1';
            const reverseLastReview = new Date().toISOString();
            
            // Получаем текущие значения reps и lapses
            let reverseReps = 1;
            let reverseLapses = 0;
            
            if (rows[rowIndex - 1][20]) { // Колонка U (ReverseReps)
                reverseReps = parseInt(rows[rowIndex - 1][20]) + 1;
            }
            
            if (rating === 'again') {
                if (rows[rowIndex - 1][21]) { // Колонка V (ReverseLapses)
                    reverseLapses = parseInt(rows[rowIndex - 1][21]) + 1;
                } else {
                    reverseLapses = 1;
                }
            } else {
                reverseLapses = rows[rowIndex - 1][21] ? parseInt(rows[rowIndex - 1][21]) : 0;
            }

            await this.sheets.spreadsheets.values.update({
                spreadsheetId: this.spreadsheetId,
                range: `Words!P${rowIndex}:V${rowIndex}`,
                valueInputOption: 'RAW',
                resource: {
                    values: [[
                        reverseDue,           // P: ReverseDue
                        reverseStability,     // Q: ReverseStability
                        reverseDifficulty,    // R: ReverseDifficulty
                        reverseInterval,      // S: ReverseInterval
                        reverseLastReview,    // T: ReverseLastReview
                        reverseReps.toString(), // U: ReverseReps
                        reverseLapses.toString() // V: ReverseLapses
                    ]]
                }
            });

            this.cache.delete(`words_${chatId}`);
            console.log(`✅ Reverse card updated for: ${englishWord}`);
            return true;
        } catch (error) {
            console.error('❌ Error updating reverse card:', error);
            return false;
        }
    }

    // ✅ ДОБАВЛЕНО: Получение данных обратной карточки
    async getReverseCardData(chatId, englishWord) {
        if (!this.initialized) return null;
        try {
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: 'Words!A:V'
            });

            const rows = response.data.values || [];
            const row = rows.find(r => 
                r[0] === chatId.toString() && 
                r[1].toLowerCase() === englishWord.toLowerCase()
            );
            
            if (row && row[15]) { // Колонка P (ReverseDue)
                const reverseData = {
                    due: new Date(row[15]),
                    stability: parseFloat(row[16]) || 0.1,
                    difficulty: parseFloat(row[17]) || 6.0,
                    interval: parseFloat(row[18]) || 1,
                    elapsed_days: 0,
                    scheduled_days: 1,
                    reps: parseInt(row[20]) || 0,
                    lapses: parseInt(row[21]) || 0,
                    state: 1,
                    last_review: new Date(row[19] || new Date())
                };
                
                console.log(`📊 Loaded reverse card data for: ${englishWord}`);
                return reverseData;
            }
            
            console.log(`📝 No reverse card data found for: ${englishWord}`);
            return null;
        } catch (error) {
            console.error('❌ Error getting reverse card data:', error);
            return null;
        }
    }

    // ✅ ДОБАВЛЕНО: Статистика по обратным карточкам
    async getReverseTrainingStats(chatId) {
        if (!this.initialized) return null;
        try {
            const words = await this.getUserWords(chatId);
            const activeWords = words.filter(word => word.status === 'active');
            
            let stats = {
                totalWords: activeWords.length,
                wordsWithReverseCards: 0,
                totalReverseReps: 0,
                totalReverseLapses: 0,
                avgReverseDifficulty: 0,
                syncedWords: 0
            };

            // Загружаем данные обратных карточек для каждого слова
            for (const word of activeWords) {
                const reverseData = await this.getReverseCardData(chatId, word.english);
                if (reverseData && reverseData.reps > 0) {
                    stats.wordsWithReverseCards++;
                    stats.totalReverseReps += reverseData.reps;
                    stats.totalReverseLapses += reverseData.lapses;
                    stats.avgReverseDifficulty += reverseData.difficulty;
                    
                    // Проверяем синхронизацию (интервалы отличаются не более чем в 2 раза)
                    if (reverseData.interval > 0 && word.interval > 0) {
                        const ratio = Math.max(reverseData.interval, word.interval) / Math.min(reverseData.interval, word.interval);
                        if (ratio <= 2.0) {
                            stats.syncedWords++;
                        }
                    }
                }
            }
            
            if (stats.wordsWithReverseCards > 0) {
                stats.avgReverseDifficulty = Math.round((stats.avgReverseDifficulty / stats.wordsWithReverseCards) * 10);
            }
            
            return stats;
        } catch (error) {
            console.error('❌ Error getting reverse training stats:', error);
            return null;
        }
    }

    // ОПТИМИЗАЦИЯ: Чтение слов с извлечением данных FSRS
    async getUserWords(userId) {
        if (!this.initialized) return [];
        const cacheKey = `words_${userId}`;
        
        return this.getCachedData(cacheKey, async () => {
            try {
                const response = await this.sheets.spreadsheets.values.get({
                    spreadsheetId: this.spreadsheetId,
                    range: 'Words!A:V' // Обновлено до V для новых столбцов
                });

                const rows = response.data.values || [];
                return rows.slice(1)
                    .filter(row => row[0] === userId.toString() && (row[9] === 'active' || !row[9]))
                    .map(row => {
                        // Извлекаем данные FSRS из колонки O
                        let fsrsData = {};
                        try {
                            if (row[14]) {
                                fsrsData = JSON.parse(row[14]);
                            }
                        } catch (e) {
                            // Игнорируем ошибки парсинга
                        }

                        return {
                            userId: row[0],
                            english: row[1],
                            transcription: row[2],
                            audioUrl: row[3],
                            meanings: row[4] ? JSON.parse(row[4]) : [],
                            createdDate: row[5],
                            lastReview: row[6],
                            nextReview: row[7],
                            interval: parseInt(row[8]) || 1,
                            status: row[9],
                            firstLearnedDate: row[10],
                            ease: parseFloat(row[11]) || 2.5,
                            repetitions: parseInt(row[12]) || 0,
                            rating: parseFloat(row[13]) || 0,
                            // Данные FSRS
                            stability: fsrsData.stability || 0.1,
                            difficulty: fsrsData.difficulty || 5.0,
                            elapsed_days: fsrsData.elapsed_days || 0,
                            scheduled_days: fsrsData.scheduled_days || 1,
                            lapses: fsrsData.lapses || 0,
                            state: fsrsData.state || 1
                        };
                    });
            } catch (e) {
                return [];
            }
        });
    }

    // Остальные методы остаются без изменений, но с оптимизацией памяти
    async addWordWithMeanings(userId, english, transcription, audioUrl, meanings) {
        if (!this.initialized) return false;
        try {
            const meaningsJSON = JSON.stringify(meanings);
            const now = new Date();
            const nextReview = new Date(now.getTime() + 24 * 60 * 60 * 1000);

            await this.sheets.spreadsheets.values.append({
                spreadsheetId: this.spreadsheetId,
                range: 'Words!A:V',
                valueInputOption: 'RAW',
                requestBody: {
                    values: [[
                        userId.toString(),
                        english.toLowerCase(),
                        transcription || '',
                        audioUrl || '',
                        meaningsJSON,
                        now.toISOString(),
                        '',
                        nextReview.toISOString(),
                        1,
                        'active',
                        '',
                        2.5,
                        0,
                        0,
                        JSON.stringify({}), // Пустые данные FSRS для нового слова
                        '', '', '', '', '', '', '' // Пустые значения для обратных карточек
                    ]]
                }
            });

            this.cache.delete(`words_${userId}`);
            return true;
        } catch (e) {
            return false;
        }
    }

    async getWordsForReview(userId) {
        const words = await this.getUserWords(userId);
        const now = new Date();
        
        return words.filter(w => {
            if (w.status !== 'active') return false;
            
            const isLearned = w.interval > 1 || 
                             (w.firstLearnedDate && w.firstLearnedDate.trim() !== '');
            if (!isLearned) return false;
            
            if (!w.nextReview) return false;
            
            try {
                const nextReviewDate = new Date(w.nextReview);
                const moscowOffset = 3 * 60 * 60 * 1000;
                const moscowNow = new Date(now.getTime() + moscowOffset);
                const moscowReview = new Date(nextReviewDate.getTime() + moscowOffset);
                
                return moscowReview <= moscowNow;
            } catch (e) {
                return false;
            }
        });
    }
    
    async getReviewWordsCount(userId) {
        const reviewWords = await this.getWordsForReview(userId);
        return reviewWords.length;
    }

    async getNewWordsCount(userId) {
        const words = await this.getUserWords(userId);
        return words.filter(w => 
            w.status === 'active' && 
            w.interval === 1 &&
            (!w.firstLearnedDate || w.firstLearnedDate.trim() === '')
        ).length;
    }

    getCredentialsFromEnv() {
        try {
            if (process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS) {
                return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS);
            }
            if (process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
                return {
                    type: 'service_account',
                    project_id: process.env.GOOGLE_PROJECT_ID || 'default-project',
                    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
                    client_email: process.env.GOOGLE_CLIENT_EMAIL,
                    client_id: process.env.GOOGLE_CLIENT_ID || 'default-client-id',
                    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
                    token_uri: 'https://oauth2.googleapis.com/token',
                };
            }
            return null;
        } catch (e) {
            return null;
        }
    }
}

export const sheetsService = new GoogleSheetsService();
sheetsService.startCacheCleanup();
