import { google } from 'googleapis';

export class GoogleSheetsService {
    constructor() {
        this.sheetId = process.env.GOOGLE_SHEET_ID;
        
        // Проверяем что переменные окружения существуют
        if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
            console.error('Google Sheets credentials not found in environment variables');
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
    }

    async addWord(chatId, englishWord, transcription, translation, audioUrl) {
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
            return true;
        } catch (error) {
            console.error('Error adding word to sheet:', error);
            return false;
        }
    }

    async getUserWords(chatId) {
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
                
            return userWords;
        } catch (error) {
            console.error('Error getting user words from sheet:', error);
            return [];
        }
    }
}
