// services/cambridge-dictionary-service.js
import axios from 'axios';
import * as cheerio from 'cheerio';

export class CambridgeDictionaryService {
    constructor() {
        this.cache = new Map();
        this.CACHE_TTL = 60 * 60 * 1000;
    }

    async getWordData(word) {
        const cacheKey = `cam_${word.toLowerCase().trim()}`;
        const cached = this.cache.get(cacheKey);
        
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
            return cached.data;
        }

        try {
            const data = await this.fetchWordData(word);
            this.cache.set(cacheKey, { data, timestamp: Date.now() });
            return data;
        } catch (error) {
            const fallbackData = { word, meanings: [], audio: null };
            this.cache.set(cacheKey, { data: fallbackData, timestamp: Date.now() });
            return fallbackData;
        }
    }

    async fetchWordData(word) {
        const url = `https://dictionary.cambridge.org/dictionary/english-russian/${encodeURIComponent(word.trim().toLowerCase())}`;
        
        const response = await axios.get(url, {
            timeout: 8000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            }
        });

        return this.parseHtml(response.data, word);
    }

    parseHtml(html, word) {
        try {
            const $ = cheerio.load(html);
            const meanings = [];
            const seenTranslations = new Set();

            // Проверяем наличие результатов
            const noResults = $('.empty-page, .dictionary-nodata').length > 0;
            if (noResults) {
                return { word, meanings: [], audio: null };
            }

            // Парсим основные значения
            $('.entry-body__el').slice(0, 3).each((index, entry) => {
                const $entry = $(entry);
                const partOfSpeech = $entry.find('.pos').first().text().trim() || 'unknown';

                $entry.find('.def-block').slice(0, 3).each((defIndex, defBlock) => {
                    const $block = $(defBlock);
                    const englishDefinition = $block.find('.def').first().text().trim().replace(':', '') || '';
                    
                    const translations = $block
                        .find('.trans')
                        .map((i, el) => $(el).text().trim())
                        .get()
                        .filter(trans => trans && trans.length > 0);

                    const examples = $block
                        .find('.eg')
                        .slice(0, 2)
                        .map((i, ex) => ({ english: $(ex).text().trim(), russian: '' }))
                        .get()
                        .filter(ex => ex.english);

                    translations.forEach(translation => {
                        if (translation && !seenTranslations.has(translation)) {
                            meanings.push({
                                translation: translation,
                                englishDefinition: englishDefinition,
                                partOfSpeech: partOfSpeech,
                                examples: examples,
                                source: 'Cambridge Dictionary'
                            });
                            seenTranslations.add(translation);
                        }
                    });

                    if (translations.length === 0 && englishDefinition) {
                        meanings.push({
                            translation: '',
                            englishDefinition: englishDefinition,
                            partOfSpeech: partOfSpeech,
                            examples: examples,
                            source: 'Cambridge Dictionary'
                        });
                    }
                });
            });

            // Аудио произношение
            let ukAudio = $('.uk .audio_play_button[data-src-mp3]').attr('data-src-mp3') || null;
            if (ukAudio) {
                if (ukAudio.startsWith('//')) ukAudio = `https:${ukAudio}`;
                if (ukAudio.startsWith('/')) ukAudio = `https://dictionary.cambridge.org${ukAudio}`;
            }
            
            return { word, meanings, audio: ukAudio };

        } catch (error) {
            return { word, meanings: [], audio: null };
        }
    }

    clearCache() {
        this.cache.clear();
    }
}

let cambridgeServiceInstance = null;
export function getCambridgeService() {
    if (!cambridgeServiceInstance) {
        cambridgeServiceInstance = new CambridgeDictionaryService();
    }
    return cambridgeServiceInstance;
}
