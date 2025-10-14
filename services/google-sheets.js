import { google } from 'googleapis';

export class GoogleSheetsService {
    constructor() {
        try {
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
            
            console.log('✅ Google Sheets service initialized');
        } catch (error) {
            console.error('❌ Error initializing Google Sheets:', error);
        }
    }

    async addWord(userId, word, translation) {
        try {
            console.log(`📝 Adding word: ${userId}, ${word}, ${translation}`);
            
            const response = await this.sheets.spreadsheets.values.append({
                spreadsheetId: this.spreadsheetId,
                range: 'A:D', // Просто диапазон без имени листа
                valueInputOption: 'RAW',
                requestBody: {
                    values: [[
                        userId.toString(),
                        word,
                        translation,
                        new Date().toISOString()
                    ]]
                }
            });
            
            console.log('✅ Word added successfully');
            return true;
        } catch (error) {
            console.error('❌ Error adding word:', error.response?.data || error.message);
            return false;
        }
    }
}
