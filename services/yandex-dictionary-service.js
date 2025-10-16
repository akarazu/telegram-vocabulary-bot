import axios from 'axios';

export class YandexDictionaryService {
    constructor() {
        this.useYandex = !!process.env.YANDEX_DICTIONARY_API_KEY;
    }

    async getWordWithAutoExamples(word) {
        console.log(`🔍 [YandexService] Getting word data for: "${word}"`);
        
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
                    console.log(`✅ [YandexService] Yandex found ${yandexData.meanings.length} meanings`);
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
                console.log(`✅ [YandexService] FreeDictionary found ${freeDictData.meanings.length} meanings`);
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
            return result;
        }

        data.def.forEach((definition, defIndex) => {
            const mainPOS = definition.pos || 'unknown';
            const englishWord = definition.text || word;
            
            if (definition.tr && Array.isArray(definition.tr)) {
                definition.tr.forEach((translation, transIndex) => {
                    if (translation.text && this.isRussianText(translation.text)) {
                        const russianTranslation = translation.text.trim();
                        const translationPOS = translation.pos || mainPOS;
                        
                        // ✅ СОЗДАЕМ ЗНАЧЕНИЕ С АНГЛИЙСКИМ ОПРЕДЕЛЕНИЕМ
                        const detailedMeaning = {
                            id: `${defIndex}_${transIndex}`,
                            translation: russianTranslation,
                            englishDefinition: this.buildEnglishDefinition(englishWord, translation),
                            englishWord: englishWord,
                            synonyms: translation.syn ? translation.syn.map(s => s.text).filter(Boolean) : [],
                            nuances: translation.mean ? translation.mean.map(m => m.text).filter(Boolean) : [],
                            source: 'Yandex'
                        };
                        
                        result.meanings.push(detailedMeaning);
                        
                        if (!result.translations.includes(russianTranslation)) {
                            result.translations.push(russianTranslation);
                        }
                    }
                });
            }
        });

        if (data.def[0].ts) {
            result.transcription = `/${data.def[0].ts}/`;
        }

        return result;
    }

    buildEnglishDefinition(englishWord, translation) {
        let definition = englishWord;
        
        // ✅ ДОБАВЛЯЕМ АНГЛИЙСКИЕ ОТТЕНКИ ЗНАЧЕНИЙ
        if (translation.mean && translation.mean.length > 0) {
            const englishNuances = translation.mean.map(m => m.text).filter(Boolean);
            if (englishNuances.length > 0) {
                definition += ` (${englishNuances.join(', ')})`;
            }
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
        
        if (entry.phonetic) {
            result.transcription = `/${entry.phonetic}/`;
        }

        entry.meanings.forEach(meaning => {
            const pos = meaning.partOfSpeech;
            
            meaning.definitions.forEach((definition, defIndex) => {
                const translation = this.autoTranslateDefinition(definition.definition, word);
                
                const detailedMeaning = {
                    id: `free_${defIndex}`,
                    translation: translation,
                    englishDefinition: definition.definition,
                    englishWord: word,
                    synonyms: [],
                    nuances: [],
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

    getBasicFallback(word) {
        return {
            word: word,
            transcription: `/${word}/`,
            audioUrl: `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(word)}&tl=en-gb&client=tw-ob`,
            meanings: [{
                id: 'fallback',
                translation: `перевод "${word}"`,
                englishDefinition: word,
                englishWord: word,
                synonyms: [],
                nuances: [],
                source: 'fallback'
            }],
            translations: [`перевод "${word}"`]
        };
    }

    isRussianText(text) {
        return /[а-яА-Я]/.test(text);
    }
}
