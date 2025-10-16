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

        // ✅ Free Dictionary для английских значений
        let freeDictData = null;
        try {
            freeDictData = await this.getFreeDictionaryData(word);
            if (freeDictData.meanings.length > 0) {
                result.meanings = freeDictData.meanings;
                result.audioUrl = freeDictData.audioUrl;
                console.log(`✅ [CombinedService] FreeDictionary found ${result.meanings.length} meanings`);
            } else {
                console.log('⚠️ [CombinedService] FreeDictionary returned no meanings, creating from Yandex');
                // Создаем значения на основе переводов Яндекс
                this.createMeaningsFromYandex(result, yandexData);
            }
        } catch (error) {
            console.log('❌ [CombinedService] FreeDictionary failed, creating meanings from Yandex:', error.message);
            // Если FreeDict не работает, создаем значения из Яндекс
            this.createMeaningsFromYandex(result, yandexData);
        }

        // ✅ СОПОСТАВЛЯЕМ ПЕРЕВОДЫ С ЗНАЧЕНИЯМИ
        if (result.translations.length > 0 && result.meanings.length > 0) {
            this.matchTranslationsWithMeanings(result);
        }

        // ✅ Fallback если ничего не нашли
        if (result.meanings.length === 0) {
            console.log('⚠️ [CombinedService] No meanings found, using basic data');
            this.createBasicMeanings(result, word);
        }

        console.log(`🎯 [CombinedService] Final: ${result.translations.length} translations, ${result.meanings.length} meanings`);
        return result;
    }

    async getYandexData(word) {
        try {
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
            translations: [],
            yandexMeanings: [] // сохраняем данные Яндекс для создания значений
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

                        // ✅ СОХРАНЯЕМ ДАННЫЕ Яндекс для создания значений
                        result.yandexMeanings.push({
                            translation: russianTranslation,
                            pos: translation.pos || definition.pos,
                            syn: translation.syn ? translation.syn.map(s => s.text) : [],
                            mean: translation.mean ? translation.mean.map(m => m.text) : []
                        });
                    }
                });
            }
        });

        return result;
    }

    async getFreeDictionaryData(word) {
        try {
            const response = await axios.get(
                `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
                { timeout: 5000 } // уменьшаем таймаут
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
        if (entry.meanings && Array.isArray(entry.meanings)) {
            entry.meanings.forEach((meaning, meaningIndex) => {
                const partOfSpeech = meaning.partOfSpeech || 'unknown';
                
                if (meaning.definitions && Array.isArray(meaning.definitions)) {
                    meaning.definitions.forEach((definition, defIndex) => {
                        meaningId++;
                        
                        if (definition.definition) {
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
                        }
                    });
                }
            });
        }

        return result;
    }

    createMeaningsFromYandex(result, yandexData) {
        if (!yandexData || !yandexData.yandexMeanings || yandexData.yandexMeanings.length === 0) {
            return;
        }

        console.log(`🔄 [CombinedService] Creating meanings from Yandex data`);
        
        yandexData.yandexMeanings.forEach((yandexMeaning, index) => {
            // ✅ СОЗДАЕМ АНГЛИЙСКОЕ ОПРЕДЕЛЕНИЕ НА ОСНОВЕ ПЕРЕВОДА Яндекс
            const englishDefinition = this.generateEnglishDefinitionFromYandex(result.word, yandexMeaning);
            
            const detailedMeaning = {
                id: `yd_${index}`,
                translation: yandexMeaning.translation,
                englishDefinition: englishDefinition,
                englishWord: result.word,
                partOfSpeech: yandexMeaning.pos || 'unknown',
                example: '',
                source: 'Yandex'
            };
            
            result.meanings.push(detailedMeaning);
        });

        console.log(`✅ [CombinedService] Created ${result.meanings.length} meanings from Yandex`);
    }

    generateEnglishDefinitionFromYandex(word, yandexMeaning) {
        // ✅ СОЗДАЕМ АНГЛИЙСКОЕ ОПРЕДЕЛЕНИЕ НА ОСНОВЕ ДАННЫХ Яндекс
        let definition = word;
        
        if (yandexMeaning.mean && yandexMeaning.mean.length > 0) {
            // Используем английские оттенки значений из Яндекс
            definition += ` (${yandexMeaning.mean.join(', ')})`;
        } else if (yandexMeaning.syn && yandexMeaning.syn.length > 0) {
            // Или используем синонимы
            definition += ` → ${yandexMeaning.syn.join(', ')}`;
        } else {
            // Базовое определение на основе перевода
            const translation = yandexMeaning.translation.toLowerCase();
            if (translation.includes('корабль') || translation.includes('судно')) {
                definition = `${word} (nautical vessel)`;
            } else if (translation.includes('отправлять') || translation.includes('отгружать')) {
                definition = `${word} (send or transport)`;
            } else {
                definition = `${word} (${translation})`;
            }
        }
        
        return definition;
    }

    createBasicMeanings(result, word) {
        console.log(`🔄 [CombinedService] Creating basic meanings`);
        
        // ✅ СОЗДАЕМ БАЗОВЫЕ ЗНАЧЕНИЯ НА ОСНОВЕ ПЕРЕВОДОВ
        if (result.translations.length > 0) {
            result.translations.forEach((translation, index) => {
                const detailedMeaning = {
                    id: `basic_${index}`,
                    translation: translation,
                    englishDefinition: `${word} - ${translation}`,
                    englishWord: word,
                    partOfSpeech: 'unknown',
                    example: '',
                    source: 'basic'
                };
                
                result.meanings.push(detailedMeaning);
            });
        } else {
            // Если нет переводов, создаем одно базовое значение
            result.meanings.push({
                id: 'basic',
                translation: 'основное значение',
                englishDefinition: `basic meaning of ${word}`,
                englishWord: word,
                partOfSpeech: 'noun',
                example: '',
                source: 'basic'
            });
            result.translations = ['основное значение'];
        }
    }

    matchTranslationsWithMeanings(result) {
        console.log(`🔄 [CombinedService] Matching translations with meanings`);
        
        // ✅ СОПОСТАВЛЯЕМ ПЕРЕВОДЫ С ЗНАЧЕНИЯМИ
        result.meanings.forEach((meaning, index) => {
            if (index < result.translations.length) {
                meaning.translation = result.translations[index];
            } else if (result.translations.length > 0) {
                // Если значений больше чем переводов, используем первый перевод
                meaning.translation = result.translations[0];
            }
        });
    }

    isRussianText(text) {
        return /[а-яА-Я]/.test(text);
    }
}
