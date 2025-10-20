import { google } from 'googleapis';

export class GoogleSheetsService {
    constructor() {
        this.initialized = false;
        this.sheets = null;
        this.spreadsheetId = process.env.GOOGLE_SHEET_ID;
        this.cache = new Map();
        this.CACHE_TTL = 2 * 60 * 1000; // 2 минуты

        console.log('🔧 GoogleSheetsService - Spreadsheet ID:', this.spreadsheetId ? 'SET' : 'NOT SET');
        if (!this.spreadsheetId) console.error('❌ GOOGLE_SHEET_ID is not set');
        this.init();
    }

    async init() {
        if (!this.spreadsheetId) return;

        try {
            console.log('🔄 Initializing Google Sheets...');
            const auth = new google.auth.GoogleAuth({
                credentials: this.getCredentialsFromEnv(),
                scopes: ['https://www.googleapis.com/auth/spreadsheets'],
            });

            this.sheets = google.sheets({ version: 'v4', auth });
            await this.initializeSheetStructure();
            this.initialized = true;
            console.log('✅ Google Sheets initialized');
        } catch (e) {
            console.error('❌ Google Sheets init failed:', e.message);
        }
    }

    getCredentialsFromEnv() {
        try {
            if (process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS) {
                return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS);
            }
            if (process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
                return {
                    type: 'service_account',
                    project_id: process.env.GOOGLE_PROJECT_ID || 'default-project',
                    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
                    client_email: process.env.GOOGLE_CLIENT_EMAIL,
                    client_id: process.env.GOOGLE_CLIENT_ID || 'default-client-id',
                    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
                    token_uri: 'https://oauth2.googleapis.com/token',
                    auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs'
                };
            }
            console.error('❌ No Google credentials found');
            return null;
        } catch (e) {
            console.error('❌ Error parsing credentials:', e);
            return null;
        }
    }

    async getCachedData(cacheKey, fetchFn) {
        const cached = this.cache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) return cached.data;
        const data = await fetchFn();
        this.cache.set(cacheKey, { data, timestamp: Date.now() });
        return data;
    }

    startCacheCleanup() {
        setInterval(() => {
            const now = Date.now();
            for (const [key, val] of this.cache.entries()) {
                if (now - val.timestamp > this.CACHE_TTL) this.cache.delete(key);
            }
        }, 5 * 60 * 1000);
    }

    async initializeSheetStructure() {
        try {
            const spreadsheet = await this.sheets.spreadsheets.get({ spreadsheetId: this.spreadsheetId });
            const sheets = spreadsheet.data.sheets;
            const wordsSheet = sheets.find(s => s.properties.title === 'Words');

            if (!wordsSheet) {
                await this.sheets.spreadsheets.batchUpdate({
                    spreadsheetId: this.spreadsheetId,
                    resource: { requests: [{ addSheet: { properties: { title: 'Words' } } }] }
                });

                await this.sheets.spreadsheets.values.update({
                    spreadsheetId: this.spreadsheetId,
                    range: 'Words!A1:O1',
                    valueInputOption: 'RAW',
                    resource: { values: [[
                        'UserID','Word','Transcription','AudioURL','Data','Date','LastReview','NextReview','Interval','Status','FirstLearnedDate','Ease','Repetitions','Rating'
                    ]] }
                });

                console.log('✅ Words sheet created with advanced columns');
            }
        } catch (e) {
            console.error('❌ Error initializing sheet structure:', e.message);
        }
    }

    // ======================= Add Word =======================
    async addWordWithMeanings(userId, english, transcription, audioUrl, meanings) {
        if (!this.initialized) return false;
        try {
            const meaningsJSON = JSON.stringify(meanings);
            const now = new Date();
            const nextReview = new Date();
            nextReview.setDate(nextReview.getDate() + 1);

            await this.sheets.spreadsheets.values.append({
                spreadsheetId: this.spreadsheetId,
                range: 'Words!A:O',
                valueInputOption: 'RAW',
                requestBody: {
                    values: [[
                        userId.toString(),
                        english.toLowerCase(),
                        transcription || '',
                        audioUrl || '',
                        meaningsJSON,
                        now.toISOString(),
                        '',
                        nextReview.toISOString(),
                        1,
                        'active',
                        '',
                        2.5,
                        0,
                        0
                    ]]
                }
            });

            this.cache.delete(`words_${userId}`);
            return true;
        } catch (e) {
            console.error('❌ Error saving word:', e.message);
            return false;
        }
    }

    // ======================= Get User Words =======================
    async getUserWords(userId) {
        if (!this.initialized) return [];
        const cacheKey = `words_${userId}`;
        return this.getCachedData(cacheKey, async () => {
            try {
                const response = await this.sheets.spreadsheets.values.get({
                    spreadsheetId: this.spreadsheetId,
                    range: 'Words!A:O'
                });

                const rows = response.data.values || [];
                return rows.slice(1).filter(row => row[0] === userId.toString() && (row[9] === 'active' || !row[9])).map(row => ({
                    userId: row[0],
                    english: row[1],
                    transcription: row[2],
                    audioUrl: row[3],
                    meanings: row[4] ? JSON.parse(row[4]) : [],
                    createdDate: row[5],
                    lastReview: row[6],
                    nextReview: row[7],
                    interval: parseInt(row[8]) || 1,
                    status: row[9],
                    firstLearnedDate: row[10],
                    ease: parseFloat(row[11]) || 2.5,
                    repetitions: parseInt(row[12]) || 0,
                    rating: parseFloat(row[13]) || 0
                }));
            } catch (e) {
                console.error('❌ Error reading words:', e.message);
                return [];
            }
        });
    }

    // ======================= Update Word After Review =======================
    async updateWordReview(userId, english, fsrsData, rating) {
        if (!this.initialized) return false;
        try {
            const userWords = await this.getUserWords(userId);
            const currentWord = userWords.find(w => w.english.toLowerCase() === english.toLowerCase());
            if (!currentWord) return false;

            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: 'Words!A:O'
            });

            const rows = response.data.values || [];
            let rowIndex = rows.findIndex(row => row[0] === userId.toString() && row[1].toLowerCase() === english.toLowerCase()) + 1;
            if (rowIndex === 0) return false;

            const firstLearnedDate = currentWord.firstLearnedDate || (fsrsData.card.interval > 1 ? new Date().toISOString() : '');

            await this.sheets.spreadsheets.values.update({
                spreadsheetId: this.spreadsheetId,
                range: `Words!G${rowIndex}:O${rowIndex}`,
                valueInputOption: 'RAW',
                resource: {
                    values: [[
                        new Date().toISOString(),          // LastReview
                        fsrsData.card.due.toISOString(),   // NextReview
                        fsrsData.card.interval.toString(), // Interval
                        'active',                          // Status
                        firstLearnedDate,                  // FirstLearnedDate
                        fsrsData.card.ease.toFixed(2),     // Ease
                        fsrsData.card.repetitions.toString(), // Repetitions
                        rating                              // Rating
                    ]]
                }
            });

            this.cache.delete(`words_${userId}`);
            this.cache.delete(`review_${userId}`);
            return true;
        } catch (e) {
            console.error('❌ Error updating word:', e.message);
            return false;
        }
    }

    // ======================= Get Words For Review =======================
    async getWordsForReview(userId) {
        const words = await this.getUserWords(userId);
        const now = new Date();
        return words.filter(w => w.status === 'active' && w.nextReview && new Date(w.nextReview) <= now);
    }

    // ======================= Batch Update =======================
    async batchUpdateWords(userId, updatesData) {
        if (!this.initialized) return false;
        try {
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: 'Words!A:O'
            });

            const rows = response.data.values || [];
            const updates = [];

            for (const { english, data } of updatesData) {
                const rowIndex = rows.findIndex(row => row[0] === userId.toString() && row[1].toLowerCase() === english.toLowerCase()) + 1;
                if (rowIndex === 0) continue;

                updates.push({
                    range: `Words!G${rowIndex}:O${rowIndex}`,
                    values: [[
                        data.lastReview.toISOString(),
                        data.nextReview.toISOString(),
                        data.interval.toString(),
                        'active',
                        data.firstLearnedDate || '',
                        data.ease.toFixed(2),
                        data.repetitions.toString(),
                        data.rating
                    ]]
                });
            }

            if (updates.length > 0) {
                await this.sheets.spreadsheets.values.batchUpdate({
                    spreadsheetId: this.spreadsheetId,
                    resource: { valueInputOption: 'RAW', data: updates }
                });
                this.cache.delete(`words_${userId}`);
            }

            return true;
        } catch (e) {
            console.error('❌ Batch update error:', e.message);
            return false;
        }
    }

    // ======================= Add Meaning To Word =======================
    async addMeaningToWord(userId, english, newMeaning) {
        if (!this.initialized) return false;
        try {
            const words = await this.getUserWords(userId);
            const word = words.find(w => w.english.toLowerCase() === english.toLowerCase());
            if (!word) return false;

            const updatedMeanings = [...word.meanings, newMeaning];
            const updatedJSON = JSON.stringify(updatedMeanings);

            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: 'Words!A:O'
            });

            const rows = response.data.values || [];
            const rowIndex = rows.findIndex(row => row[0] === userId.toString() && row[1].toLowerCase() === english.toLowerCase()) + 1;
            if (rowIndex === 0) return false;

            await this.sheets.spreadsheets.values.update({
                spreadsheetId: this.spreadsheetId,
                range: `Words!E${rowIndex}`,
                valueInputOption: 'RAW',
                resource: { values: [[updatedJSON]] }
            });

            this.cache.delete(`words_${userId}`);
            return true;
        } catch (e) {
            console.error('❌ Error adding meaning:', e.message);
            return false;
        }
    }
}

// ======================= Initialize =======================
export const sheetsService = new GoogleSheetsService();
sheetsService.startCacheCleanup();
