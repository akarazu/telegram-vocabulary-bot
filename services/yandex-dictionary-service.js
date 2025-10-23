import axios from 'axios';

export class YandexDictionaryService {
    constructor() {
        this.useYandex = !!process.env.YANDEX_DICTIONARY_API_KEY;
        this.cache = new Map();
        this.CACHE_TTL = 24 * 60 * 60 * 1000; // 24 часа
        this.requestTimeout = 10000; // 10 секунд таймаут
    }

    async getTranscriptionAndAudio(word) {
        // Проверка входных данных
        if (!word || typeof word !== 'string' || word.trim() === '') {
            console.error('Invalid word provided to Yandex service:', word);
            return this.getFallbackData('');
        }

        const lowerWord = word.toLowerCase().trim();
        const cacheKey = `yandex_${lowerWord}`;
        
        // Проверка кэша
        try {
            const cached = this.cache.get(cacheKey);
            if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
                console.log(`Using cached data for word: ${word}`);
                return cached.data;
            }
        } catch (cacheError) {
            console.error('Cache error:', cacheError);
            // Продолжаем без кэша
        }
        
        // Если Yandex API недоступен, используем fallback
        if (!this.useYandex) {
            console.log('Yandex API key not available, using fallback for word:', word);
            return this.getFallbackData(word);
        }

        // Пытаемся получить данные от Yandex
        let yandexData = null;
        try {
            yandexData = await this.fetchFromYandex(word);
        } catch (yandexError) {
            console.error('Yandex API error:', yandexError.message);
            yandexData = null;
        }

        // Если Yandex не сработал, используем fallback
        if (!yandexData) {
            console.log('Yandex API failed, using fallback for word:', word);
            return this.getFallbackData(word);
        }

        // Объединяем данные от Yandex с fallback аудио
        const result = {
            transcription: yandexData.transcription || '',
            audioUrl: yandexData.audioUrl || this.generateFallbackAudioUrl(word)
        };

        // Сохраняем в кэш
        try {
            this.cache.set(cacheKey, { 
                data: result, 
                timestamp: Date.now() 
            });
            console.log(`Cached data for word: ${word}`);
        } catch (cacheError) {
            console.error('Error caching data:', cacheError);
        }

        return result;
    }

    async fetchFromYandex(word) {
        console.log(`Fetching from Yandex for word: ${word}`);
        
        try {
            const response = await axios.get(
                'https://dictionary.yandex.net/api/v1/dicservice.json/lookup', 
                {
                    params: {
                        key: process.env.YANDEX_DICTIONARY_API_KEY,
                        lang: 'en-ru',
                        text: word,
                        flags: 0x0004 // Включаем транскрипцию
                    },
                    timeout: this.requestTimeout,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'application/json'
                    }
                }
            );

            console.log('Yandex API response status:', response.status);

            // Проверяем структуру ответа
            if (!response.data || typeof response.data !== 'object') {
                throw new Error('Invalid response format from Yandex API');
            }

            const result = {
                transcription: '',
                audioUrl: ''
            };

            // Извлекаем транскрипцию
            if (response.data.def && 
                Array.isArray(response.data.def) && 
                response.data.def.length > 0) {
                
                const firstDefinition = response.data.def[0];
                
                // Транскрипция из основного определения
                if (firstDefinition.ts) {
                    result.transcription = `/${firstDefinition.ts}/`;
                }
                
                // Ищем транскрипцию в переводах
                if (!result.transcription && 
                    firstDefinition.tr && 
                    Array.isArray(firstDefinition.tr)) {
                    
                    for (const translation of firstDefinition.tr) {
                        if (translation.ts) {
                            result.transcription = `/${translation.ts}/`;
                            break;
                        }
                    }
                }
            }

            // Генерируем аудио URL (Yandex не предоставляет аудио в API, используем fallback)
            result.audioUrl = this.generateFallbackAudioUrl(word);

            console.log(`Yandex data for "${word}":`, {
                transcription: result.transcription,
                hasAudio: !!result.audioUrl
            });

            return result;

        } catch (error) {
            console.error('Yandex API request failed:', {
                word: word,
                error: error.message,
                response: error.response?.data
            });

            if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
                throw new Error('Network error connecting to Yandex API');
            } else if (error.response) {
                // Обработка HTTP ошибок
                const status = error.response.status;
                if (status === 401) {
                    throw new Error('Invalid Yandex API key');
                } else if (status === 403) {
                    throw new Error('Yandex API access forbidden');
                } else if (status === 404) {
                    throw new Error('Word not found in Yandex dictionary');
                } else if (status >= 500) {
                    throw new Error('Yandex API server error');
                } else {
                    throw new Error(`Yandex API error: ${status}`);
                }
            } else if (error.request) {
                throw new Error('No response received from Yandex API');
            } else {
                throw new Error(`Yandex API request error: ${error.message}`);
            }
        }
    }

    getFallbackData(word) {
        console.log(`Using fallback data for word: ${word}`);
        
        if (!word || word.trim() === '') {
            return {
                transcription: '',
                audioUrl: ''
            };
        }

        return {
            transcription: this.generateFallbackTranscription(word),
            audioUrl: this.generateFallbackAudioUrl(word)
        };
    }

    generateFallbackTranscription(word) {
        if (!word) return '';
        
        // Простая эвристика для генерации базовой транскрипции
        // Это очень базовый подход, лучше чем ничего
        const commonPatterns = {
            'tion': 'ʃən',
            'sion': 'ʒən',
            'cious': 'ʃəs',
            'tious': 'ʃəs',
            'cian': 'ʃən',
            'ssion': 'ʃən',
            'ough': 'ʌf', // rough, tough
            'ought': 'ɔːt' // thought, bought
        };

        let transcription = word.toLowerCase();
        
        // Применяем некоторые общие паттерны
        for (const [pattern, replacement] of Object.entries(commonPatterns)) {
            transcription = transcription.replace(new RegExp(pattern, 'g'), replacement);
        }

        // Добавляем базовые символы транскрипции
        return `/${transcription}/`;
    }

    generateFallbackAudioUrl(word) {
        if (!word || word.trim() === '') {
            return '';
        }

        try {
            // Google TTS как fallback
            const encodedWord = encodeURIComponent(word.trim());
            return `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodedWord}&tl=en-gb&client=tw-ob&ttsspeed=0.8`;
        } catch (error) {
            console.error('Error generating fallback audio URL:', error);
            return '';
        }
    }

    // Метод для очистки кэша (может быть полезен)
    clearCache() {
        const cacheSize = this.cache.size;
        this.cache.clear();
        console.log(`Yandex service cache cleared. Removed ${cacheSize} entries.`);
        return cacheSize;
    }

    // Метод для получения статистики кэша
    getCacheStats() {
        return {
            size: this.cache.size,
            keys: Array.from(this.cache.keys())
        };
    }

    // Метод для проверки доступности сервиса
    async checkServiceHealth() {
        const testWord = 'hello';
        
        try {
            const startTime = Date.now();
            const result = await this.getTranscriptionAndAudio(testWord);
            const responseTime = Date.now() - startTime;

            return {
                status: 'healthy',
                responseTime: responseTime,
                yandexAvailable: this.useYandex,
                hasTranscription: !!result.transcription,
                hasAudio: !!result.audioUrl
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message,
                yandexAvailable: this.useYandex
            };
        }
    }
}

// Создаем синглтон экземпляр
let yandexServiceInstance = null;

export function getYandexDictionaryService() {
    if (!yandexServiceInstance) {
        yandexServiceInstance = new YandexDictionaryService();
    }
    return yandexServiceInstance;
}

export default YandexDictionaryService;
