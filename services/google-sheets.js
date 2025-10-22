import { google } from 'googleapis';

export class GoogleSheetsService {
    constructor() {
        this.initialized = false;
        this.sheets = null;
        this.spreadsheetId = process.env.GOOGLE_SHEET_ID;
        
        // Минимальный кеш для экономии памяти
        this.cache = new Map();
        this.CACHE_TTL = 3 * 60 * 1000;
        this.MAX_CACHE_SIZE = 30;

        if (!this.spreadsheetId) console.error('❌ GOOGLE_SHEET_ID not set');
        this.init();
    }

    async init() {
        if (!this.spreadsheetId) return;

        try {
            const auth = new google.auth.GoogleAuth({
                credentials: this.getCredentialsFromEnv(),
                scopes: ['https://www.googleapis.com/auth/spreadsheets'],
            });

            this.sheets = google.sheets({ version: 'v4', auth });
            this.initialized = true;
        } catch (e) {
            console.error('❌ Google Sheets init failed');
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
                };
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    // Оптимизированное кеширование
    async getCachedData(cacheKey, fetchFn) {
        const cached = this.cache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
            return cached.data;
        }
        
        const data = await fetchFn();
        
        // Автоочистка при превышении лимита
        if (this.cache.size >= this.MAX_CACHE_SIZE) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        
        this.cache.set(cacheKey, { data, timestamp: Date.now() });
        return data;
    }

    startCacheCleanup() {
        setInterval(() => {
            const now = Date.now();
            for (const [key, val] of this.cache.entries()) {
                if (now - val.timestamp > this.CACHE_TTL) {
                    this.cache.delete(key);
                }
            }
        }, 5 * 60 * 1000);
    }

    // КРИТИЧЕСКИ ВАЖНЫЕ ФУНКЦИИ:

    async addWordWithMeanings(userId, english, transcription, audioUrl, meanings) {
        if (!this.initialized) return false;
        try {
            const meaningsJSON = JSON.stringify(meanings);
            const now = new Date();
            const nextReview = new Date(now.getTime() + 24 * 60 * 60 * 1000);

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
            return false;
        }
    }

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
                return rows.slice(1)
                    .filter(row => row[0] === userId.toString() && (row[9] === 'active' || !row[9]))
                    .map(row => ({
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
                return [];
            }
        });
    }

 async function updateWordAfterFSRSReview(userId, english, fsrsCard, rating) {
    if (!this.initialized) return false;
    try {
        const words = await this.getUserWords(userId);
        const word = words.find(w => w.english.toLowerCase() === english.toLowerCase());
        if (!word) return false;

        const response = await this.sheets.spreadsheets.values.get({
            spreadsheetId: this.spreadsheetId,
            range: 'Words!A:O'
        });

        const rows = response.data.values || [];
        const rowIndex = rows.findIndex(r => r[0] === userId.toString() && r[1].toLowerCase() === english.toLowerCase()) + 1;
        if (rowIndex === 0) return false;

        const dueDate = fsrsCard.due?.toISOString?.() || new Date().toISOString();
        const interval = fsrsCard.interval?.toString() || '2';
        const ease = fsrsCard.ease?.toFixed(2) || '2.50';
        const repetitions = fsrsCard.repetitions?.toString() || '1';
        
        // ✅ ПРАВИЛЬНАЯ ЛОГИКА: Устанавливаем firstLearnedDate только для новых слов
        let firstLearnedDate = word.firstLearnedDate;
        if ((!firstLearnedDate || firstLearnedDate.trim() === '') && word.interval === 1) {
            firstLearnedDate = new Date().toISOString();
        }

        await this.sheets.spreadsheets.values.update({
            spreadsheetId: this.spreadsheetId,
            range: `Words!G${rowIndex}:O${rowIndex}`,
            valueInputOption: 'RAW',
            resource: {
                values: [[
                    new Date().toISOString(),
                    dueDate,
                    interval,
                    'active',
                    firstLearnedDate || '',
                    ease,
                    repetitions,
                    rating
                ]]
            }
        });

        this.cache.delete(`words_${userId}`);
        this.cache.delete(`review_${userId}`);
        return true;
    } catch (e) {
        return false;
    }
}

    async getWordsForReview(userId) {
        const words = await this.getUserWords(userId);
        const now = new Date();
        
        return words.filter(w => {
            if (w.status !== 'active') return false;
            
            const isLearned = w.interval > 1 || 
                             (w.firstLearnedDate && w.firstLearnedDate.trim() !== '');
            if (!isLearned) return false;
            
            if (!w.nextReview) return false;
            
            try {
                const nextReviewDate = new Date(w.nextReview);
                const moscowOffset = 3 * 60 * 60 * 1000;
                const moscowNow = new Date(now.getTime() + moscowOffset);
                const moscowReview = new Date(nextReviewDate.getTime() + moscowOffset);
                
                return moscowReview <= moscowNow;
            } catch (e) {
                return false;
            }
        });
    }
    
    async getReviewWordsCount(userId) {
        const reviewWords = await this.getWordsForReview(userId);
        return reviewWords.length;
    }

    async getNewWordsCount(userId) {
        const words = await this.getUserWords(userId);
        return words.filter(w => 
            w.status === 'active' && 
            w.interval === 1 &&
            (!w.firstLearnedDate || w.firstLearnedDate.trim() === '')
        ).length;
    }

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
            return false;
        }
    }

}

export const sheetsService = new GoogleSheetsService();
sheetsService.startCacheCleanup();

