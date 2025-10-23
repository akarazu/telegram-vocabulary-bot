// services/cambridge-dictionary-service.js
import axios from 'axios';
import * as cheerio from 'cheerio';

export class CambridgeDictionaryService {
    constructor() {
        // Минимальный кеш для экономии памяти
        this.cache = new Map();
    }

    async getWordData(word) {
        try {
            if (!word || typeof word !== 'string') {
                return { word: word || '', meanings: [], audio: null };
            }

            const cleanWord = word.trim().toLowerCase();
            
            // Простой кеш
            const cacheKey = `cam_${cleanWord}`;
            const cached = this.cache.get(cacheKey);
            if (cached) return cached;

            const data = await this.fetchWordData(cleanWord);
            this.cache.set(cacheKey, data);
            
            // Ограничиваем размер кеша
            if (this.cache.size > 100) {
                const firstKey = this.cache.keys().next().value;
                this.cache.delete(firstKey);
            }
            
            return data;
        } catch (error) {
            return { word: word || '', meanings: [], audio: null };
        }
    }

    async fetchWordData(word) {
        try {
            const url = `https://dictionary.cambridge.org/dictionary/english-russian/${encodeURIComponent(word)}`;
            
            const response = await axios.get(url, {
                timeout: 5000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            return this.parseHtml(response.data, word);
        } catch (error) {
            return { word, meanings: [], audio: null };
        }
    }

    parseHtml(html, word) {
        try {
            const $ = cheerio.load(html);
            const meanings = [];

            // Быстрая проверка на отсутствие результатов
            if ($('.empty-page, .dictionary-nodata').length > 0) {
                return { word, meanings: [], audio: null };
            }

            // Простой парсинг основных значений
            $('.entry-body__el').slice(0, 2).each((index, entry) => {
                const $entry = $(entry);
                const partOfSpeech = $entry.find('.pos').first().text().trim() || 'unknown';

                $entry.find('.def-block').slice(0, 2).each((defIndex, defBlock) => {
                    const $block = $(defBlock);
                    const englishDefinition = $block.find('.def').first().text().trim().replace(':', '') || '';
                    
                    const translations = $block
                        .find('.trans')
                        .map((i, el) => $(el).text().trim())
                        .get()
                        .filter(trans => trans && trans.length > 0);

                    translations.forEach(translation => {
                        meanings.push({
                            translation: translation,
                            englishDefinition: englishDefinition,
                            partOfSpeech: partOfSpeech,
                            examples: [],
                            source: 'Cambridge Dictionary'
                        });
                    });
                });
            });

            // Простое получение аудио
            let ukAudio = $('.uk .audio_play_button[data-src-mp3]').attr('data-src-mp3');
            if (ukAudio?.startsWith('//')) {
                ukAudio = `https:${ukAudio}`;
            }

            return { word, meanings, audio: ukAudio };

        } catch (error) {
            return { word, meanings: [], audio: null };
        }
    }
}

export default CambridgeDictionaryService;
