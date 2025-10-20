import { google } from 'googleapis';

export class GoogleSheetsService {
    constructor() {
        this.initialized = false;
        this.sheets = null;
        this.spreadsheetId = process.env.GOOGLE_SHEET_ID;
        
        // Оптимизация: кеширование для частых запросов
        this.cache = new Map();
        this.CACHE_TTL = 2 * 60 * 1000; // 2 минуты
        
        console.log('🔧 GoogleSheetsService - Spreadsheet ID:', this.spreadsheetId ? 'SET' : 'NOT SET');
        
        if (!this.spreadsheetId) {
            console.error('❌ CRITICAL: GOOGLE_SHEET_ID is not set in environment variables');
        }
        
        this.init();
    }

    async init() {
        if (!this.spreadsheetId) {
            console.error('❌ Cannot initialize: GOOGLE_SHEET_ID is required');
            this.initialized = false;
            return;
        }

        try {
            console.log('🔄 Initializing Google Sheets service...');
            const auth = new google.auth.GoogleAuth({
                credentials: this.getCredentialsFromEnv(),
                scopes: ['https://www.googleapis.com/auth/spreadsheets'],
            });

            this.sheets = google.sheets({ version: 'v4', auth });

            await this.initializeSheetStructure();
            this.initialized = true;
            console.log('✅ Google Sheets service initialized');
        } catch (error) {
            console.error('❌ Google Sheets initialization failed:', error.message);
            this.initialized = false;
        }
    }

    getCredentialsFromEnv() {
        try {
            // Вариант 1: Полный JSON из одной переменной
            if (process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS) {
                console.log('🔑 Using GOOGLE_SERVICE_ACCOUNT_CREDENTIALS');
                return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS);
            }

            // Вариант 2: Отдельные переменные
            if (process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
                console.log('🔑 Using separate credential variables');
                return {
                    type: 'service_account',
                    project_id: process.env.GOOGLE_PROJECT_ID || 'default-project',
                    private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID || 'default-key-id',
                    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
                    client_email: process.env.GOOGLE_CLIENT_EMAIL,
                    client_id: process.env.GOOGLE_CLIENT_ID || 'default-client-id',
                    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
                    token_uri: 'https://oauth2.googleapis.com/token',
                    auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs'
                };
            }

            console.error('❌ No Google credentials found in environment variables');
            return null;
        } catch (error) {
            console.error('❌ Error parsing Google credentials:', error);
            return null;
        }
    }

    // Оптимизация: кеширование методов
    async getCachedData(cacheKey, fetchFunction) {
        const cached = this.cache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
            return cached.data;
        }
        
        const data = await fetchFunction();
        this.cache.set(cacheKey, {
            data: data,
            timestamp: Date.now()
        });
        
        return data;
    }

    // Периодическая очистка кеша
    startCacheCleanup() {
        setInterval(() => {
            const now = Date.now();
            for (const [key, value] of this.cache.entries()) {
                if (now - value.timestamp > this.CACHE_TTL) {
                    this.cache.delete(key);
                }
            }
        }, 5 * 60 * 1000); // Каждые 5 минут
    }

    // ✅ ОБНОВЛЕННАЯ ФУНКЦИЯ: Инициализация структуры таблицы с LastReview как столбцом G
 async initializeSheetStructure() {
    try {
        // Получаем информацию о листах
        const spreadsheet = await this.sheets.spreadsheets.get({
            spreadsheetId: this.spreadsheetId,
        });

        const sheets = spreadsheet.data.sheets;
        const wordsSheet = sheets.find(sheet => sheet.properties.title === 'Words');

        if (!wordsSheet) {
            // Создаем новый лист с заголовками
            await this.sheets.spreadsheets.batchUpdate({
                spreadsheetId: this.spreadsheetId,
                resource: {
                    requests: [
                        {
                            addSheet: {
                                properties: {
                                    title: 'Words'
                                }
                            }
                        }
                    ]
                }
            });

            // ✅ ОБНОВЛЕННЫЕ ЗАГОЛОВКИ: Добавляем FirstLearnedDate как столбец K
            await this.sheets.spreadsheets.values.update({
                spreadsheetId: this.spreadsheetId,
                range: 'Words!A1:K1',
                valueInputOption: 'RAW',
                resource: {
                    values: [[
                        'UserID',
                        'English',
                        'Transcription',
                        'AudioURL',
                        'MeaningsJSON',
                        'CreatedDate',
                        'LastReview',
                        'NextReview',
                        'Interval',
                        'Status',
                        'FirstLearnedDate' // ✅ НОВЫЙ СТОЛБЕЦ K - FirstLearnedDate
                    ]]
                }
            });
            console.log('✅ Created new Words sheet with FirstLearnedDate column');
        } else {
            console.log('✅ Words sheet already exists');
            
            // ✅ ПРОВЕРЯЕМ ЕСТЬ ЛИ СТОЛБЕЦ FirstLearnedDate
            const headersResponse = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: 'Words!A1:K1',
            });
            
            const headers = headersResponse.data.values ? headersResponse.data.values[0] : [];
            if (!headers.includes('FirstLearnedDate')) {
                console.log('🔄 Adding FirstLearnedDate column to existing sheet...');
                
                // Добавляем заголовок для нового столбца
                await this.sheets.spreadsheets.values.update({
                    spreadsheetId: this.spreadsheetId,
                    range: 'Words!K1',
                    valueInputOption: 'RAW',
                    resource: {
                        values: [['FirstLearnedDate']]
                    }
                });
                console.log('✅ Added FirstLearnedDate column header');
            }
        }
    } catch (error) {
        console.error('❌ Error initializing sheet structure:', error.message);
    }
}
    
    // ✅ ОБНОВЛЕННАЯ ФУНКЦИЯ: Сохранение слова с новой структурой
   async addWordWithMeanings(userId, english, transcription, audioUrl, meanings) {
    if (!this.initialized) {
        console.log('❌ Google Sheets not initialized');
        return false;
    }

    try {
        const meaningsJSON = JSON.stringify(meanings);
        const now = new Date();
        const nextReview = new Date();
        nextReview.setDate(nextReview.getDate() + 1);

        const response = await this.sheets.spreadsheets.values.append({
            spreadsheetId: this.spreadsheetId,
            range: 'Words!A:K',
            valueInputOption: 'RAW',
            requestBody: {
                values: [[
                    userId.toString(),
                    english.toLowerCase(),
                    transcription || '',
                    audioUrl || '',
                    meaningsJSON,
                    now.toISOString(),    // CreatedDate
                    '',                   // LastReview - пусто для новых слов
                    nextReview.toISOString(), // NextReview
                    1,                    // начальный интервал
                    'active',
                    ''                    // ✅ FirstLearnedDate - пусто для новых слов
                ]]
            }
        });

        // Инвалидируем кеш для этого пользователя
        this.cache.delete(`words_${userId}`);
        console.log(`✅ Word "${english}" saved with FirstLearnedDate column`);
        return true;
    } catch (error) {
        console.error('❌ Error saving word:', error.message);
        return false;
    }
}

    // ✅ ОБНОВЛЕННАЯ ФУНКЦИЯ: Получение слов пользователя с новой структурой
async getUserWords(userId) {
    if (!this.initialized) {
        return [];
    }

    const cacheKey = `words_${userId}`;
    return this.getCachedData(cacheKey, async () => {
        try {
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: 'Words!A:K',
            });

            const rows = response.data.values || [];

            // Пропускаем заголовок и фильтруем по UserID и статусу
            const userWords = rows.slice(1).filter(row => 
                row.length >= 6 && 
                row[0] === userId.toString() && 
                (row[9] === 'active' || !row[9] || row.length < 10)
            );

            return userWords.map(row => {
                // ✅ ПРАВИЛЬНЫЕ ИНДЕКСЫ СТОЛБЦОВ для вашей таблицы:
                // A=0: UserID, B=1: English, C=2: Transcription, D=3: AudioURL
                // E=4: Data (MeaningsJSON), F=5: Date (CreatedDate), G=6: LastReview
                // H=7: NextReview, I=8: Interval, J=9: Status, K=10: FirstLearnedDate
                
                const userId = row[0] || '';
                const english = row[1] || '';
                const transcription = row[2] || '';
                const audioUrl = row[3] || '';
                const meaningsJSON = row[4] || '[]';
                const createdDate = row[5] || new Date().toISOString();
                const lastReview = row[6] || '';        // ✅ СТОЛБЕЦ G
                const nextReview = row[7] || new Date().toISOString(); // ✅ СТОЛБЕЦ H
                const interval = parseInt(row[8]) || 1; // ✅ СТОЛБЕЦ I
                const status = row[9] || 'active';
                const firstLearnedDate = row[10] || ''; // ✅ СТОЛБЕЦ K

                let meanings = [];
                
                try {
                    if (meaningsJSON && meaningsJSON.trim().startsWith('[')) {
                        meanings = JSON.parse(meaningsJSON);
                    } else if (meaningsJSON && meaningsJSON.trim().startsWith('{')) {
                        meanings = [JSON.parse(meaningsJSON)];
                    } else {
                        console.log(`⚠️ Invalid JSON for word "${english}", creating fallback:`, meaningsJSON.substring(0, 50));
                        meanings = [{
                            translation: meaningsJSON || 'Неизвестный перевод',
                            example: '',
                            partOfSpeech: '',
                            definition: ''
                        }];
                    }
                } catch (parseError) {
                    console.error(`❌ Error parsing meanings JSON for word "${english}":`, parseError.message);
                    meanings = [{
                        translation: 'Перевод не загружен',
                        example: '',
                        partOfSpeech: '',
                        definition: ''
                    }];
                }

                return {
                    userId,
                    english,
                    transcription,
                    audioUrl,
                    meanings,
                    createdDate,
                    lastReview,        // ✅ ПРАВИЛЬНОЕ ПОЛЕ
                    nextReview,        // ✅ ПРАВИЛЬНОЕ ПОЛЕ  
                    interval,          // ✅ ПРАВИЛЬНОЕ ПОЛЕ
                    status,
                    firstLearnedDate   // ✅ ПРАВИЛЬНОЕ ПОЛЕ
                };
            });
        } catch (error) {
            console.error('❌ Error reading words from Google Sheets:', error.message);
            return [];
        }
    });
}

    
    // ✅ ИСПРАВЛЕННАЯ ФУНКЦИЯ: Получение слов для повторения
async getWordsForReview(userId) {
    const userWords = await this.getUserWords(userId);
    
    // ✅ Московское время для корректного сравнения
    const moscowOffset = 3 * 60 * 60 * 1000; // +3 часа
    const moscowNow = new Date(Date.now() + moscowOffset);
    
    console.log(`🔍 Поиск слов для повторения для ${userId}`);
    console.log(`⏰ Московское время для сравнения: ${moscowNow.toISOString()}`);
    
    const reviewWords = userWords.filter(word => {
        if (!word.nextReview || word.status !== 'active' || word.interval === 1) {
            return false;
        }
        
        try {
            const nextReview = new Date(word.nextReview);
            const isDue = nextReview <= moscowNow;
            
            console.log(`🔍 ${word.english}: nextReview=${nextReview.toISOString()}, isDue=${isDue}`);
            
            return isDue;
        } catch (error) {
            console.error(`❌ Error checking review date for "${word.english}":`, error);
            return false;
        }
    });
    
    console.log(`📊 Найдено слов для повторения: ${reviewWords.length}`);
    return reviewWords;
}
    
    // ✅ УЛУЧШЕННАЯ ФУНКЦИЯ: Получение новых слов с проверкой повторений
    async getNewWordsForLearning(userId) {
        if (!this.initialized) {
            return [];
        }
        
        try {
            const userWords = await this.getUserWords(userId);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            console.log(`🔍 Поиск новых слов для пользователя ${userId}`);

            // Фильтруем слова, которые созданы сегодня и имеют 0 повторений
            const newWords = userWords.filter(word => {
                if (!word.nextReview || word.status !== 'active') return false;
                
                try {
                    const createdDate = new Date(word.createdDate);
                    const isCreatedToday = createdDate >= today;
                    const hasZeroRepetitions = !word.reps || word.reps === 0;
                    
                    const isNewWord = isCreatedToday && hasZeroRepetitions;
                    
                    if (isNewWord) {
                        console.log(`✅ Слово "${word.english}" - НОВОЕ: создано сегодня, повторений: ${word.reps || 0}`);
                    }
                    
                    return isNewWord;
                } catch (dateError) {
                    console.error(`❌ Invalid date for word "${word.english}"`);
                    return false;
                }
            });

            console.log(`📊 Найдено новых слов: ${newWords.length}`);
            
            // Сортируем по дате создания
            newWords.sort((a, b) => new Date(b.createdDate) - new Date(a.createdDate));

            // Лимит 5 новых слов в день
            return newWords.slice(0, 5);
            
        } catch (error) {
            console.error('❌ Error getting new words for learning:', error.message);
            return [];
        }
    }

    // ✅ ИСПРАВЛЕННАЯ ФУНКЦИЯ: Проверка есть ли слова для повторения
    async hasWordsForReview(userId) {
        if (!this.initialized) {
            return false;
        }
        
        try {
            const wordsForReview = await this.getWordsForReview(userId);
            return wordsForReview.length > 0;
        } catch (error) {
            console.error('❌ Error checking words for review:', error.message);
            return false;
        }
    }

    // ✅ ФУНКЦИЯ: Получение количества слов для повторения
    async getReviewWordsCount(userId) {
        if (!this.initialized) {
            return 0;
        }
        
        try {
            const wordsForReview = await this.getWordsForReview(userId);
            return wordsForReview.length;
        } catch (error) {
            console.error('❌ Error getting review words count:', error.message);
            return 0;
        }
    }

    // ✅ ФУНКЦИЯ: Получение количества новых слов для изучения
    async getNewWordsCount(userId) {
        if (!this.initialized) {
            return 0;
        }
        
        try {
            const newWords = await this.getNewWordsForLearning(userId);
            return newWords.length;
        } catch (error) {
            console.error('❌ Error getting new words count:', error.message);
            return 0;
        }
    }

    // ✅ НОВАЯ ФУНКЦИЯ: Массовое обновление слов (для батчинга)
async batchUpdateWords(chatId, wordUpdates) {
    if (!this.initialized) {
        return false;
    }
    
    try {
        console.log(`🔄 Batch updating ${wordUpdates.length} words for user ${chatId}`);
        
        const response = await this.sheets.spreadsheets.values.get({
            spreadsheetId: this.spreadsheetId,
            range: 'Words!A:K',
        });
        
        const rows = response.data.values || [];
        const updates = [];
        
        for (const [english, data] of wordUpdates) {
            let rowIndex = -1;
            
            for (let i = 0; i < rows.length; i++) {
                if (rows[i][0] === chatId.toString() && 
                    rows[i][1].toLowerCase() === english.toLowerCase() && 
                    (rows[i][9] === 'active' || !rows[i][9] || rows[i].length < 10)) {
                    rowIndex = i + 1;
                    break;
                }
            }

            if (rowIndex !== -1) {
                const currentRow = rows[rowIndex - 1];
                const currentFirstLearnedDate = currentRow[10] || '';
                
                let firstLearnedDate = currentFirstLearnedDate;
                if ((!currentFirstLearnedDate || currentFirstLearnedDate === '') && 
                    data.interval > 1) {
                    firstLearnedDate = data.lastReview ? data.lastReview.toISOString() : new Date().toISOString();
                    console.log(`🎯 Установлен FirstLearnedDate для "${english}": ${firstLearnedDate}`);
                }

                // ✅ ПРАВИЛЬНЫЙ ДИАПАЗОН: G-K
                updates.push({
                    range: `Words!G${rowIndex}:K${rowIndex}`,
                    values: [[
                        data.lastReview ? data.lastReview.toISOString() : new Date().toISOString(), // G: LastReview
                        data.nextReview.toISOString(), // H: NextReview
                        data.interval.toString(),      // I: Interval
                        'active',                      // J: Status
                        firstLearnedDate               // K: FirstLearnedDate
                    ]]
                });
            }
        }
        
        if (updates.length > 0) {
            await this.sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: this.spreadsheetId,
                resource: {
                    valueInputOption: 'RAW',
                    data: updates
                }
            });
            
            this.cache.delete(`words_${chatId}`);
            this.cache.delete(`review_${chatId}`);
            
            console.log(`✅ Batch update completed: ${updates.length} words updated`);
            return true;
        }
        
        return false;
        
    } catch (error) {
        console.error('❌ Error in batch update:', error.message);
        return false;
    }
}

    // ✅ ИСПРАВЛЕННАЯ ФУНКЦИЯ: Обновление карточки после повторения
   async updateCardAfterReview(userId, english, fsrsData, rating) {
    if (!this.initialized) {
        return false;
    }
    
    try {
        // Находим текущую карточку
        const userWords = await this.getUserWords(userId);
        const currentWord = userWords.find(w => w.english.toLowerCase() === english.toLowerCase());
        
        // ✅ ИСПРАВЛЕНИЕ: Ищем в правильном диапазоне A:K
        const response = await this.sheets.spreadsheets.values.get({
            spreadsheetId: this.spreadsheetId,
            range: 'Words!A:K', // ✅ БЫЛО: A:J, СТАЛО: A:K
        });
        
        const rows = response.data.values || [];
        let rowIndex = -1;
        
        for (let i = 0; i < rows.length; i++) {
            if (rows[i][0] === userId.toString() && 
                rows[i][1].toLowerCase() === english.toLowerCase() && 
                (rows[i][9] === 'active' || !rows[i][9] || rows[i].length < 10)) {
                rowIndex = i + 1;
                break;
            }
        }

        if (rowIndex === -1) {
            console.error('❌ Word not found for review update:', english);
            return false;
        }

        // ✅ ИСПРАВЛЕНИЕ: Обновляем LastReview, NextReview, Interval и FirstLearnedDate если нужно
        const currentRow = rows[rowIndex - 1];
        const currentFirstLearnedDate = currentRow[10] || '';
        
        let firstLearnedDate = currentFirstLearnedDate;
        // Если слово изучается впервые и у него нет FirstLearnedDate
        if ((!currentFirstLearnedDate || currentFirstLearnedDate === '') && fsrsData.card.interval > 1) {
            firstLearnedDate = new Date().toISOString();
            console.log(`🎯 Установлен FirstLearnedDate для "${english}": ${firstLearnedDate}`);
        }

        const updateData = [
            new Date().toISOString(), // ✅ LastReview - текущее время (G)
            fsrsData.card.due.toISOString(), // ✅ NextReview - из FSRS (H)
            fsrsData.card.interval.toString(), // ✅ Interval - из FSRS (I)
            'active', // Status (J)
            firstLearnedDate // FirstLearnedDate (K)
        ];

        // ✅ ИСПРАВЛЕНИЕ: Обновляем диапазон G:K
        await this.sheets.spreadsheets.values.update({
            spreadsheetId: this.spreadsheetId,
            range: `Words!G${rowIndex}:K${rowIndex}`, // ✅ БЫЛО: G:I, СТАЛО: G:K
            valueInputOption: 'RAW',
            resource: {
                values: [updateData]
            }
        });

        // Инвалидируем кеш
        this.cache.delete(`words_${userId}`);
        this.cache.delete(`review_${userId}`);

        console.log(`✅ Updated review for word "${english}": rating=${rating}, interval=${fsrsData.card.interval}`);
        return true;
    } catch (error) {
        console.error('❌ Error updating card after review:', error.message);
        return false;
    }
}
    
    // ✅ ИСПРАВЛЕННАЯ ФУНКЦИЯ: Обновление повторения с новой структурой
async updateWordReview(userId, english, newInterval, nextReviewDate, lastReview = null) {
    if (!this.initialized) {
        return false;
    }
    
    try {
        const response = await this.sheets.spreadsheets.values.get({
            spreadsheetId: this.spreadsheetId,
            range: 'Words!A:K',
        });
        
        const rows = response.data.values || [];
        let rowIndex = -1;
        
        for (let i = 0; i < rows.length; i++) {
            if (rows[i][0] === userId.toString() && 
                rows[i][1].toLowerCase() === english.toLowerCase() && 
                (rows[i][9] === 'active' || !rows[i][9] || rows[i].length < 10)) {
                rowIndex = i + 1;
                break;
            }
        }

        if (rowIndex === -1) {
            return false;
        }

        const currentRow = rows[rowIndex - 1];
        const currentFirstLearnedDate = currentRow[10] || '';
        
        let finalFirstLearnedDate = currentFirstLearnedDate;
        
        if ((!currentFirstLearnedDate || currentFirstLearnedDate === '') && newInterval > 1) {
            finalFirstLearnedDate = lastReview ? lastReview.toISOString() : new Date().toISOString();
        }

        const updateData = [
            lastReview ? lastReview.toISOString() : new Date().toISOString(),
            nextReviewDate.toISOString(),
            newInterval.toString(),
            'active',
            finalFirstLearnedDate
        ];

        await this.sheets.spreadsheets.values.update({
            spreadsheetId: this.spreadsheetId,
            range: `Words!G${rowIndex}:K${rowIndex}`,
            valueInputOption: 'RAW',
            resource: {
                values: [updateData]
            }
        });

        this.cache.delete(`words_${userId}`);
        this.cache.delete(`review_${userId}`);
        
        return true;
    } catch (error) {
        return false;
    }
}
    
    // ✅ ФУНКЦИЯ: Добавление нового значения к существующему слову
   async addMeaningToWord(userId, english, newMeaning) {
    if (!this.initialized) {
        return false;
    }
    
    try {
        // Находим слово
        const userWords = await this.getUserWords(userId);
        const word = userWords.find(w => w.english.toLowerCase() === english.toLowerCase());
        
        if (!word) {
            console.error('❌ Word not found for adding meaning:', english);
            return false;
        }

        // Добавляем новое значение
        const updatedMeanings = [...word.meanings, newMeaning];
        const updatedMeaningsJSON = JSON.stringify(updatedMeanings);

        // ✅ ИСПРАВЛЕНИЕ: Ищем в правильном диапазоне A:K
        const response = await this.sheets.spreadsheets.values.get({
            spreadsheetId: this.spreadsheetId,
            range: 'Words!A:K', // ✅ БЫЛО: A:J, СТАЛО: A:K
        });
        
        const rows = response.data.values || [];
        let rowIndex = -1;
        
        for (let i = 0; i < rows.length; i++) {
            if (rows[i][0] === userId.toString() && 
                rows[i][1].toLowerCase() === english.toLowerCase() && 
                (rows[i][9] === 'active' || !rows[i][9] || rows[i].length < 10)) {
                rowIndex = i + 1;
                break;
            }
        }

        if (rowIndex === -1) {
            console.error('❌ Word not found for adding meaning:', english);
            return false;
        }

        // Обновляем meanings
        await this.sheets.spreadsheets.values.update({
            spreadsheetId: this.spreadsheetId,
            range: `Words!E${rowIndex}`,
            valueInputOption: 'RAW',
            resource: {
                values: [[updatedMeaningsJSON]]
            }
        });

        // Инвалидируем кеш
        this.cache.delete(`words_${userId}`);

        console.log(`✅ Added new meaning to word "${english}"`);
        return true;
    } catch (error) {
        console.error('❌ Error adding meaning to word:', error.message);
        return false;
    }
}

    // ❗ СТАРЫЕ ФУНКЦИИ ДЛЯ ОБРАТНОЙ СОВМЕСТИМОСТИ
    async addWord(chatId, english, transcription, translation, audioUrl = '', examples = '') {
        // Конвертируем старый формат в новый
        const meanings = [{
            translation: translation,
            example: examples || '',
            partOfSpeech: '',
            definition: ''
        }];
        return await this.addWordWithMeanings(chatId, english, transcription, audioUrl, meanings);
    }

    async addWordWithExamples(chatId, english, transcription, translation, audioUrl = '', examples = '') {
        // Конвертируем старый формат в новый
        const meanings = [{
            translation: translation,
            example: examples || '',
            partOfSpeech: '',
            definition: ''
        }];
        return await this.addWordWithMeanings(chatId, english, transcription, audioUrl, meanings);
    }

    // ✅ ФУНКЦИЯ: Миграция старых данных в новый формат
    async migrateOldDataToNewFormat(userId) {
        if (!this.initialized) {
            return false;
        }
        
        try {
            console.log(`🔄 Starting migration for user ${userId}`);
            // Получаем все слова пользователя
            const userWords = await this.getUserWords(userId);
            
            let migratedCount = 0;
            
            for (const word of userWords) {
                // Проверяем, нужно ли мигрировать это слово
                if (word.meanings.length === 0 || 
                    (word.meanings.length === 1 && word.meanings[0].translation === 'Перевод не загружен')) {
                    
                    // Это слово с поврежденными данными, нужно исправить
                    console.log(`🔄 Migrating word: ${word.english}`);
                    
                    // Создаем правильную структуру meanings
                    const correctMeanings = [{
                        translation: 'Перевод требуется обновить',
                        example: '',
                        partOfSpeech: '',
                        definition: ''
                    }];
                    
                    const correctMeaningsJSON = JSON.stringify(correctMeanings);
                    
                    // Находим строку для обновления
                    const response = await this.sheets.spreadsheets.values.get({
                        spreadsheetId: this.spreadsheetId,
                        range: 'Words!A:J',
                    });
                    
                    const rows = response.data.values || [];
                    let rowIndex = -1;
                    
                    for (let i = 0; i < rows.length; i++) {
                        if (rows[i][0] === userId.toString() && 
                            rows[i][1].toLowerCase() === word.english.toLowerCase()) {
                            rowIndex = i + 1;
                            break;
                        }
                    }

                    if (rowIndex !== -1) {
                        // Обновляем meanings
                        await this.sheets.spreadsheets.values.update({
                            spreadsheetId: this.spreadsheetId,
                            range: `Words!E${rowIndex}`,
                            valueInputOption: 'RAW',
                            resource: {
                                values: [[correctMeaningsJSON]]
                            }
                        });
                        migratedCount++;
                    }
                }
            }
            
            // Инвалидируем кеш
            this.cache.delete(`words_${userId}`);
            
            console.log(`✅ Migration completed: ${migratedCount} words migrated`);
            return true;
        } catch (error) {
            console.error('❌ Error during migration:', error.message);
            return false;
        }
    }

    // ✅ ДОБАВИМ ФУНКЦИЮ для массового сброса прогресса
    async resetUserProgress(userId) {
        if (!this.initialized) {
            return false;
        }
        
        try {
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: 'Words!A:J',
            });
            
            const rows = response.data.values || [];
            let resetCount = 0;
            const updates = [];
            
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                if (row.length >= 9 && row[0] === userId.toString() && row[9] === 'active') {
                    // Обновляем интервал и дату следующего повторения
                    const nextReview = new Date().toISOString();
                    const interval = 1;
                    
                    updates.push({
                        range: `Words!G${i + 1}:I${i + 1}`,
                        values: [[nextReview, interval]]
                    });
                    
                    resetCount++;
                }
            }
            
            if (updates.length > 0) {
                // Выполняем все обновления одним запросом
                await this.sheets.spreadsheets.values.batchUpdate({
                    spreadsheetId: this.spreadsheetId,
                    resource: {
                        valueInputOption: 'RAW',
                        data: updates
                    }
                });
                
                // Инвалидируем кеш
                this.cache.delete(`words_${userId}`);
                this.cache.delete(`review_${userId}`);
            }
            
            console.log(`✅ Reset progress for user ${userId}: ${resetCount} words`);
            return true;
            
        } catch (error) {
            console.error('❌ Error resetting user progress:', error.message);
            return false;
        }
    }

    // ✅ НОВАЯ ФУНКЦИЯ: Получение всех активных пользователей (для нотификаций)
    async getAllActiveUsers() {
        if (!this.initialized) {
            return [];
        }

        const cacheKey = 'all_active_users';
        return this.getCachedData(cacheKey, async () => {
            try {
                const response = await this.sheets.spreadsheets.values.get({
                    spreadsheetId: this.spreadsheetId,
                    range: 'Words!A:J',
                });

                const rows = response.data.values || [];
                
                // Получаем уникальные ID пользователей
                const userSet = new Set();
                
                for (let i = 1; i < rows.length; i++) {
                    const row = rows[i];
                    if (row.length > 0 && row[0] && (row[9] === 'active' || !row[9] || row.length < 10)) {
                        userSet.add(row[0]);
                    }
                }
                
                return Array.from(userSet);
            } catch (error) {
                console.error('❌ Error getting all active users:', error.message);
                return [];
            }
        });
    }

    // ✅ НОВАЯ ФУНКЦИЯ: Получение данных для нескольких пользователей (для батчинга нотификаций)
    async getMultipleUsersWords(userIds) {
        if (!this.initialized) {
            return new Map();
        }

        try {
            // Оптимизированная загрузка данных для нескольких пользователей
            const userWordsMap = new Map();
            
            // Загружаем все данные одним запросом
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: 'Words!A:J',
            });

            const rows = response.data.values || [];
            
            // Создаем Set для быстрого поиска
            const userIdSet = new Set(userIds.map(id => id.toString()));
            
            // Фильтруем и группируем данные
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                if (row.length >= 6 && userIdSet.has(row[0]) && (row[9] === 'active' || !row[9] || row.length < 10)) {
                    const userId = row[0];
                    
                    if (!userWordsMap.has(userId)) {
                        userWordsMap.set(userId, []);
                    }
                    
                    const word = this.parseRowToWord(row);
                    userWordsMap.get(userId).push(word);
                }
            }
            
            console.log(`✅ Loaded data for ${userWordsMap.size} users`);
            return userWordsMap;
            
        } catch (error) {
            console.error('❌ Error getting multiple users words:', error.message);
            return new Map();
        }
    }

    // Вспомогательная функция для парсинга строки
    parseRowToWord(row) {
        const userId = row[0] || '';
        const english = row[1] || '';
        const transcription = row[2] || '';
        const audioUrl = row[3] || '';
        const meaningsJSON = row[4] || '[]';
        const createdDate = row[5] || new Date().toISOString();
        const lastReview = row[6] || '';
        const nextReview = row[7] || new Date().toISOString();
        const interval = parseInt(row[8]) || 1;
        const status = row[9] || 'active';

        let meanings = [];
        
        try {
            if (meaningsJSON && meaningsJSON.trim().startsWith('[')) {
                meanings = JSON.parse(meaningsJSON);
            } else if (meaningsJSON && meaningsJSON.trim().startsWith('{')) {
                meanings = [JSON.parse(meaningsJSON)];
            }
        } catch (parseError) {
            meanings = [{
                translation: 'Перевод не загружен',
                example: '',
                partOfSpeech: '',
                definition: ''
            }];
        }

        return {
            userId,
            english,
            transcription,
            audioUrl,
            meanings,
            createdDate,
            lastReview,
            nextReview,
            interval,
            status
        };
    }

    // Запускаем очистку кеша при инициализации
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
                console.log(`🧹 Cache cleanup: removed ${cleanedCount} expired entries`);
            }
        }, 5 * 60 * 1000); // Каждые 5 минут
    }

async migrateFirstLearnedDates(userId) {
    if (!this.initialized) {
        console.error('❌ Google Sheets not initialized');
        return false;
    }
    
    try {
        console.log(`🔄 Starting detailed FirstLearnedDate migration for user ${userId}`);
        
        // Сначала проверим заголовки
        const headersResponse = await this.sheets.spreadsheets.values.get({
            spreadsheetId: this.spreadsheetId,
            range: 'Words!A1:K1',
        });
        
        const headers = headersResponse.data.values ? headersResponse.data.values[0] : [];
        console.log('📋 Headers:', headers);
        console.log('🔍 Looking for FirstLearnedDate at index 10 (column K)');
        
        const response = await this.sheets.spreadsheets.values.get({
            spreadsheetId: this.spreadsheetId,
            range: 'Words!A:K',
        });
        
        console.log(`📊 Total rows: ${response.data.values ? response.data.values.length : 0}`);
        
        const rows = response.data.values || [];
        const updates = [];
        let migratedCount = 0;
        let userWordCount = 0;
        
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            
            if (!row) {
                console.log(`⏭️ Row ${i}: empty row`);
                continue;
            }
            
            console.log(`\n🔍 Row ${i}: UserID=${row[0]}, Word=${row[1]}, Columns=${row.length}`);
            
            // Проверяем принадлежит ли слово пользователю
            if (row[0] === userId.toString()) {
                userWordCount++;
                
                if (row.length < 11) {
                    console.log(`⏭️ Insufficient columns: ${row.length}, need 11`);
                    continue;
                }
                
                const interval = parseInt(row[8]) || 1;
                const lastReview = row[6] || '';
                const currentFirstLearnedDate = row[10] || '';
                
                console.log(`📝 Details: interval=${interval}, lastReview=${lastReview}, currentFirstLearnedDate="${currentFirstLearnedDate}"`);
                
                // Условия для миграции
                const isLearned = interval > 1;
                const needsMigration = !currentFirstLearnedDate || currentFirstLearnedDate === '';
                const hasLastReview = lastReview && lastReview.trim() !== '';
                
                console.log(`🎯 Conditions: isLearned=${isLearned}, needsMigration=${needsMigration}, hasLastReview=${hasLastReview}`);
                
                if (isLearned && needsMigration && hasLastReview) {
                    console.log(`✅ WILL MIGRATE: ${row[1]} - setting FirstLearnedDate to: ${lastReview}`);
                    updates.push({
                        range: `Words!K${i + 1}`,
                        values: [[lastReview]]
                    });
                    migratedCount++;
                } else {
                    console.log(`⏭️ SKIPPING: conditions not met`);
                }
            }
        }
        
        console.log(`\n📊 SUMMARY: User words: ${userWordCount}, To migrate: ${migratedCount}`);
        
        if (updates.length > 0) {
            console.log(`🔄 Executing ${updates.length} updates...`);
            
            // Выполняем обновления
            const result = await this.sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: this.spreadsheetId,
                resource: {
                    valueInputOption: 'RAW',
                    data: updates
                }
            });
            
            console.log('✅ Batch update result:', result.status);
            
            // Инвалидируем кеш
            this.cache.delete(`words_${userId}`);
            
            console.log(`🎉 FirstLearnedDate migration COMPLETED: ${migratedCount} words updated`);
            return true;
        } else {
            console.log('ℹ️ No words need FirstLearnedDate migration');
            return true;
        }
        
    } catch (error) {
        console.error('❌ CRITICAL ERROR in migrateFirstLearnedDates:', error);
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
        return false;
    }
}
    
}

// Запускаем сервис при импорте
const sheetsService = new GoogleSheetsService();
sheetsService.startCacheCleanup();














