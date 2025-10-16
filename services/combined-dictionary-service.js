import axios from 'axios';

export class CombinedDictionaryService {
    constructor() {
        this.useYandex = !!process.env.YANDEX_DICTIONARY_API_KEY;
        console.log(`🔧 [CombinedService] Initialized. Yandex API: ${this.useYandex}`);
    }

    async getWordData(word) {
        console.log(`\n🎯 ========== START getWordData for: "${word}" ==========`);
        
        const result = {
            word: word,
            transcription: '',
            audioUrl: '',
            meanings: [],
            translations: []
        };

        // ✅ Яндекс для переводов и РЕАЛЬНЫХ значений
        if (this.useYandex) {
            try {
                console.log(`🔍 [CombinedService] Calling Yandex API...`);
                const yandexData = await this.getYandexData(word);
                
                if (yandexData.meanings.length > 0) {
                    result.meanings = yandexData.meanings;
                    result.translations = yandexData.translations;
                    result.transcription = yandexData.transcription;
                    console.log(`✅ [CombinedService] Yandex SUCCESS: ${result.meanings.length} meanings`);
                } else {
                    console.log(`❌ [CombinedService] Yandex returned 0 meanings`);
                }
            } catch (error) {
                console.log(`❌ [CombinedService] Yandex ERROR: ${error.message}`);
            }
        } else {
            console.log(`⚠️ [CombinedService] Yandex API key not available`);
        }

        // ✅ Free Dictionary только если Яндекс не сработал
        if (result.meanings.length === 0) {
            try {
                console.log(`🔍 [CombinedService] Trying FreeDictionary API...`);
                const freeDictData = await this.getFreeDictionaryData(word);
                if (freeDictData.meanings.length > 0) {
                    result.meanings = freeDictData.meanings;
                    result.audioUrl = freeDictData.audioUrl;
                    result.transcription = freeDictData.transcription;
                    this.createTranslationsForFreeDict(result);
                    console.log(`✅ [CombinedService] FreeDictionary SUCCESS: ${result.meanings.length} meanings`);
                } else {
                    console.log(`❌ [CombinedService] FreeDictionary returned 0 meanings`);
                }
            } catch (error) {
                console.log(`❌ [CombinedService] FreeDictionary ERROR: ${error.message}`);
            }
        }

        // ✅ Fallback
        if (result.meanings.length === 0) {
            console.log(`⚠️ [CombinedService] No data from APIs, using fallback`);
            this.createBasicMeanings(result, word);
        }

        console.log(`📊 [CombinedService] FINAL RESULT:`);
        console.log(`   - Word: ${result.word}`);
        console.log(`   - Transcription: ${result.transcription}`);
        console.log(`   - Meanings: ${result.meanings.length}`);
        console.log(`   - Translations: ${result.translations.length}`);
        
        result.meanings.forEach((meaning, index) => {
            console.log(`   ${index + 1}. "${meaning.translation}" -> "${meaning.englishDefinition}"`);
        });
        
        console.log(`🎯 ========== END getWordData for: "${word}" ==========\n`);
        
        return result;
    }

    async getYandexData(word) {
        try {
            console.log(`\n🔍 [Yandex] Making API request for: "${word}"`);
            console.log(`🔑 [Yandex] API Key: ${process.env.YANDEX_DICTIONARY_API_KEY ? 'PRESENT' : 'MISSING'}`);
            
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
            
            // ✅ ВЫВОДИМ ПОЛНЫЙ ОТВЕТ API В КОНСОЛЬ
            console.log(`📦 [Yandex] FULL API RESPONSE:`);
            console.log(JSON.stringify(response.data, null, 2));
            console.log(`📦 [Yandex] END OF API RESPONSE\n`);

            return this.processYandexResponse(response.data, word);
            
        } catch (error) {
            console.error(`❌ [Yandex] API ERROR:`, {
                message: error.message,
                status: error.response?.status,
                data: error.response?.data,
                config: {
                    url: error.config?.url,
                    params: error.config?.params
                }
            });
            throw new Error(`Yandex: ${error.message}`);
        }
    }

    processYandexResponse(data, word) {
        console.log(`\n🔍 [Yandex] Processing response for: "${word}"`);
        
        const result = {
            word: word,
            transcription: '',
            meanings: [],
            translations: []
        };

        if (!data.def || data.def.length === 0) {
            console.log(`❌ [Yandex] No definitions found in response`);
            return result;
        }

        console.log(`📊 [Yandex] Found ${data.def.length} definition(s)`);

        // ✅ ТРАНСКРИПЦИЯ
        if (data.def[0].ts) {
            result.transcription = `/${data.def[0].ts}/`;
            console.log(`🔤 [Yandex] Transcription: ${result.transcription}`);
        } else {
            console.log(`⚠️ [Yandex] No transcription found`);
        }

        // ✅ ИЗВЛЕКАЕМ РЕАЛЬНЫЕ ЗНАЧЕНИЯ ИЗ YANDEX
        data.def.forEach((definition, defIndex) => {
            const englishWord = definition.text || word;
            const mainPOS = definition.pos || 'unknown';

            console.log(`\n📖 [Yandex] Definition ${defIndex + 1}:`);
            console.log(`   - English: ${englishWord}`);
            console.log(`   - POS: ${mainPOS}`);
            console.log(`   - Translations: ${definition.tr ? definition.tr.length : 0}`);

            if (definition.tr && Array.isArray(definition.tr)) {
                definition.tr.forEach((translation, transIndex) => {
                    if (translation.text && this.isRussianText(translation.text)) {
                        const russianTranslation = translation.text.trim();
                        const translationPOS = translation.pos || mainPOS;

                        console.log(`\n   🔸 Translation ${transIndex + 1}: "${russianTranslation}"`);
                        console.log(`      - POS: ${translationPOS}`);
                        console.log(`      - Mean:`, translation.mean);
                        console.log(`      - Ex:`, translation.ex);

                        // ✅ СОЗДАЕМ ЗНАЧЕНИЕ С РЕАЛЬНЫМИ ДАННЫМИ ИЗ API (БЕЗ СИНОНИМОВ)
                        const detailedMeaning = {
                            id: `yd_${defIndex}_${transIndex}`,
                            translation: russianTranslation,
                            englishDefinition: this.extractRealEnglishDefinition(translation, englishWord),
                            englishWord: englishWord,
                            partOfSpeech: this.translatePOS(translationPOS),
                            examples: this.extractExamples(translation),
                            synonyms: [], // УБИРАЕМ СИНОНИМЫ
                            source: 'Yandex'
                        };

                        result.meanings.push(detailedMeaning);
                        
                        if (!result.translations.includes(russianTranslation)) {
                            result.translations.push(russianTranslation);
                        }

                        console.log(`      ✅ Created meaning: "${detailedMeaning.englishDefinition}"`);
                    }
                });
            } else {
                console.log(`   ❌ No translations in definition`);
            }
        });

        console.log(`🎯 [Yandex] Processed ${result.meanings.length} meanings, ${result.translations.length} translations`);
        return result;
    }

    extractRealEnglishDefinition(translation, englishWord) {
        console.log(`   🔍 [Yandex] Extracting definition for: "${translation.text}"`);

        // ✅ ПРИОРИТЕТ 1: поле "mean" - РЕАЛЬНЫЕ английские значения
        if (translation.mean && Array.isArray(translation.mean)) {
            const englishMeans = translation.mean
                .filter(mean => mean.text && !this.isRussianText(mean.text))
                .map(mean => mean.text);

            if (englishMeans.length > 0) {
                console.log(`      ✅ Using MEAN: ${englishMeans.join(', ')}`);
                return englishMeans.join(', ');
            } else {
                console.log(`      ❌ No English values in MEAN`);
            }
        } else {
            console.log(`      ❌ No MEAN field`);
        }

        // ✅ ПРИОРИТЕТ 2: использовать английское слово + русский перевод
        console.log(`      ✅ Using English word + Russian translation`);
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
            'interjection': 'междометие'
        };
        return posMap[englishPOS] || englishPOS;
    }

    async getFreeDictionaryData(word) {
        try {
            console.log(`\n🔍 [FreeDict] Making API request for: "${word}"`);
            
            const response = await axios.get(
                `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
                { timeout: 5000 }
            );

            console.log(`✅ [FreeDict] API Response Status: ${response.status}`);
            return this.processFreeDictionaryResponse(response.data, word);
            
        } catch (error) {
            console.error(`❌ [FreeDict] API ERROR:`, {
                message: error.message,
                status: error.response?.status
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

        if (!Array.isArray(data) || data.length === 0) {
            console.log(`❌ [FreeDict] No data array`);
            return result;
        }

        const entry = data[0];
        
        if (entry.phonetic) {
            result.transcription = `/${entry.phonetic}/`;
            console.log(`🔤 [FreeDict] Transcription: ${result.transcription}`);
        }

        let meaningId = 0;
        
        if (entry.meanings && Array.isArray(entry.meanings)) {
            console.log(`📊 [FreeDict] Found ${entry.meanings.length} meanings`);
            
            entry.meanings.forEach((meaning, meaningIndex) => {
                const partOfSpeech = meaning.partOfSpeech || 'unknown';
                
                if (meaning.definitions && Array.isArray(meaning.definitions)) {
                    meaning.definitions.forEach((definition, defIndex) => {
                        meaningId++;
                        
                        if (definition.definition) {
                            const detailedMeaning = {
                                id: `fd_${meaningId}`,
                                translation: '',
                                englishDefinition: definition.definition,
                                englishWord: word,
                                partOfSpeech: partOfSpeech,
                                examples: definition.example ? [{ english: definition.example, russian: '' }] : [],
                                synonyms: [], // УБИРАЕМ СИНОНИМЫ
                                source: 'FreeDictionary'
                            };
                            
                            result.meanings.push(detailedMeaning);
                            console.log(`   ✅ [FreeDict] Meaning ${meaningId}: ${definition.definition.substring(0, 50)}...`);
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
                synonyms: [], // УБИРАЕМ СИНОНИМЫ
                source: 'basic'
            });
        });

        result.translations = basicMeanings.map(m => m.translation);
    }

    isRussianText(text) {
        return /[а-яА-Я]/.test(text);
    }
}
