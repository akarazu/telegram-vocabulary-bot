import { google } from 'googleapis';

export class GoogleSheetsService {
    constructor() {
        this.auth = new google.auth.GoogleAuth({
            credentials: {
                type: 'service_account',
                project_id: process.env.GOOGLE_PROJECT_ID,
                private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
                private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
                client_email: process.env.GOOGLE_CLIENT_EMAIL,
                client_id: process.env.GOOGLE_CLIENT_ID,
            },
            scopes: ['https://www.googleapis.com/auth/spreadsheets']
        });

        this.sheets = google.sheets({ version: 'v4', auth: this.auth });
        this.spreadsheetId = process.env.GOOGLE_SHEET_ID;
        this.initialized = true;
    }

    async addWord(userId, word, transcription, translation, audioUrl = '') {
        try {
            await this.sheets.spreadsheets.values.append({
                spreadsheetId: this.spreadsheetId,
                range: 'A:F',
                valueInputOption: 'RAW',
                requestBody: {
                    values: [[
                        userId.toString(),
                        word,
                        transcription,
                        translation,
                        audioUrl,
                        new Date().toISOString()
                    ]]
                }
            });
            return true;
        } catch (error) {
            console.error('Sheets error:', error.message);
            return false;
        }
    }

    // ✅ ДОБАВЛЯЕМ МЕТОД ДЛЯ ПОЛУЧЕНИЯ СЛОВ ПОЛЬЗОВАТЕЛЯ
    async getUserWords(userId) {
        try {
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: 'A:F',
            });

            const rows = response.data.values || [];
            
            if (rows.length === 0) return [];
            
            // Пропускаем заголовок (если есть) и фильтруем по userId
            const startIndex = rows[0][0] === 'chat_id' || rows[0][0] === 'user_id' ? 1 : 0;
            const userWords = rows.slice(startIndex)
                .filter(row => row[0] === userId.toString())
                .map(row => ({
                    english: row[1] || '',
                    transcription: row[2] || '',
                    translation: row[3] || '',
                    audio: row[4] || ''
                }));
                
            console.log(`✅ Found ${userWords.length} words for user ${userId}`);
            return userWords;
        } catch (error) {
            console.error('Error getting user words from sheet:', error.message);
            return [];
        }
    }
}
