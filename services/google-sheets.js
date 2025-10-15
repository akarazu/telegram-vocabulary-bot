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
            
            const response = await this.sheets.spreadsheets.values.append({
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
                        examples || ''
                    ]]
                }
            });

            console.log(`✅ Word "${english}" saved to Google Sheets`);
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
                examples: row[5] || ''
            }));
        } catch (error) {
            console.error('❌ Error reading words from Google Sheets:', error.message);
            return [];
        }
    }

    // ✅ УПРОЩЕННЫЙ МЕТОД: Просто сохраняем слово с примерами сразу
    async addWordWithExamples(chatId, english, transcription, translation, audioUrl = '', examples = []) {
        if (!this.initialized) {
            console.log('❌ Google Sheets not initialized');
            return false;
        }

        try {
            const examplesText = examples.join(' | ');
            
            const response = await this.sheets.spreadsheets.values.append({
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
                        examplesText
                    ]]
                }
            });

            console.log(`✅ Word "${english}" saved with examples to Google Sheets`);
            return true;
        } catch (error) {
            console.error('❌ Error saving word with examples to Google Sheets:', error.message);
            return false;
        }
    }
}
