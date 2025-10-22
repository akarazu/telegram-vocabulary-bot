import axios from 'axios';

export class YandexDictionaryService {
    constructor() {
        this.useYandex = !!process.env.YANDEX_DICTIONARY_API_KEY;
        this.cache = new Map();
        this.CACHE_TTL = 24 * 60 * 60 * 1000;
    }

    async getTranscriptionAndAudio(word) {
        const lowerWord = word.toLowerCase().trim();
        const cacheKey = `yandex_${lowerWord}`;
        
        const cached = this.cache.get(cacheKey);
        if (cached) return cached.data;
        
        if (!this.useYandex) {
            return this.getFallbackData(word);
        }

        try {
            const response = await axios.get('https://dictionary.yandex.net/api/v1/dicservice.json/lookup', {
                params: {
                    key: process.env.YANDEX_DICTIONARY_API_KEY,
                    lang: 'en-ru',
                    text: word
                },
                timeout: 5000
            });

            const result = {
                transcription: '',
                audioUrl: this.generateFallbackAudioUrl(word)
            };

            if (response.data.def?.[0]?.ts) {
                result.transcription = `/${response.data.def[0].ts}/`;
            }

            this.cache.set(cacheKey, { data: result, timestamp: Date.now() });
            return result;
        } catch (error) {
            return this.getFallbackData(word);
        }
    }

    getFallbackData(word) {
        return {
            transcription: '',
            audioUrl: `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(word)}&tl=en-gb&client=tw-ob`
        };
    }
}
