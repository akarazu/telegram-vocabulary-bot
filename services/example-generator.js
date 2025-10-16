import axios from 'axios';

export class ExampleGeneratorService {
    constructor() {
        this.useYandex = !!process.env.YANDEX_DICTIONARY_API_KEY;
    }

    async getWordWithAutoExamples(word) {
        console.log(`🔍 Getting word data with Yandex examples for: "${word}"`);
        
        const result = {
            word: word,
            transcription: '',
            audioUrl: '',
            meanings: [], // ✅ ЗНАЧЕНИЯ С ПРИМЕРАМИ ИЗ YANDEX
            translations: []
        };

        // ✅ ПЕРВОЕ: Яндекс Dictionary API (дает переводы + примеры)
        if (this.useYandex) {
            try {
                const yandexData = await this.getYandexWithExamples(word);
                if (yandexData.meanings.length > 0) {
                    console.log(`✅ Yandex found ${yandexData.meanings.length} meanings with examples`);
                    return yandexData;
                }
            } catch (error) {
                console.log('❌ Yandex failed:', error.message);
            }
        }

        // ✅ ВТОРОЕ: Free Dictionary API (fallback)
        try {
            const freeDictData = await this.getFreeDictionaryWithExamples(word);
            if (freeDictData.meanings.length > 0) {
                console.log(`✅ FreeDictionary found ${freeDictData.meanings.length} meanings with examples`);
                return freeDictData;
            }
        } catch (error) {
            console.log('❌ FreeDictionary failed:', error.message);
        }

        // ✅ ФИНАЛЬНЫЙ FALLBACK
        return this.getBasicFallback(word);
    }

    async getYandexWithExamples(word) {
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

            console.log('📊 Yandex raw response:', JSON.stringify(response.data, null, 2));
            return this.processYandexResponseWithExamples(response.data, word);
            
        } catch (error) {
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
            console.log('❌ Yandex: No definitions found');
            return result;
        }

        console.log(`🔍 Yandex found ${data.def.length} definition(s)`);

        // 🎯 **ОБРАБАТЫВАЕМ КАЖДОЕ ОПРЕДЕЛЕНИЕ ИЗ YANDEX**
        data.def.forEach((definition, defIndex) => {
            const mainPOS = definition.pos || 'unknown';
            
            console.log(`📖 Definition ${defIndex + 1}: POS=${mainPOS}`);

            if (definition.tr && Array.isArray(definition.tr)) {
                definition.tr.forEach((translation, transIndex) => {
                    if (translation.text && this.isRussianText(translation.text)) {
                        
                        // ✅ **ШАГ 1: ИЗВЛЕКАЕМ ОСНОВНЫЕ ДАННЫЕ**
                        const russianTranslation = translation.text.trim();
                        const translationPOS = translation.pos || mainPOS;
                        
                        console.log(`   🔸 Translation ${transIndex + 1}: "${russianTranslation}" (${translationPOS})`);

                        // ✅ **ШАГ 2: ИЗВЛЕКАЕМ ПРИМЕРЫ ИЗ YANDEX**
                        const examples = this.extractExamplesFromYandex(translation);
                        console.log(`   📝 Found ${examples.length} examples`);

                        // ✅ **ШАГ 3: ИЗВЛЕКАЕМ ОТТЕНКИ ЗНАЧЕНИЙ (mean)**
                        const meaningNuances = this.extractMeaningNuances(translation);
                        
                        // ✅ **ШАГ 4: СОЗДАЕМ СВЯЗАННУЮ СТРУКТУРУ**
                        const detailedMeaning = {
                            partOfSpeech: translationPOS,
                            translation: russianTranslation,
                            definition: this.buildDefinition(translation, meaningNuances),
                            examples: examples, // ✅ ПРИМЕРЫ ИЗ YANDEX!
                            meaningNuances: meaningNuances,
                            synonyms: translation.syn ? translation.syn.map(s => s.text) : [],
                            source: 'Yandex'
                        };
                        
                        result.meanings.push(detailedMeaning);
                        
                        // ✅ ДЛЯ ОБРАТНОЙ СОВМЕСТИМОСТИ
                        if (!result.translations.includes(russianTranslation)) {
                            result.translations.push(russianTranslation);
                        }
                    }
                });
            }
        });

        // ✅ ТРАНСКРИПЦИЯ (если есть)
        if (data.def[0].ts) {
            result.transcription = `/${data.def[0].ts}/`;
        }

        console.log(`🎯 Final: ${result.meanings.length} meanings with ${result.meanings.reduce((acc, m) => acc + m.examples.length, 0)} examples`);
        return result;
    }

    extractExamplesFromYandex(translation) {
        const examples = [];
        
        // 🎯 **ИЗВЛЕКАЕМ ПРИМЕРЫ ИЗ ПОЛЯ "ex"**
        if (translation.ex && Array.isArray(translation.ex)) {
            translation.ex.forEach(exampleObj => {
                if (exampleObj.text && exampleObj.tr && Array.isArray(exampleObj.tr)) {
                    // ✅ СОЗДАЕМ ПАРУ: английский пример + русский перевод
                    const englishExample = exampleObj.text;
                    const russianTranslation = exampleObj.tr[0].text;
                    
                    examples.push({
                        english: englishExample,
                        russian: russianTranslation,
                        full: `${englishExample} - ${russianTranslation}`
                    });
                    
                    console.log(`      📚 Example: "${englishExample}" → "${russianTranslation}"`);
                }
            });
        }
        
        return examples;
    }

    extractMeaningNuances(translation) {
        const nuances = [];
        
        // 🎯 **ИЗВЛЕКАЕМ ОТТЕНКИ ЗНАЧЕНИЙ ИЗ ПОЛЯ "mean"**
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
        // ✅ СОЗДАЕМ ПОДРОБНОЕ ОПРЕДЕЛЕНИЕ НА ОСНОВЕ ДАННЫХ YANDEX
        let definition = translation.text;
        
        if (meaningNuances.length > 0) {
            definition += ` (${meaningNuances.join(', ')})`;
        }
        
        return definition;
    }

    async getFreeDictionaryWithExamples(word) {
        try {
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
        
        // ✅ ТРАНСКРИПЦИЯ
        if (entry.phonetic) {
            result.transcription = `/${entry.phonetic}/`;
        }

        // ✅ ОБРАБАТЫВАЕМ FREE DICTIONARY (FALLBACK)
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
        // Упрощенный "перевод" примера
        return `перевод: ${example.substring(0, 30)}...`;
    }

    getBasicFallback(word) {
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

