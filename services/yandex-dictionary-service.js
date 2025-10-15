import axios from 'axios';

export class YandexDictionaryService {
    constructor() {
        this.apiKey = process.env.YANDEX_DICTIONARY_API_KEY;
        this.baseUrl = 'https://dictionary.yandex.net/api/v1/dicservice.json/lookup';
    }

    async getTranscription(word) {
        try {
            console.log(`🔍 Yandex: Searching for "${word}"`);
            
            const response = await axios.get(this.baseUrl, {
                params: {
                    key: this.apiKey,
                    lang: 'en-ru',
                    text: word.toLowerCase(),
                    flags: 0x0004
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
            
            if (definition.ts) {
                return `/${definition.ts}/`;
            }
            
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
            const googleTtsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(word)}&tl=en-gb&client=tw-ob`;
            return googleTtsUrl;
            
        } catch (error) {
            console.error('Audio URL generation failed:', error);
            return '';
        }
    }

    // ✅ ДОБАВЛЯЕМ МЕТОД ДЛЯ ПРОВЕРКИ РУССКОГО ТЕКСТА
    isRussianText(text) {
        return /[а-яА-Я]/.test(text);
    }
}
