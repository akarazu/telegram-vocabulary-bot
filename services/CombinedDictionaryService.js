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

        // ✅ Free Dictionary для значений и определений
        let freeDictData = null;
        try {
            freeDictData = await this.getFreeDictionaryData(word);
            if (freeDictData.meanings.length > 0) {
                result.meanings = freeDictData.meanings;
                result.translations = freeDictData.translations;
                result.audioUrl = freeDictData.audioUrl;
                console.log(`✅ [CombinedService] FreeDictionary found ${result.meanings.length} meanings`);
            }
        } catch (error) {
            console.log('❌ [CombinedService] FreeDictionary failed:', error.message);
        }

        // ✅ Яндекс для транскрипции
        if (this.useYandex) {
            try {
                const yandexData = await this.getYandexTranscription(word);
                if (yandexData.transcription) {
                    result.transcription = yandexData.transcription;
                    console.log(`✅ [CombinedService] Yandex transcription: ${result.transcription}`);
                }
            } catch (error) {
                console.log('❌ [CombinedService] Yandex transcription failed:', error.message);
            }
        }

        // ✅ Если нет транскрипции от Яндекс, используем из FreeDictionary
        if (!result.transcription && freeDictData && freeDictData.transcription) {
            result.transcription = freeDictData.transcription;
        }

        // ✅ Fallback если ничего не нашли
        if (result.meanings.length === 0) {
            return this.getBasicFallback(word);
        }

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
            meanings: [],
            translations: []
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
                
                // ✅ СОЗДАЕМ РУССКИЙ ПЕРЕВОД
                const russianTranslation = this.generateRussianTranslation(definition.definition, word, partOfSpeech);
                
                // ✅ СОЗДАЕМ ЗНАЧЕНИЕ С АНГЛИЙСКИМ ОПРЕДЕЛЕНИЕМ
                const detailedMeaning = {
                    id: `meaning_${meaningId}`,
                    translation: russianTranslation,
                    englishDefinition: this.buildEnglishDefinition(definition.definition, partOfSpeech),
                    englishWord: word,
                    example: definition.example || '',
                    source: 'FreeDictionary'
                };
                
                result.meanings.push(detailedMeaning);
                
                // ✅ ДОБАВЛЯЕМ В ПЕРЕВОДЫ
                if (!result.translations.includes(russianTranslation)) {
                    result.translations.push(russianTranslation);
                }
            });
        });

        console.log(`🎯 [CombinedService] FreeDictionary: ${result.meanings.length} meanings`);
        return result;
    }

    async getYandexTranscription(word) {
        if (!this.useYandex) {
            return { transcription: '' };
        }

        try {
            console.log(`🔍 [CombinedService] Making Yandex request for transcription: "${word}"`);
            
            const response = await axios.get('https://dictionary.yandex.net/api/v1/dicservice.json/lookup', {
                params: {
                    key: process.env.YANDEX_DICTIONARY_API_KEY,
                    lang: 'en-ru',
                    text: word,
                    ui: 'ru'
                },
                timeout: 5000
            });

            return this.extractYandexTranscription(response.data);
            
        } catch (error) {
            console.log('❌ [CombinedService] Yandex transcription error:', error.message);
            return { transcription: '' };
        }
    }

    extractYandexTranscription(data) {
        if (!data.def || data.def.length === 0) {
            return { transcription: '' };
        }

        // ✅ ИЗВЛЕКАЕМ ТРАНСКРИПЦИЮ ИЗ YANDEX
        if (data.def[0].ts) {
            return { transcription: `/${data.def[0].ts}/` };
        }

        return { transcription: '' };
    }

    buildEnglishDefinition(definition, partOfSpeech) {
        let englishDef = definition;
        
        // ✅ ОГРАНИЧИВАЕМ ДЛИНУ
        if (englishDef.length > 60) {
            englishDef = englishDef.substring(0, 57) + '...';
        }
        
        return englishDef;
    }

    generateRussianTranslation(englishDefinition, word, partOfSpeech) {
        // ✅ ПРОСТОЙ ПЕРЕВОД ЧАСТЕЙ РЕЧИ
        const posTranslations = {
            'noun': 'сущ.',
            'verb': 'гл.', 
            'adjective': 'прил.',
            'adverb': 'нар.',
            'pronoun': 'мест.',
            'preposition': 'предл.',
            'conjunction': 'союз',
            'interjection': 'межд.'
        };
        
        const posTranslation = posTranslations[partOfSpeech] || partOfSpeech;
        
        // ✅ СОЗДАЕМ ПРОСТОЙ РУССКИЙ ПЕРЕВОД
        const keyWords = this.extractKeyWords(englishDefinition);
        let translation = word;
        
        if (keyWords.length > 0) {
            translation = `${keyWords.slice(0, 2).join(' ')}`;
        }
        
        // ✅ ДОБАВЛЯЕМ СОКРАЩЕННУЮ ЧАСТЬ РЕЧИ
        translation += ` (${posTranslation})`;
        
        // ✅ ОГРАНИЧИВАЕМ ДЛИНУ
        if (translation.length > 30) {
            translation = translation.substring(0, 27) + '...';
        }
        
        return translation;
    }

    extractKeyWords(text) {
        // ✅ ИЗВЛЕКАЕМ КЛЮЧЕВЫЕ СЛОВА ИЗ ОПРЕДЕЛЕНИЯ
        const words = text.toLowerCase()
            .replace(/[^a-zA-Z\s]/g, '')
            .split(/\s+/)
            .filter(word => 
                word.length > 3 && 
                !['that', 'with', 'from', 'this', 'that', 'have', 'which', 'their'].includes(word)
            )
            .slice(0, 3);
            
        return [...new Set(words)];
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
                example: '',
                source: 'fallback'
            }],
            translations: [`перевод "${word}"`]
        };
    }
}
