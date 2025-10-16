import axios from 'axios';

export class CombinedDictionaryService {
    constructor() {
        this.useYandex = !!process.env.YANDEX_DICTIONARY_API_KEY;
        console.log(`🔧 [CombinedService] Yandex API available: ${this.useYandex}`);
    }

    async getWordData(word) {
        console.log(`🔍 [CombinedService] Getting data for: "${word}"`);
        
        const result = {
            word: word,
            transcription: '',
            audioUrl: '',
            meanings: [],
            translations: []
        };

        // ✅ Free Dictionary для английских значений и определений
        let freeDictData = null;
        try {
            freeDictData = await this.getFreeDictionaryData(word);
            if (freeDictData.meanings.length > 0) {
                result.meanings = freeDictData.meanings;
                result.audioUrl = freeDictData.audioUrl;
                result.transcription = freeDictData.transcription;
                console.log(`✅ [CombinedService] FreeDictionary found ${result.meanings.length} meanings`);
            } else {
                console.log(`❌ [CombinedService] FreeDictionary returned empty meanings`);
            }
        } catch (error) {
            console.log('❌ [CombinedService] FreeDictionary failed:', error.message);
        }

        // ✅ Яндекс для переводов и транскрипции (если FreeDict не дал транскрипцию)
        if (this.useYandex) {
            try {
                const yandexData = await this.getYandexData(word);
                if (yandexData.translations.length > 0) {
                    result.translations = yandexData.translations;
                    // Используем транскрипцию Яндекс только если FreeDict не дал
                    if (!result.transcription && yandexData.transcription) {
                        result.transcription = yandexData.transcription;
                    }
                    console.log(`✅ [CombinedService] Yandex found ${result.translations.length} translations`);
                } else {
                    console.log(`❌ [CombinedService] Yandex returned empty translations`);
                }
            } catch (error) {
                console.log('❌ [CombinedService] Yandex failed:', error.message);
            }
        }

        // ✅ СОПОСТАВЛЯЕМ ПЕРЕВОДЫ С ЗНАЧЕНИЯМИ
        if (result.translations.length > 0 && result.meanings.length > 0) {
            console.log(`🔄 [CombinedService] Matching translations with meanings`);
            this.matchTranslationsWithMeanings(result);
        } else if (result.meanings.length > 0) {
            // Если есть только значения, создаем переводы для них
            console.log(`🔄 [CombinedService] Creating translations for meanings`);
            this.createTranslationsForMeanings(result);
        }

        // ✅ Fallback если ничего не нашли
        if (result.meanings.length === 0) {
            console.log(`⚠️ [CombinedService] Using fallback for word: "${word}"`);
            return this.getBasicFallback(word);
        }

        console.log(`🎯 [CombinedService] Final: ${result.translations.length} translations, ${result.meanings.length} meanings`);
        console.log(`📋 [CombinedService] Translations:`, result.translations);
        console.log(`📋 [CombinedService] First meaning:`, result.meanings[0]);
        
        return result;
    }

    async getFreeDictionaryData(word) {
        try {
            console.log(`🔍 [CombinedService] Making FreeDictionary request for: "${word}"`);
            
            const response = await axios.get(
                `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
                { timeout: 10000 }
            );

            console.log(`📊 [CombinedService] FreeDictionary response status: ${response.status}`);
            return this.processFreeDictionaryResponse(response.data, word);
            
        } catch (error) {
            console.error(`❌ [CombinedService] FreeDictionary error:`, {
                message: error.message,
                status: error.response?.status,
                data: error.response?.data
            });
            throw new Error(`FreeDictionary: ${error.message}`);
        }
    }

    processFreeDictionaryResponse(data, word) {
        const result = {
            word: word,
            transcription: '',
            audioUrl: `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(word)}&tl=en-gb&client=tw-ob`,
            meanings: []
        };

        console.log(`📦 [CombinedService] FreeDictionary raw data:`, JSON.stringify(data, null, 2).substring(0, 500) + '...');

        if (!Array.isArray(data) || data.length === 0) {
            console.log(`❌ [CombinedService] FreeDictionary: No data array`);
            return result;
        }

        const entry = data[0];
        
        if (!entry) {
            console.log(`❌ [CombinedService] FreeDictionary: No entry in data`);
            return result;
        }

        // ✅ ТРАНСКРИПЦИЯ из FreeDictionary
        if (entry.phonetic) {
            result.transcription = `/${entry.phonetic}/`;
            console.log(`🔤 [CombinedService] FreeDictionary transcription: ${result.transcription}`);
        }

        // ✅ АУДИО из FreeDictionary
        if (entry.phonetics && entry.phonetics.length > 0) {
            const audioPhonetic = entry.phonetics.find(p => p.audio && p.audio.length > 0);
            if (audioPhonetic && audioPhonetic.audio) {
                result.audioUrl = audioPhonetic.audio;
                console.log(`🎵 [CombinedService] FreeDictionary audio found`);
            }
        }

        // ✅ ПРОВЕРЯЕМ НАЛИЧИЕ MEANINGS
        if (!entry.meanings || !Array.isArray(entry.meanings)) {
            console.log(`❌ [CombinedService] FreeDictionary: No meanings array`);
            return result;
        }

        let meaningId = 0;
        
        // ✅ ОБРАБАТЫВАЕМ КАЖДУЮ ЧАСТЬ РЕЧИ И ОПРЕДЕЛЕНИЯ
        entry.meanings.forEach((meaning, meaningIndex) => {
            const partOfSpeech = meaning.partOfSpeech || 'unknown';
            
            console.log(`📖 [CombinedService] Processing ${partOfSpeech} meaning ${meaningIndex + 1}`);
            
            if (!meaning.definitions || !Array.isArray(meaning.definitions)) {
                console.log(`❌ [CombinedService] No definitions for ${partOfSpeech}`);
                return;
            }
            
            meaning.definitions.forEach((definition, defIndex) => {
                meaningId++;
                
                if (!definition.definition) {
                    console.log(`❌ [CombinedService] No definition text`);
                    return;
                }
                
                // ✅ СОЗДАЕМ ЗНАЧЕНИЕ С АНГЛИЙСКИМ ОПРЕДЕЛЕНИЕМ
                const detailedMeaning = {
                    id: `fd_${meaningId}`,
                    englishDefinition: definition.definition,
                    englishWord: word,
                    partOfSpeech: partOfSpeech,
                    example: definition.example || '',
                    translation: '', // будет заполнено позже
                    source: 'FreeDictionary'
                };
                
                result.meanings.push(detailedMeaning);
                console.log(`✅ [CombinedService] Added meaning: ${definition.definition.substring(0, 50)}...`);
            });
        });

        console.log(`🎯 [CombinedService] FreeDictionary processed: ${result.meanings.length} meanings`);
        return result;
    }

    async getYandexData(word) {
        try {
            console.log(`🔍 [CombinedService] Making Yandex request for: "${word}"`);
            
            const response = await axios.get('https://dictionary.yandex.net/api/v1/dicservice.json/lookup', {
                params: {
                    key: process.env.YANDEX_DICTIONARY_API_KEY,
                    lang: 'en-ru',
                    text: word,
                    ui: 'ru'
                },
                timeout: 10000
            });

            console.log(`📊 [CombinedService] Yandex response status: ${response.status}`);
            return this.processYandexResponse(response.data, word);
            
        } catch (error) {
            console.error(`❌ [CombinedService] Yandex error:`, {
                message: error.message,
                status: error.response?.status,
                data: error.response?.data
            });
            throw new Error(`Yandex: ${error.message}`);
        }
    }

    processYandexResponse(data, word) {
        const result = {
            word: word,
            transcription: '',
            translations: []
        };

        console.log(`📦 [CombinedService] Yandex raw data:`, JSON.stringify(data, null, 2).substring(0, 500) + '...');

        if (!data.def || data.def.length === 0) {
            console.log(`❌ [CombinedService] Yandex: No definitions found`);
            return result;
        }

        // ✅ ТРАНСКРИПЦИЯ из Яндекс
        if (data.def[0].ts) {
            result.transcription = `/${data.def[0].ts}/`;
            console.log(`🔤 [CombinedService] Yandex transcription: ${result.transcription}`);
        }

        // ✅ ИЗВЛЕКАЕМ ПЕРЕВОДЫ из Яндекс
        data.def.forEach((definition, defIndex) => {
            if (definition.tr && Array.isArray(definition.tr)) {
                definition.tr.forEach((translation, transIndex) => {
                    if (translation.text && this.isRussianText(translation.text)) {
                        const russianTranslation = translation.text.trim();
                        
                        if (!result.translations.includes(russianTranslation)) {
                            result.translations.push(russianTranslation);
                            console.log(`✅ [CombinedService] Yandex translation: "${russianTranslation}"`);
                        }
                    }
                });
            }
        });

        console.log(`🎯 [CombinedService] Yandex processed: ${result.translations.length} translations`);
        return result;
    }

    matchTranslationsWithMeanings(result) {
        console.log(`🔄 [CombinedService] Matching ${result.translations.length} translations with ${result.meanings.length} meanings`);
        
        // ✅ ПРОСТОЕ СОПОСТАВЛЕНИЕ: назначаем переводы значениям по порядку
        result.meanings.forEach((meaning, index) => {
            if (index < result.translations.length) {
                meaning.translation = result.translations[index];
            } else {
                // Если переводов меньше чем значений, используем первый доступный перевод
                meaning.translation = result.translations[0];
            }
        });
        
        console.log(`✅ [CombinedService] Matched all meanings with translations`);
    }

    createTranslationsForMeanings(result) {
        console.log(`🔄 [CombinedService] Creating translations for ${result.meanings.length} meanings`);
        
        // ✅ СОЗДАЕМ ПЕРЕВОДЫ НА ОСНОВЕ ЧАСТЕЙ РЕЧИ
        const posTranslations = {
            'noun': ['предмет', 'явление', 'объект', 'сущность'],
            'verb': ['действие', 'процесс', 'движение', 'функция'],
            'adjective': ['свойство', 'качество', 'признак', 'характеристика'],
            'adverb': ['образ действия', 'способ', 'метод'],
            'pronoun': ['указание', 'замена', 'местоимение'],
            'preposition': ['связь', 'отношение', 'положение'],
            'conjunction': ['соединение', 'связка', 'союз'],
            'interjection': ['восклицание', 'эмоция', 'междометие']
        };
        
        result.meanings.forEach((meaning, index) => {
            const pos = meaning.partOfSpeech || 'noun';
            const translations = posTranslations[pos] || ['значение', 'смысл', 'определение'];
            const translationIndex = index % translations.length;
            
            meaning.translation = translations[translationIndex];
        });
        
        // ✅ СОЗДАЕМ СПИСОК ПЕРЕВОДОВ
        result.translations = result.meanings.map(m => m.translation).filter((value, index, self) => 
            self.indexOf(value) === index
        );
        
        console.log(`✅ [CombinedService] Created ${result.translations.length} translations`);
    }

    isRussianText(text) {
        return /[а-яА-Я]/.test(text);
    }

    getBasicFallback(word) {
        console.log(`⚠️ [CombinedService] Using basic fallback for: "${word}"`);
        
        return {
            word: word,
            transcription: `/${word}/`,
            audioUrl: `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(word)}&tl=en-gb&client=tw-ob`,
            meanings: [{
                id: 'fallback',
                translation: 'основное значение',
                englishDefinition: `the basic meaning of "${word}"`,
                englishWord: word,
                partOfSpeech: 'noun',
                example: '',
                source: 'fallback'
            }],
            translations: ['основное значение']
        };
    }
}
