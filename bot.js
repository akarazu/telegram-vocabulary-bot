import axios from 'axios';

export class YandexDictionaryService {
    constructor() {
        this.useYandex = !!process.env.YANDEX_DICTIONARY_API_KEY;
    }

    async getWordWithAutoExamples(word) {
        console.log(`🔍 [YandexService] Getting word data with examples for: "${word}"`);
        
        const result = {
            word: word,
            transcription: '',
            audioUrl: '',
            meanings: [],
            translations: []
        };

        // ✅ Яндекс Dictionary API
        if (this.useYandex) {
            try {
                const yandexData = await this.getYandexWithExamples(word);
                if (yandexData.meanings.length > 0) {
                    console.log(`✅ [YandexService] Yandex found ${yandexData.meanings.length} meanings with examples`);
                    return yandexData;
                }
            } catch (error) {
                console.log('❌ [YandexService] Yandex failed:', error.message);
            }
        }

        // ✅ Free Dictionary API (fallback)
        try {
            const freeDictData = await this.getFreeDictionaryWithExamples(word);
            if (freeDictData.meanings.length > 0) {
                console.log(`✅ [YandexService] FreeDictionary found ${freeDictData.meanings.length} meanings with examples`);
                return freeDictData;
            }
        } catch (error) {
            console.log('❌ [YandexService] FreeDictionary failed:', error.message);
        }

        return this.getBasicFallback(word);
    }

    async getYandexWithExamples(word) {
        try {
            console.log(`🔍 [YandexService] Making Yandex API request for: "${word}"`);
            
            const response = await axios.get('https://dictionary.yandex.net/api/v1/dicservice.json/lookup', {
                params: {
                    key: process.env.YANDEX_DICTIONARY_API_KEY,
                    lang: 'en-ru',
                    text: word,
                    ui: 'ru'
                },
                timeout: 10000
            });

            console.log('📊 [YandexService] Yandex API response status:', response.status);
            console.log('📋 [YandexService] Yandex raw response structure:');
            console.log(JSON.stringify(response.data, null, 2));
            
            return this.processYandexResponseWithExamples(response.data, word);
            
        } catch (error) {
            console.error('❌ [YandexService] Yandex API error:', {
                message: error.message,
                status: error.response?.status,
                data: error.response?.data
            });
            throw new Error(`Yandex: ${error.message}`);
        }
    }

    processYandexResponseWithExamples(data, word) {
        const result = {
            word: word,
            transcription: '',
            audioUrl: `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(word)}&tl=en-gb&client=tw-ob`,
            meanings: [],
            translations: []
        };

        if (!data.def || data.def.length === 0) {
            console.log('❌ [YandexService] No definitions found in Yandex response');
            return result;
        }

        console.log(`🔍 [YandexService] Yandex found ${data.def.length} definition(s)`);

        data.def.forEach((definition, defIndex) => {
            const mainPOS = definition.pos || 'unknown';
            
            console.log(`📖 [YandexService] Definition ${defIndex + 1}: POS=${mainPOS}, text="${definition.text}"`);

            if (definition.tr && Array.isArray(definition.tr)) {
                console.log(`   🔸 [YandexService] Found ${definition.tr.length} translation(s)`);
                
                definition.tr.forEach((translation, transIndex) => {
                    if (translation.text && this.isRussianText(translation.text)) {
                        const russianTranslation = translation.text.trim();
                        const translationPOS = translation.pos || mainPOS;
                        
                        console.log(`   🔸 [YandexService] Translation ${transIndex + 1}: "${russianTranslation}" (${translationPOS})`);

                        // ✅ Извлекаем примеры
                        const examples = this.extractExamplesFromYandex(translation);
                        console.log(`   📝 [YandexService] Found ${examples.length} examples for this translation`);

                        const meaningNuances = this.extractMeaningNuances(translation);
                        const synonyms = translation.syn ? translation.syn.map(s => s.text) : [];
                        
                        console.log(`   🎯 [YandexService] Meaning nuances: ${meaningNuances.length}, Synonyms: ${synonyms.length}`);

                        const detailedMeaning = {
                            partOfSpeech: translationPOS,
                            translation: russianTranslation,
                            definition: this.buildDefinition(translation, meaningNuances),
                            examples: examples,
                            meaningNuances: meaningNuances,
                            synonyms: synonyms,
                            source: 'Yandex'
                        };
                        
                        result.meanings.push(detailedMeaning);
                        
                        if (!result.translations.includes(russianTranslation)) {
                            result.translations.push(russianTranslation);
                        }
                    }
                });
            } else {
                console.log(`   ❌ [YandexService] No translations found for definition ${defIndex + 1}`);
            }
        });

        // ✅ Транскрипция
        if (data.def[0].ts) {
            result.transcription = `/${data.def[0].ts}/`;
            console.log(`🔤 [YandexService] Transcription found: ${result.transcription}`);
        }

        console.log(`🎯 [YandexService] Final result: ${result.meanings.length} meanings with ${result.meanings.reduce((acc, m) => acc + m.examples.length, 0)} examples`);
        return result;
    }

    extractExamplesFromYandex(translation) {
        const examples = [];
        
        if (translation.ex && Array.isArray(translation.ex)) {
            console.log(`      📚 [YandexService] Processing ${translation.ex.length} examples...`);
            
            translation.ex.forEach((exampleObj, exIndex) => {
                if (exampleObj.text && exampleObj.tr && Array.isArray(exampleObj.tr)) {
                    const englishExample = exampleObj.text;
                    const russianTranslation = exampleObj.tr[0].text;
                    
                    examples.push({
                        english: englishExample,
                        russian: russianTranslation,
                        full: `${englishExample} - ${russianTranslation}`
                    });
                    
                    console.log(`      📚 [YandexService] Example ${exIndex + 1}: "${englishExample}" → "${russianTranslation}"`);
                }
            });
        } else {
            console.log(`      ℹ️ [YandexService] No examples found for this translation`);
        }
        
        return examples;
    }

    extractMeaningNuances(translation) {
        const nuances = [];
        
        if (translation.mean && Array.isArray(translation.mean)) {
            translation.mean.forEach(meanObj => {
                if (meanObj.text) {
                    nuances.push(meanObj.text);
                }
            });
        }
        
        return nuances;
    }

    buildDefinition(translation, meaningNuances) {
        let definition = translation.text;
        
        if (meaningNuances.length > 0) {
            definition += ` (${meaningNuances.join(', ')})`;
        }
        
        return definition;
    }

    async getFreeDictionaryWithExamples(word) {
        try {
            console.log(`🔍 [YandexService] Trying FreeDictionary API for: "${word}"`);
            
            const response = await axios.get(
                `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
                { timeout: 7000 }
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
            meanings: [],
            translations: []
        };

        if (!Array.isArray(data) || data.length === 0) {
            return result;
        }

        const entry = data[0];
        
        if (entry.phonetic) {
            result.transcription = `/${entry.phonetic}/`;
        }

        entry.meanings.forEach(meaning => {
            const pos = meaning.partOfSpeech;
            
            meaning.definitions.forEach((definition, defIndex) => {
                const translation = this.autoTranslateDefinition(definition.definition, word);
                const examples = definition.example ? [{
                    english: definition.example,
                    russian: this.autoTranslateExample(definition.example),
                    full: definition.example
                }] : [];
                
                const detailedMeaning = {
                    partOfSpeech: pos,
                    translation: translation,
                    definition: definition.definition,
                    examples: examples,
                    meaningNuances: [],
                    synonyms: [],
                    source: 'FreeDictionary'
                };
                
                result.meanings.push(detailedMeaning);
                
                if (!result.translations.includes(translation)) {
                    result.translations.push(translation);
                }
            });
        });

        console.log(`✅ [YandexService] FreeDictionary: ${result.meanings.length} meanings`);
        return result;
    }

    autoTranslateDefinition(definition, word) {
        const simpleDef = definition
            .toLowerCase()
            .replace(new RegExp(word, 'gi'), '')
            .split('.')[0]
            .trim()
            .substring(0, 50);
            
        return simpleDef || `значение "${word}"`;
    }

    autoTranslateExample(example) {
        return `перевод: ${example.substring(0, 30)}...`;
    }

    getBasicFallback(word) {
        console.log(`⚠️ [YandexService] Using basic fallback for: "${word}"`);
        
        return {
            word: word,
            transcription: `/${word}/`,
            audioUrl: `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(word)}&tl=en-gb&client=tw-ob`,
            meanings: [{
                partOfSpeech: 'noun',
                translation: `перевод "${word}"`,
                definition: `Basic definition of ${word}`,
                examples: [],
                meaningNuances: [],
                synonyms: [],
                source: 'fallback'
            }],
            translations: [`перевод "${word}"`]
        };
    }

    isRussianText(text) {
        return /[а-яА-Я]/.test(text);
    }
}
