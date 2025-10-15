// services/google-sheets.js
import { google } from 'googleapis';

export class GoogleSheetsService {
    constructor() {
        this.sheetId = process.env.GOOGLE_SHEET_ID;
        this.initialized = false;
        this.init();
    }

    async init() {
        try {
            if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
                console.error('❌ Google Sheets credentials not found');
                return;
            }

            this.auth = new google.auth.GoogleAuth({
                credentials: {
                    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
                    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
                },
                scopes: ['https://www.googleapis.com/auth/spreadsheets'],
            });
            
            this.sheets = google.sheets({ version: 'v4', auth: this.auth });
            this.initialized = true;
            console.log('✅ Google Sheets initialized successfully');
        } catch (error) {
            console.error('❌ Google Sheets initialization failed:', error.message);
        }
    }

    async addWord(chatId, englishWord, transcription, translation, audioUrl) {
        if (!this.initialized) {
            console.error('Google Sheets not initialized');
            return false;
        }

        try {
            await this.sheets.spreadsheets.values.append({
                spreadsheetId: this.sheetId,
                range: 'Words!A:F',
                valueInputOption: 'RAW',
                requestBody: {
                    values: [[
                        chatId.toString(),
                        englishWord,
                        transcription || '',
                        translation,
                        audioUrl || '',
                        new Date().toISOString()
                    ]]
                }
            });
            console.log('✅ Word added to sheet:', englishWord);
            return true;
        } catch (error) {
            console.error('❌ Error adding word to sheet:', error.message);
            return false;
        }
    }

    async getUserWords(chatId) {
        if (!this.initialized) {
            console.error('Google Sheets not initialized');
            return [];
        }

        try {
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.sheetId,
                range: 'Words!A:F',
            });

            const rows = response.data.values || [];
            
            if (rows.length === 0) return [];
            
            // Пропускаем заголовок (если есть) и фильтруем по chat_id
            const startIndex = rows[0][0] === 'chat_id' ? 1 : 0;
            const userWords = rows.slice(startIndex)
                .filter(row => row[0] === chatId.toString())
                .map(row => ({
                    english: row[1] || '',
                    transcription: row[2] || '',
                    translation: row[3] || '',
                    audio: row[4] || ''
                }));
                
            console.log(`✅ Found ${userWords.length} words for user ${chatId}`);
            return userWords;
        } catch (error) {
            console.error('❌ Error getting user words from sheet:', error.message);
            return [];
        }
    }
}
