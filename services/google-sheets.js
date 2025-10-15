import { google } from 'googleapis';

export class GoogleSheetsService {
    constructor() {
        this.initialized = false;
        this.sheets = null;
        this.spreadsheetId = process.env.GOOGLE_SHEETS_ID;
        this.init();
    }

    async init() {
        try {
            const auth = new google.auth.GoogleAuth({
                keyFile: 'credentials.json',
                scopes: ['https://www.googleapis.com/auth/spreadsheets'],
            });

            this.sheets = google.sheets({ version: 'v4', auth });
            this.initialized = true;
            console.log('✅ Google Sheets service initialized');
        } catch (error) {
            console.error('❌ Google Sheets initialization failed:', error.message);
            this.initialized = false;
        }
    }

    async addWord(chatId, english, transcription, translation, audioUrl = '', examples = '') {
        if (!this.initialized) {
            console.log('❌ Google Sheets not initialized');
            return false;
        }

        try {
            const timestamp = new Date().toISOString();
            
            await this.sheets.spreadsheets.values.append({
                spreadsheetId: this.spreadsheetId,
                range: 'Words!A:F',
                valueInputOption: 'RAW',
                requestBody: {
                    values: [[
                        chatId.toString(),
                        english.toLowerCase(),
                        transcription || '',
                        translation,
                        audioUrl || '',
                        examples || ''  // ✅ Сохраняем примеры в отдельной колонке
                    ]]
                }
            });

            console.log(`✅ Word "${english}" saved to Google Sheets with examples`);
            return true;
        } catch (error) {
            console.error('❌ Error saving word to Google Sheets:', error.message);
            return false;
        }
    }

    async getUserWords(chatId) {
        if (!this.initialized) {
            return [];
        }

        try {
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: 'Words!A:F',
            });

            const rows = response.data.values || [];
            const userWords = rows.filter(row => row[0] === chatId.toString());
            
            return userWords.map(row => ({
                chatId: row[0],
                english: row[1],
                transcription: row[2],
                translation: row[3],
                audioUrl: row[4],
                examples: row[5] || ''  // ✅ Получаем примеры из таблицы
            }));
        } catch (error) {
            console.error('❌ Error reading words from Google Sheets:', error.message);
            return [];
        }
    }

    // ✅ НОВЫЙ МЕТОД: Обновление примеров для существующего слова
    async updateWordExamples(chatId, englishWord, examples) {
        if (!this.initialized) {
            console.log('❌ Google Sheets not initialized');
            return false;
        }

        try {
            // Сначала находим строку с словом
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: 'Words!A:F',
            });

            const rows = response.data.values || [];
            let rowIndex = -1;

            for (let i = 0; i < rows.length; i++) {
                if (rows[i][0] === chatId.toString() && 
                    rows[i][1].toLowerCase() === englishWord.toLowerCase()) {
                    rowIndex = i + 1; // +1 потому что в Sheets нумерация с 1
                    break;
                }
            }

            if (rowIndex === -1) {
                console.log(`❌ Word "${englishWord}" not found for user ${chatId}`);
                return false;
            }

            // Обновляем только колонку с примерами (колонка F)
            await this.sheets.spreadsheets.values.update({
                spreadsheetId: this.spreadsheetId,
                range: `Words!F${rowIndex}`,
                valueInputOption: 'RAW',
                requestBody: {
                    values: [[examples]]
                }
            });

            console.log(`✅ Examples updated for word "${englishWord}"`);
            return true;
        } catch (error) {
            console.error('❌ Error updating examples in Google Sheets:', error.message);
            return false;
        }
    }
}
