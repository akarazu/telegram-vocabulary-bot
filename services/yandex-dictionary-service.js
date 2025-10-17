import axios from 'axios';

export class YandexDictionaryService {
    constructor() {
        this.useYandex = !!process.env.YANDEX_DICTIONARY_API_KEY;
        console.log(`🔧 [YandexService] Initialized: ${this.useYandex}`);
    }

    async getTranscriptionAndAudio(word) {
        if (!this.useYandex) {
            return {
                transcription: '',
                audioUrl: `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(word)}&tl=en-gb&client=tw-ob`
            };
        }

        try {
            console.log(`\n🔍 [Yandex] Getting transcription and audio for: "${word}"`);
            
            const response = await axios.get('https://dictionary.yandex.net/api/v1/dicservice.json/lookup', {
                params: {
                    key: process.env.YANDEX_DICTIONARY_API_KEY,
                    lang: 'en-ru',
                    text: word,
                    ui: 'ru'
                },
                timeout: 10000
            });

            console.log(`✅ [Yandex] API Response Status: ${response.status}`);
            
            const result = {
                transcription: '',
                audioUrl: `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(word)}&tl=en-gb&client=tw-ob`
            };

            // Извлекаем только транскрипцию
            if (response.data.def && response.data.def.length > 0 && response.data.def[0].ts) {
                result.transcription = `/${response.data.def[0].ts}/`;
                console.log(`🔤 [Yandex] Transcription: ${result.transcription}`);
            }

            return result;
            
        } catch (error) {
            console.error(`❌ [Yandex] API ERROR:`, error.message);
            // Fallback
            return {
                transcription: '',
                audioUrl: `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(word)}&tl=en-gb&client=tw-ob`
            };
        }
    }
}
