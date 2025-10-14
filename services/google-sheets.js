import { google } from 'googleapis';

export class GoogleSheetsService {
    constructor() {
        try {
            console.log('🔧 Initializing Google Sheets...');
            
            // ДЕБАГ: Выведем все переменные для проверки
            console.log('📋 Sheet ID from env:', process.env.GOOGLE_SHEET_ID);
            console.log('📧 Client Email:', process.env.GOOGLE_CLIENT_EMAIL);
            console.log('🆔 Project ID:', process.env.GOOGLE_PROJECT_ID);
            
            if (!process.env.GOOGLE_SHEET_ID) {
                throw new Error('GOOGLE_SHEET_ID is missing');
            }
            if (!process.env.GOOGLE_CLIENT_EMAIL) {
                throw new Error('GOOGLE_CLIENT_EMAIL is missing');
            }

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
            this.spreadsheetId = process.env.GOOGLE_SHEET_ID; // Теперь точно будет
            
            console.log('✅ Google Sheets service initialized successfully');
            console.log('📋 Using Sheet ID:', this.spreadsheetId);
            
        } catch (error) {
            console.error('❌ Error initializing Google Sheets:', error.message);
            throw error; // Пробрасываем ошибку дальше
        }
    }

    async addWord(userId, word, translation) {
        try {
            console.log(`📝 Adding word to sheet: "${word}" -> "${translation}"`);
            console.log(`📋 Sheet ID: ${this.spreadsheetId}`);
            
            const response = await this.sheets.spreadsheets.values.append({
                spreadsheetId: this.spreadsheetId,
                range: 'Words!A:D',
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
            
            console.log('✅ Word successfully added to Google Sheets');
            return true;
            
        } catch (error) {
            console.error('❌ Google Sheets Error:');
            console.error('   Message:', error.message);
            console.error('   Code:', error.code);
            if (error.response) {
                console.error('   Status:', error.response.status);
                console.error('   Data:', error.response.data);
            }
            return false;
        }
    }
}
