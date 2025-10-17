import { google } from 'googleapis';

export class GoogleSheetsService {
    constructor() {
        this.initialized = false;
        this.sheets = null;
        // Используем правильное название переменной из Railway
        this.spreadsheetId = process.env.GOOGLE_SHEET_ID;
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
            // Используем переменные окружения вместо файла
            const auth = new google.auth.GoogleAuth({
                credentials: this.getCredentialsFromEnv(),
                scopes: ['https://www.googleapis.com/auth/spreadsheets'],
            });

            this.sheets = google.sheets({ version: 'v4', auth });

            // Проверяем и создаем таблицу с новой структурой
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

    async initializeSheetStructure() {
        try {
            // Получаем информацию о листаов
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

                // Добавляем заголовки
                await this.sheets.spreadsheets.values.update({
                    spreadsheetId: this.spreadsheetId,
                    range: 'Words!A1:I1',
                    valueInputOption: 'RAW',
                    resource: {
                        values: [[
                            'UserID',
                            'English',
                            'Transcription',
                            'AudioURL',
                            'MeaningsJSON',
                            'CreatedDate',
                            'NextReview',
                            'Interval',
                            'Status'
                        ]]
                    }
                });
                console.log('✅ Created new Words sheet with JSON structure');
            } else {
                console.log('✅ Words sheet already exists');
            }
        } catch (error) {
            console.error('❌ Error initializing sheet structure:', error.message);
        }
    }

    // ✅ НОВАЯ ФУНКЦИЯ: Сохранение слова с несколькими значениями в JSON
    async addWordWithMeanings(userId, english, transcription, audioUrl, meanings) {
        if (!this.initialized) {
            console.log('❌ Google Sheets not initialized');
            return false;
        }

        try {
            // Преобразуем массив значений в JSON строку
            const meaningsJSON = JSON.stringify(meanings);

            // Рассчитываем дату следующего повторения (через 1 день)
            const nextReview = new Date();
            nextReview.setDate(nextReview.getDate() + 1);

            const response = await this.sheets.spreadsheets.values.append({
                spreadsheetId: this.spreadsheetId,
                range: 'Words!A:I',
                valueInputOption: 'RAW',
                requestBody: {
                    values: [[
                        userId.toString(),
                        english.toLowerCase(),
                        transcription || '',
                        audioUrl || '', // AudioURL в столбце D
                        meaningsJSON,   // MeaningsJSON в столбце E
                        new Date().toISOString(),
                        nextReview.toISOString(),
                        1, // начальный интервал (в днях)
                        'active'
                    ]]
                }
            });

            console.log(`✅ Word "${english}" saved with ${meanings.length} meanings to Google Sheets`);
            return true;
        } catch (error) {
            console.error('❌ Error saving word with meanings to Google Sheets:', error.message);
            return false;
        }
    }

    // ✅ ИСПРАВЛЕННАЯ ФУНКЦИЯ: Получение слов пользователя с обработкой ошибок JSON
    async getUserWords(userId) {
        if (!this.initialized) {
            return [];
        }

        try {
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: 'Words!A:I',
            });

            const rows = response.data.values || [];

            // Пропускаем заголовок и фильтруем по UserID и статусу
            const userWords = rows.slice(1).filter(row => 
                row.length >= 6 && // Проверяем что есть минимум 6 столбцов
                row[0] === userId.toString() && 
                (row[8] === 'active' || !row[8] || row.length < 9) // поддерживаем старые записи без статуса
            );

            return userWords.map(row => {
                // Безопасное извлечение данных из строки
                const userId = row[0] || '';
                const english = row[1] || '';
                const transcription = row[2] || '';
                const audioUrl = row[3] || '';
                const meaningsJSON = row[4] || '[]';
                const createdDate = row[5] || new Date().toISOString();
                const nextReview = row[6] || new Date().toISOString();
                const interval = parseInt(row[7]) || 1;
                const status = row[8] || 'active';

                let meanings = [];
                
                try {
                    // Проверяем, является ли meaningsJSON валидным JSON
                    if (meaningsJSON && meaningsJSON.trim().startsWith('[')) {
                        meanings = JSON.parse(meaningsJSON);
                    } else if (meaningsJSON && meaningsJSON.trim().startsWith('{')) {
                        // Если это объект, оборачиваем в массив
                        meanings = [JSON.parse(meaningsJSON)];
                    } else {
                        // Если это не JSON, создаем fallback значение
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
                    console.log(`📝 Problematic JSON:`, meaningsJSON.substring(0, 100));
                    
                    // Fallback: создаем базовую структуру
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
                    nextReview,
                    interval,
                    status
                };
            });
        } catch (error) {
            console.error('❌ Error reading words from Google Sheets:', error.message);
            return [];
        }
    }

    // ✅ ФУНКЦИЯ: Получение слов для повторения с FSRS данными
    async getWordsForReview(userId) {
        if (!this.initialized) {
            return [];
        }
        
        try {
            const userWords = await this.getUserWords(userId);
            const now = new Date();
            
            return userWords.filter(word => {
                if (!word.nextReview || word.status !== 'active') return false;
                try {
                    const reviewDate = new Date(word.nextReview);
                    return reviewDate <= now;
                } catch (dateError) {
                    console.error(`❌ Invalid date for word "${word.english}":`, word.nextReview);
                    return false;
                }
            });
        } catch (error) {
            console.error('❌ Error getting words for review:', error.message);
            return [];
        }
    }

    // ✅ ФУНКЦИЯ: Обновление карточки после повторения
    async updateCardAfterReview(userId, english, fsrsData, rating) {
        if (!this.initialized) {
            return false;
        }
        
        try {
            // Находим строку для обновления
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: 'Words!A:I',
            });
            
            const rows = response.data.values || [];
            let rowIndex = -1;
            
            for (let i = 0; i < rows.length; i++) {
                if (rows[i][0] === userId.toString() && 
                    rows[i][1].toLowerCase() === english.toLowerCase() && 
                    (rows[i][8] === 'active' || !rows[i][8] || rows[i].length < 9)) {
                    rowIndex = i + 1;
                    break;
                }
            }

            if (rowIndex === -1) {
                console.error('❌ Word not found for review update:', english);
                return false;
            }

            // Обновляем интервал и дату следующего повторения
            await this.sheets.spreadsheets.values.update({
                spreadsheetId: this.spreadsheetId,
                range: `Words!G${rowIndex}:I${rowIndex}`,
                valueInputOption: 'RAW',
                resource: {
                    values: [[
                        fsrsData.card.interval || 1,
                        fsrsData.card.due.toISOString(),
                        'active'
                    ]]
                }
            });

            console.log(`✅ Updated FSRS data for word "${english}": ${rating}, next review in ${fsrsData.card.interval} days`);
            return true;
        } catch (error) {
            console.error('❌ Error updating card after review:', error.message);
            return false;
        }
    }

    // ✅ ФУНКЦИЯ: Обновление интервала повторения
    async updateWordReview(userId, english, newInterval, nextReviewDate) {
        if (!this.initialized) {
            return false;
        }
        
        try {
            // Сначала находим строку для обновления
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: 'Words!A:I',
            });
            
            const rows = response.data.values || [];
            let rowIndex = -1;
            
            for (let i = 0; i < rows.length; i++) {
                if (rows[i][0] === userId.toString() && 
                    rows[i][1].toLowerCase() === english.toLowerCase() && 
                    (rows[i][8] === 'active' || !rows[i][8] || rows[i].length < 9)) {
                    rowIndex = i + 1;
                    break;
                }
            }

            if (rowIndex === -1) {
                console.error('❌ Word not found for update:', english);
                return false;
            }

            // Обновляем интервал и дату следующего повторения
            await this.sheets.spreadsheets.values.update({
                spreadsheetId: this.spreadsheetId,
                range: `Words!H${rowIndex}:I${rowIndex}`,
                valueInputOption: 'RAW',
                resource: {
                    values: [[
                        newInterval,
                        nextReviewDate.toISOString()
                    ]]
                }
            });

            console.log(`✅ Updated review for word "${english}": interval ${newInterval} days`);
            return true;
        } catch (error) {
            console.error('❌ Error updating word review:', error.message);
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

            // Находим строку для обновления
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: 'Words!A:I',
            });
            
            const rows = response.data.values || [];
            let rowIndex = -1;
            
            for (let i = 0; i < rows.length; i++) {
                if (rows[i][0] === userId.toString() && 
                    rows[i][1].toLowerCase() === english.toLowerCase() && 
                    (rows[i][8] === 'active' || !rows[i][8] || rows[i].length < 9)) {
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
                        range: 'Words!A:I',
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
            
            console.log(`✅ Migration completed: ${migratedCount} words migrated`);
            return true;
        } catch (error) {
            console.error('❌ Error during migration:', error.message);
            return false;
        }
    }
}
