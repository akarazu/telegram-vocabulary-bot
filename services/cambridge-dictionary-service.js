import axios from 'axios';
import * as cheerio from 'cheerio';

export class CambridgeDictionaryService {
    constructor() {
        this.cache = new Map();
        this.CACHE_TTL = 60 * 60 * 1000;
    }

    async getWordData(word) {
        const cacheKey = `cam_${word.toLowerCase()}`;
        const cached = this.cache.get(cacheKey);
        if (cached) return cached.data;

        try {
            // Базовая реализация парсинга Cambridge
            const result = { word, meanings: [], audio: null };
            this.cache.set(cacheKey, { data: result, timestamp: Date.now() });
            return result;
        } catch (error) {
            return { word, meanings: [], audio: null };
        }
    }
}
