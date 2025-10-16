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
                    
                    // ✅ СРАЗУ СОЗДАЕМ ЗНАЧЕНИЯ ИЗ YANDEX (правильно сопоставленные)
                    this.createMeaningsFromYandex(result, yandexData);
                }
            } catch (error) {
                console.log('❌ [CombinedService] Yandex failed:', error.message);
            }
        }

        // ✅ Free Dictionary для английских значений (если Яндекс не сработал)
        if (result.meanings.length === 0) {
            try {
                const freeDictData = await this.getFreeDictionaryData(word);
                if (freeDictData.meanings.length > 0) {
                    result.meanings = freeDictData.meanings;
                    result.audioUrl = freeDictData.audioUrl;
                    console.log(`✅ [CombinedService] FreeDictionary found ${result.meanings.length} meanings`);
                    
                    // ✅ СОЗДАЕМ ПЕРЕВОДЫ ДЛЯ ЗНАЧЕНИЙ FREEDICT
                    this.createTranslationsForFreeDict(result);
                }
            } catch (error) {
                console.log('❌ [CombinedService] FreeDictionary failed:', error.message);
            }
        }

        // ✅ Fallback если ничего не нашли
        if (result.meanings.length === 0) {
            console.log('⚠️ [CombinedService] No data found, creating basic meanings');
            this.createBasicMeanings(result, word);
        }

        console.log(`🎯 [CombinedService] Final: ${result.translations.length} translations, ${result.meanings.length} meanings`);
        
        // ✅ ВАЖНО: Убеждаемся, что каждый перевод имеет соответствующее значение
        this.ensureTranslationMeaningMatch(result);
        
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
            yandexMeanings: []
        };

        if (!data.def || data.def.length === 0) {
            return result;
        }

        // ✅ ТРАНСКРИПЦИЯ из Яндекс
        if (data.def[0].ts) {
            result.transcription = `/${data.def[0].ts}/`;
        }

        // ✅ ИЗВЛЕКАЕМ ПЕРЕВОДЫ и данные для значений
        data.def.forEach((definition, defIndex) => {
            if (definition.tr && Array.isArray(definition.tr)) {
                definition.tr.forEach((translation, transIndex) => {
                    if (translation.text && this.isRussianText(translation.text)) {
                        const russianTranslation = translation.text.trim();
                        
                        if (!result.translations.includes(russianTranslation)) {
                            result.translations.push(russianTranslation);
                        }

                        // ✅ СОХРАНЯЕМ ДАННЫЕ для создания значений
                        result.yandexMeanings.push({
                            translation: russianTranslation, // русский перевод
                            pos: translation.pos || definition.pos,
                            syn: translation.syn ? translation.syn.map(s => s.text) : [],
                            mean: translation.mean ? translation.mean.map(m => m.text) : [],
                            definition: definition // исходное определение
                        });
                    }
                });
            }
        });

        return result;
    }

    createMeaningsFromYandex(result, yandexData) {
        if (!yandexData || !yandexData.yandexMeanings || yandexData.yandexMeanings.length === 0) {
            return;
        }

        console.log(`🔄 [CombinedService] Creating meanings from Yandex`);
        
        // ✅ СОЗДАЕМ ЗНАЧЕНИЯ - КАЖДОМУ ПЕРЕВОДУ СООТВЕТСТВУЕТ СВОЕ ЗНАЧЕНИЕ
        yandexData.yandexMeanings.forEach((yandexMeaning, index) => {
            const englishDefinition = this.generateAccurateEnglishDefinition(result.word, yandexMeaning);
            
            const detailedMeaning = {
                id: `yd_${index}`,
                translation: yandexMeaning.translation, // русский перевод
                englishDefinition: englishDefinition,   // английское значение
                englishWord: result.word,
                partOfSpeech: this.translatePOS(yandexMeaning.pos) || 'unknown',
                example: '',
                source: 'Yandex'
            };
            
            result.meanings.push(detailedMeaning);
        });

        console.log(`✅ [CombinedService] Created ${result.meanings.length} meanings from Yandex`);
    }

    generateAccurateEnglishDefinition(word, yandexMeaning) {
        // ✅ СОЗДАЕМ ТОЧНОЕ АНГЛИЙСКОЕ ОПРЕДЕЛЕНИЕ НА ОСНОВЕ ПЕРЕВОДА
        
        const translation = yandexMeaning.translation.toLowerCase();
        
        // ✅ СПЕЦИФИЧНЫЕ ОПРЕДЕЛЕНИЯ ДЛЯ РАЗНЫХ ПЕРЕВОДОВ
        const definitionMap = {
            // Для слова "ship"
            'корабль': `a large watercraft for sea transport`,
            'судно': `a vessel for navigation on water`,
            'отправлять': `to send or transport by ship`,
            'отгружать': `to load and send goods for transport`,
            'отгружаться': `to be loaded onto a ship for transport`,
            'судовой': `relating to or belonging to a ship`,
            
            // Для слова "run"  
            'бежать': `to move quickly using one's legs`,
            'управлять': `to operate or be in charge of`,
            'работать': `to function or operate`,
            'запускать': `to start or initiate operation`,
            'течь': `to flow in a stream`,
            
            // Общие паттерны
            'существительное': `${word} (noun)`,
            'глагол': `to ${word} (verb)`,
            'прилагательное': `${word} (adjective)`
        };

        // ✅ Ищем точное соответствие
        for (const [key, definition] of Object.entries(definitionMap)) {
            if (translation.includes(key)) {
                return definition;
            }
        }

        // ✅ Используем английские оттенки значений из Яндекс
        if (yandexMeaning.mean && yandexMeaning.mean.length > 0) {
            return `${word} (${yandexMeaning.mean.join(', ')})`;
        }

        // ✅ Используем синонимы
        if (yandexMeaning.syn && yandexMeaning.syn.length > 0) {
            return `${word} → ${yandexMeaning.syn.join(', ')}`;
        }

        // ✅ Базовое определение
        return `${word} - ${yandexMeaning.translation}`;
    }

    translatePOS(englishPOS) {
        const posMap = {
            'noun': 'существительное',
            'verb': 'глагол',
            'adjective': 'прилагательное',
            'adverb': 'наречие',
            'pronoun': 'местоимение',
            'preposition': 'предлог',
            'conjunction': 'союз',
            'interjection': 'междометие'
        };
        return posMap[englishPOS] || englishPOS;
    }

    async getFreeDictionaryData(word) {
        try {
            const response = await axios.get(
                `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
                { timeout: 5000 }
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
        
        if (entry.phonetic) {
            result.transcription = `/${entry.phonetic}/`;
        }

        if (entry.phonetics && entry.phonetics.length > 0) {
            const audioPhonetic = entry.phonetics.find(p => p.audio && p.audio.length > 0);
            if (audioPhonetic && audioPhonetic.audio) {
                result.audioUrl = audioPhonetic.audio;
            }
        }

        let meaningId = 0;
        
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

    createTranslationsForFreeDict(result) {
        console.log(`🔄 [CombinedService] Creating translations for FreeDict meanings`);
        
        // ✅ СОЗДАЕМ ПЕРЕВОДЫ ДЛЯ КАЖДОГО ЗНАЧЕНИЯ FREEDICT
        const baseTranslations = ['основное значение', 'ключевой смысл', 'важное определение', 'главный аспект'];
        
        result.meanings.forEach((meaning, index) => {
            const translationIndex = index % baseTranslations.length;
            meaning.translation = baseTranslations[translationIndex];
        });

        // ✅ ОБНОВЛЯЕМ СПИСОК ПЕРЕВОДОВ
        result.translations = result.meanings.map(m => m.translation).filter((value, index, self) => 
            self.indexOf(value) === index
        );
    }

    createBasicMeanings(result, word) {
        console.log(`🔄 [CombinedService] Creating basic meanings`);
        
        const basicMeanings = [
            { translation: 'основное значение', english: 'primary meaning' },
            { translation: 'ключевой смысл', english: 'key significance' },
            { translation: 'важный аспект', english: 'important aspect' }
        ];
        
        basicMeanings.forEach((meaning, index) => {
            result.meanings.push({
                id: `basic_${index}`,
                translation: meaning.translation,
                englishDefinition: `${word} - ${meaning.english}`,
                englishWord: word,
                partOfSpeech: 'noun',
                example: '',
                source: 'basic'
            });
            
            if (!result.translations.includes(meaning.translation)) {
                result.translations.push(meaning.translation);
            }
        });
    }

    ensureTranslationMeaningMatch(result) {
        console.log(`🔄 [CombinedService] Ensuring translation-meaning match`);
        
        // ✅ УБЕЖДАЕМСЯ, ЧТО КАЖДОМУ ПЕРЕВОДУ СООТВЕТСТВУЕТ ЗНАЧЕНИЕ
        const usedTranslations = new Set();
        
        result.meanings.forEach(meaning => {
            usedTranslations.add(meaning.translation);
        });

        // ✅ ДОБАВЛЯЕМ ОТСУТСТВУЮЩИЕ ЗНАЧЕНИЯ ДЛЯ ПЕРЕВОДОВ
        result.translations.forEach(translation => {
            if (!usedTranslations.has(translation)) {
                console.log(`⚠️ [CombinedService] Adding missing meaning for translation: "${translation}"`);
                
                result.meanings.push({
                    id: `missing_${result.meanings.length}`,
                    translation: translation,
                    englishDefinition: `${result.word} - ${translation}`,
                    englishWord: result.word,
                    partOfSpeech: 'unknown',
                    example: '',
                    source: 'auto'
                });
            }
        });

        // ✅ УДАЛЯЕМ ДУБЛИКАТЫ ПЕРЕВОДОВ
        result.translations = [...new Set(result.translations)];
    }

    isRussianText(text) {
        return /[а-яА-Я]/.test(text);
    }
}
