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

    async addWord(chatId, english, transcription, translation, audioUrl = '', examples = '') {
        if (!this.initialized) {
            console.log('❌ Google Sheets not initialized');
            return false;
        }

        try {
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

    async addWordWithExamples(chatId, english, transcription, translation, audioUrl = '', examples = '') {
        if (!this.initialized) {
            console.log('❌ Google Sheets not initialized');
            return false;
        }

        try {
            // examples уже должна быть строкой
            const examplesText = typeof examples === 'string' ? examples : '';
            
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
