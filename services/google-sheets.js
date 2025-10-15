import { google } from 'googleapis';

export class GoogleSheetsService {
    constructor() {
        this.initialized = false;
        this.sheets = null;
        this.spreadsheetId = process.env.GOOGLE_SHEETS_ID;
        
        // Получаем credentials из переменных окружения
        this.credentials = this.getCredentialsFromEnv();
        
        this.init();
    }

    getCredentialsFromEnv() {
        try {
            // Вариант 1: Если credentials в виде JSON строки
            if (process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS) {
                return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS);
            }
            // Вариант 2: Если отдельные переменные
            else if (process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
                return {
                    type: 'service_account',
                    project_id: process.env.GOOGLE_PROJECT_ID,
                    private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
                    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
                    client_email: process.env.GOOGLE_CLIENT_EMAIL,
                    client_id: process.env.GOOGLE_CLIENT_ID,
                    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
                    token_uri: 'https://oauth2.googleapis.com/token',
                    auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs'
                };
            }
            return null;
        } catch (error) {
            console.error('❌ Error parsing Google credentials:', error);
            return null;
        }
    }

    async init() {
        if (!this.spreadsheetId) {
            console.error('❌ GOOGLE_SHEETS_ID is required');
            this.initialized = false;
            return;
        }

        if (!this.credentials) {
            console.error('❌ Google credentials not found in environment variables');
            this.initialized = false;
            return;
        }

        try {
            const auth = new google.auth.GoogleAuth({
                credentials: this.credentials,
                scopes: ['https://www.googleapis.com/auth/spreadsheets'],
            });

            this.sheets = google.sheets({ version: 'v4', auth });
            
            // Проверяем подключение
            await this.testConnection();
            
            this.initialized = true;
            console.log('✅ Google Sheets service initialized');
        } catch (error) {
            console.error('❌ Google Sheets initialization failed:', error.message);
            this.initialized = false;
        }
    }

    async testConnection() {
        try {
            await this.sheets.spreadsheets.get({
                spreadsheetId: this.spreadsheetId,
            });
            console.log('✅ Successfully connected to Google Sheets');
        } catch (error) {
            throw new Error(`Cannot access spreadsheet: ${error.message}`);
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
                range: 'Words!A:G', // Добавляем колонку для timestamp
                valueInputOption: 'RAW',
                requestBody: {
                    values: [[
                        chatId.toString(),
                        english.toLowerCase(),
                        transcription || '',
                        translation,
                        audioUrl || '',
                        examples || '',
                        timestamp
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
                range: 'Words!A:G',
            });

            const rows = response.data.values || [];
            const userWords = rows.filter(row => row[0] === chatId.toString());
            
            return userWords.map(row => ({
                chatId: row[0],
                english: row[1],
                transcription: row[2],
                translation: row[3],
                audioUrl: row[4],
                examples: row[5] || '',
                timestamp: row[6] || ''
            }));
        } catch (error) {
            console.error('❌ Error reading words from Google Sheets:', error.message);
            return [];
        }
    }

    async addWordWithExamples(chatId, english, transcription, translation, audioUrl = '', examples = []) {
        if (!this.initialized) {
            console.log('❌ Google Sheets not initialized');
            return false;
        }

        try {
            const examplesText = Array.isArray(examples) ? examples.join(' | ') : examples;
            const timestamp = new Date().toISOString();
            
            const response = await this.sheets.spreadsheets.values.append({
                spreadsheetId: this.spreadsheetId,
                range: 'Words!A:G',
                valueInputOption: 'RAW',
                requestBody: {
                    values: [[
                        chatId.toString(),
                        english.toLowerCase(),
                        transcription || '',
                        translation,
                        audioUrl || '',
                        examplesText,
                        timestamp
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
