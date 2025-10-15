import axios from 'axios';

export class YandexDictionaryService {
    constructor() {
        this.apiKey = process.env.YANDEX_DICTIONARY_API_KEY;
        this.baseUrl = 'https://dictionary.yandex.net/api/v1/dicservice.json/lookup';
    }

    async getTranscription(word) {
        try {
            console.log(`🔍 Yandex Tech-Only: Searching for "${word}"`);
            
            // Правильные параметры для tech-only API
            const response = await axios.get(this.baseUrl, {
                params: {
                    key: this.apiKey,
                    lang: 'en-ru',  // Английский -> Русский
                    text: word.toLowerCase(),
                    flags: 0x0004   // Флаг для получения транскрипции
                },
                timeout: 5000
            });

            console.log('📊 Yandex response status:', response.status);
            
            if (response.data && response.data.def && response.data.def.length > 0) {
                const transcription = this.extractTranscription(response.data);
                const audioUrl = await this.getAudioUrl(word);
                
                console.log(`✅ Yandex transcription: ${transcription}`);
                
                return {
                    transcription: transcription,
                    audioUrl: audioUrl
                };
            } else {
                console.log('❌ Yandex: No definitions found');
                return { transcription: '', audioUrl: '' };
            }
            
        } catch (error) {
            console.error('❌ Yandex API error:', {
                status: error.response?.status,
                data: error.response?.data,
                message: error.message
            });
            return { transcription: '', audioUrl: '' };
        }
    }

    extractTranscription(data) {
        try {
            const definition = data.def[0];
            
            // Yandex хранит транскрипцию в поле "ts"
            if (definition.ts) {
                return `/${definition.ts}/`;
            }
            
            // Также проверяем транскрипцию в переводах
            if (definition.tr && definition.tr.length > 0) {
                for (const translation of definition.tr) {
                    if (translation.ts) {
                        return `/${translation.ts}/`;
                    }
                }
            }
            
            console.log('ℹ️ Yandex: No transcription found in response');
            return '';
            
        } catch (error) {
            console.error('Error extracting Yandex transcription:', error);
            return '';
        }
    }

    async getAudioUrl(word) {
        try {
            // Используем Google TTS для аудио (надежный вариант)
            const googleTtsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(word)}&tl=en-gb&client=tw-ob`;
            
            // Проверяем доступность URL
            const isAvailable = await this.checkUrlAvailability(googleTtsUrl);
            
            if (isAvailable) {
                return googleTtsUrl;
            }
            
            return '';
            
        } catch (error) {
            console.error('Audio URL generation failed:', error);
            return '';
        }
    }

    async checkUrlAvailability(url) {
        try {
            const response = await axios.head(url, { timeout: 3000 });
            return response.status === 200;
        } catch (error) {
            return false;
        }
    }
}
