// services/yandex-dictionary-service.js
import axios from 'axios';

export class YandexDictionaryService {
    constructor() {
        this.useYandex = !!process.env.YANDEX_DICTIONARY_API_KEY;
    }

    async getTranscriptionAndAudio(word) {
        try {
            if (!word || typeof word !== 'string') {
                return this.getFallbackData('');
            }

            const cleanWord = word.trim().toLowerCase();
            
            if (!this.useYandex) {
                return this.getFallbackData(cleanWord);
            }

            const response = await axios.get(
                'https://dictionary.yandex.net/api/v1/dicservice.json/lookup', 
                {
                    params: {
                        key: process.env.YANDEX_DICTIONARY_API_KEY,
                        lang: 'en-ru',
                        text: cleanWord
                    },
                    timeout: 3000
                }
            );

            return {
                transcription: response.data.def?.[0]?.ts ? `/${response.data.def[0].ts}/` : '',
                audioUrl: this.generateFallbackAudioUrl(cleanWord)
            };

        } catch (error) {
            return this.getFallbackData(word);
        }
    }

    getFallbackData(word) {
        return {
            transcription: '',
            audioUrl: this.generateFallbackAudioUrl(word)
        };
    }

    generateFallbackAudioUrl(word) {
        if (!word) return '';
        try {
            return `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(word)}&tl=en-gb&client=tw-ob`;
        } catch (e) {
            return '';
        }
    }
}

export default YandexDictionaryService;
