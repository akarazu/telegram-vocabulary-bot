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
            meanings: [], // ✅ ЗНАЧЕНИЯ И ПЕРЕВОДЫ ВМЕСТЕ
            translations: [] // ✅ ДЛЯ ОБРАТНОЙ СОВМЕСТИМОСТИ
        };

        // ✅ Яндекс для переводов и РЕАЛЬНЫХ значений
        if (this.useYandex) {
            try {
                const yandexData = await this.getYandexData(word);
                if (yandexData.meanings.length > 0) {
                    result.meanings = yandexData.meanings;
                    result.translations = yandexData.translations;
                    result.transcription = yandexData.transcription;
                    console.log(`✅ [CombinedService] Yandex found ${result.meanings.length} meanings with REAL definitions`);
                }
            } catch (error) {
                console.log('❌ [CombinedService] Yandex failed:', error.message);
            }
        }

        // ✅ Free Dictionary только если Яндекс не сработал
        if (result.meanings.length === 0) {
            try {
                const freeDictData = await this.getFreeDictionaryData(word);
                if (freeDictData.meanings.length > 0) {
                    result.meanings = freeDictData.meanings;
                    result.audioUrl = freeDictData.audioUrl;
                    result.transcription = freeDictData.transcription;
                    this.createTranslationsForFreeDict(result);
                    console.log(`✅ [CombinedService] FreeDictionary found ${result.meanings.length} meanings`);
                }
            } catch (error) {
                console.log('❌ [CombinedService] FreeDictionary failed:', error.message);
            }
        }

        // ✅ Fallback
        if (result.meanings.length === 0) {
            this.createBasicMeanings(result, word);
        }

        console.log(`🎯 [CombinedService] Final: ${result.meanings.length} meanings`);
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
            meanings: [], // ✅ ОСНОВНОЙ МАССИВ ЗНАЧЕНИЙ
            translations: [] // ✅ ДЛЯ ОБРАТНОЙ СОВМЕСТИМОСТИ
        };

        if (!data.def || data.def.length === 0) {
            return result;
        }

        console.log(`📦 [CombinedService] Yandex raw data for "${word}":`, JSON.stringify(data, null, 2));

        // ✅ ТРАНСКРИПЦИЯ
        if (data.def[0].ts) {
            result.transcription = `/${data.def[0].ts}/`;
        }

        // ✅ ИЗВЛЕКАЕМ РЕАЛЬНЫЕ ЗНАЧЕНИЯ ИЗ YANDEX
        data.def.forEach((definition, defIndex) => {
            const englishWord = definition.text || word;
            const mainPOS = definition.pos || 'unknown';

            if (definition.tr && Array.isArray(definition.tr)) {
                definition.tr.forEach((translation, transIndex) => {
                    if (translation.text && this.isRussianText(translation.text)) {
                        const russianTranslation = translation.text.trim();
                        const translationPOS = translation.pos || mainPOS;

                        // ✅ СОЗДАЕМ ЗНАЧЕНИЕ С РЕАЛЬНЫМИ ДАННЫМИ ИЗ API
                        const detailedMeaning = {
                            id: `yd_${defIndex}_${transIndex}`,
                            translation: russianTranslation, // русский перевод
                            englishDefinition: this.extractRealEnglishDefinition(translation, englishWord), // ✅ РЕАЛЬНОЕ значение
                            englishWord: englishWord,
                            partOfSpeech: this.translatePOS(translationPOS),
                            examples: this.extractExamples(translation),
                            synonyms: translation.syn ? translation.syn.map(s => s.text).filter(Boolean) : [],
                            source: 'Yandex'
                        };

                        result.meanings.push(detailedMeaning);
                        
                        // ✅ ДЛЯ ОБРАТНОЙ СОВМЕСТИМОСТИ
                        if (!result.translations.includes(russianTranslation)) {
                            result.translations.push(russianTranslation);
                        }

                        console.log(`✅ [CombinedService] Meaning: "${russianTranslation}" -> "${detailedMeaning.englishDefinition}"`);
                    }
                });
            }
        });

        console.log(`🎯 [CombinedService] Yandex processed: ${result.meanings.length} meanings`);
        return result;
    }

    extractRealEnglishDefinition(translation, englishWord) {
        console.log(`🔍 [CombinedService] Extracting definition from:`, {
            mean: translation.mean,
            syn: translation.syn
        });

        // ✅ ПРИОРИТЕТ 1: поле "mean" - РЕАЛЬНЫЕ английские значения
        if (translation.mean && Array.isArray(translation.mean)) {
            const englishMeans = translation.mean
                .filter(mean => mean.text && !this.isRussianText(mean.text))
                .map(mean => mean.text);

            if (englishMeans.length > 0) {
                console.log(`✅ [CombinedService] Using MEAN values: ${englishMeans.join(', ')}`);
                return englishMeans.join(', ');
            }
        }

        // ✅ ПРИОРИТЕТ 2: поле "syn" - английские синонимы
        if (translation.syn && Array.isArray(translation.syn)) {
            const englishSynonyms = translation.syn
                .filter(syn => syn.text && !this.isRussianText(syn.text))
                .map(syn => syn.text);

            if (englishSynonyms.length > 0) {
                console.log(`✅ [CombinedService] Using SYN values: ${englishSynonyms.join(', ')}`);
                return englishSynonyms.join(', ');
            }
        }

        // ✅ ПРИОРИТЕТ 3: русские синонимы (если нет английских)
        if (translation.syn && Array.isArray(translation.syn)) {
            const russianSynonyms = translation.syn
                .filter(syn => syn.text && this.isRussianText(syn.text))
                .map(syn => syn.text);

            if (russianSynonyms.length > 0) {
                console.log(`✅ [CombinedService] Using Russian SYN: ${russianSynonyms.join(', ')}`);
                return `${englishWord} (${russianSynonyms.join(', ')})`;
            }
        }

        // ✅ ПРИОРИТЕТ 4: базовое определение
        console.log(`⚠️ [CombinedService] No API definition found, using basic`);
        return `${englishWord} - ${translation.text}`;
    }

    extractExamples(translation) {
        const examples = [];
        
        if (translation.ex && Array.isArray(translation.ex)) {
            translation.ex.forEach(exampleObj => {
                if (exampleObj.text && exampleObj.tr && Array.isArray(exampleObj.tr)) {
                    examples.push({
                        english: exampleObj.text,
                        russian: exampleObj.tr[0].text
                    });
                }
            });
        }
        
        return examples;
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
            'interjection': 'междометие',
            'существительное': 'существительное',
            'глагол': 'глагол',
            'прилагательное': 'прилагательное'
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
                                translation: '', // будет заполнено позже
                                englishDefinition: definition.definition,
                                englishWord: word,
                                partOfSpeech: partOfSpeech,
                                examples: definition.example ? [{ english: definition.example, russian: '' }] : [],
                                synonyms: definition.synonyms || [],
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
        const baseTranslations = ['основное значение', 'ключевой смысл', 'важное определение'];
        
        result.meanings.forEach((meaning, index) => {
            const translationIndex = index % baseTranslations.length;
            meaning.translation = baseTranslations[translationIndex];
        });

        result.translations = result.meanings.map(m => m.translation).filter((value, index, self) => 
            self.indexOf(value) === index
        );
    }

    createBasicMeanings(result, word) {
        const basicMeanings = [
            { translation: 'основное значение', english: 'primary meaning' },
            { translation: 'ключевой смысл', english: 'key significance' }
        ];
        
        basicMeanings.forEach((meaning, index) => {
            result.meanings.push({
                id: `basic_${index}`,
                translation: meaning.translation,
                englishDefinition: `${word} - ${meaning.english}`,
                englishWord: word,
                partOfSpeech: 'noun',
                examples: [],
                synonyms: [],
                source: 'basic'
            });
        });

        result.translations = basicMeanings.map(m => m.translation);
    }

    isRussianText(text) {
        return /[а-яА-Я]/.test(text);
    }
}
