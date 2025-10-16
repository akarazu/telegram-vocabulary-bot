import axios from 'axios';

export class CombinedDictionaryService {
    constructor() {
        this.useYandex = !!process.env.YANDEX_DICTIONARY_API_KEY;
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

        // ✅ Яндекс для переводов и транскрипции
        let yandexData = null;
        if (this.useYandex) {
            try {
                yandexData = await this.getYandexData(word);
                if (yandexData.translations.length > 0) {
                    result.translations = yandexData.translations;
                    result.transcription = yandexData.transcription;
                    console.log(`✅ [CombinedService] Yandex found ${result.translations.length} translations`);
                }
            } catch (error) {
                console.log('❌ [CombinedService] Yandex failed:', error.message);
            }
        }

        // ✅ Free Dictionary для английских значений и определений
        let freeDictData = null;
        try {
            freeDictData = await this.getFreeDictionaryData(word);
            if (freeDictData.meanings.length > 0) {
                result.meanings = freeDictData.meanings;
                result.audioUrl = freeDictData.audioUrl;
                
                // ✅ Если Яндекс не дал транскрипцию, берем из FreeDictionary
                if (!result.transcription && freeDictData.transcription) {
                    result.transcription = freeDictData.transcription;
                }
                
                console.log(`✅ [CombinedService] FreeDictionary found ${result.meanings.length} meanings`);
            }
        } catch (error) {
            console.log('❌ [CombinedService] FreeDictionary failed:', error.message);
        }

        // ✅ СОПОСТАВЛЯЕМ ПЕРЕВОДЫ YANDEX С ЗНАЧЕНИЯМИ FREEDICTIONARY
        if (result.translations.length > 0 && result.meanings.length > 0) {
            this.matchYandexTranslationsWithFreeDictMeanings(result);
        } else if (result.meanings.length > 0 && result.translations.length === 0) {
            // ✅ Если есть только значения FreeDict, создаем простые переводы
            this.createTranslationsForFreeDictMeanings(result);
        }

        // ✅ Fallback если ничего не нашли
        if (result.meanings.length === 0 && result.translations.length === 0) {
            return this.getBasicFallback(word);
        }

        console.log(`🎯 [CombinedService] Final result: ${result.translations.length} translations, ${result.meanings.length} meanings`);
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

            return this.processYandexResponse(response.data, word);
            
        } catch (error) {
            throw new Error(`Yandex: ${error.message}`);
        }
    }

    processYandexResponse(data, word) {
        const result = {
            word: word,
            transcription: '',
            translations: []
        };

        if (!data.def || data.def.length === 0) {
            return result;
        }

        // ✅ ТРАНСКРИПЦИЯ из Яндекс
        if (data.def[0].ts) {
            result.transcription = `/${data.def[0].ts}/`;
        }

        // ✅ ИЗВЛЕКАЕМ ПЕРЕВОДЫ из Яндекс
        data.def.forEach((definition, defIndex) => {
            if (definition.tr && Array.isArray(definition.tr)) {
                definition.tr.forEach((translation, transIndex) => {
                    if (translation.text && this.isRussianText(translation.text)) {
                        const russianTranslation = translation.text.trim();
                        
                        if (!result.translations.includes(russianTranslation)) {
                            result.translations.push(russianTranslation);
                        }
                    }
                });
            }
        });

        console.log(`🎯 [CombinedService] Yandex: ${result.translations.length} translations`);
        return result;
    }

    async getFreeDictionaryData(word) {
        try {
            console.log(`🔍 [CombinedService] Making FreeDictionary request for: "${word}"`);
            
            const response = await axios.get(
                `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
                { timeout: 10000 }
            );

            return this.processFreeDictionaryResponse(response.data, word);
            
        } catch (error) {
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

        if (!Array.isArray(data) || data.length === 0) {
            return result;
        }

        const entry = data[0];
        
        // ✅ ТРАНСКРИПЦИЯ из FreeDictionary
        if (entry.phonetic) {
            result.transcription = `/${entry.phonetic}/`;
        }

        // ✅ АУДИО из FreeDictionary
        if (entry.phonetics && entry.phonetics.length > 0) {
            const audioPhonetic = entry.phonetics.find(p => p.audio && p.audio.length > 0);
            if (audioPhonetic && audioPhonetic.audio) {
                result.audioUrl = audioPhonetic.audio;
            }
        }

        let meaningId = 0;
        
        // ✅ ОБРАБАТЫВАЕМ КАЖДУЮ ЧАСТЬ РЕЧИ И ОПРЕДЕЛЕНИЯ
        entry.meanings.forEach((meaning, meaningIndex) => {
            const partOfSpeech = meaning.partOfSpeech;
            
            meaning.definitions.forEach((definition, defIndex) => {
                meaningId++;
                
                // ✅ СОЗДАЕМ ЗНАЧЕНИЕ С АНГЛИЙСКИМ ОПРЕДЕЛЕНИЕМ
                const detailedMeaning = {
                    id: `fd_${meaningId}`,
                    englishDefinition: definition.definition,
                    englishWord: word,
                    partOfSpeech: partOfSpeech,
                    example: definition.example || '',
                    translation: '', // будет заполнено при сопоставлении
                    source: 'FreeDictionary'
                };
                
                result.meanings.push(detailedMeaning);
            });
        });

        console.log(`🎯 [CombinedService] FreeDictionary: ${result.meanings.length} english meanings`);
        return result;
    }

    matchYandexTranslationsWithFreeDictMeanings(result) {
        console.log(`🔄 [CombinedService] Matching ${result.translations.length} Yandex translations with ${result.meanings.length} FreeDict meanings`);
        
        let matchedCount = 0;
        
        // ✅ ПРОСТОЕ СОПОСТАВЛЕНИЕ: назначаем переводы Яндекс значениям FreeDict по порядку
        result.meanings.forEach((meaning, index) => {
            if (index < result.translations.length) {
                meaning.translation = result.translations[index];
                matchedCount++;
            } else {
                // Если переводов меньше чем значений, используем первый доступный перевод
                meaning.translation = result.translations[0];
            }
        });
        
        console.log(`✅ [CombinedService] Matched ${matchedCount} meanings with translations`);
    }

    createTranslationsForFreeDictMeanings(result) {
        console.log(`🔄 [CombinedService] Creating translations for FreeDict meanings`);
        
        // ✅ СОЗДАЕМ ПРОСТЫЕ ПЕРЕВОДЫ ДЛЯ ЗНАЧЕНИЙ FREEDICT
        const baseTranslations = ['основное значение', 'главный смысл', 'ключевое определение', 'важный аспект'];
        
        result.meanings.forEach((meaning, index) => {
            const translationIndex = index % baseTranslations.length;
            meaning.translation = baseTranslations[translationIndex];
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
        return {
            word: word,
            transcription: `/${word}/`,
            audioUrl: `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(word)}&tl=en-gb&client=tw-ob`,
            meanings: [{
                id: 'fallback',
                translation: 'основное значение',
                englishDefinition: `basic definition of ${word}`,
                englishWord: word,
                partOfSpeech: 'noun',
                example: '',
                source: 'fallback'
            }],
            translations: ['основное значение']
        };
    }
}
