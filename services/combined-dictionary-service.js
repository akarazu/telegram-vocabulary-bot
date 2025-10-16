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

        // ✅ 1. Получаем данные от Яндекс (английское слово -> русский)
        if (this.useYandex) {
            try {
                console.log(`🔍 [CombinedService] Getting Yandex data for English word: "${word}"`);
                const yandexData = await this.getYandexDataEnRu(word);
                
                if (yandexData.meanings.length > 0) {
                    result.meanings = yandexData.meanings;
                    result.translations = yandexData.translations;
                    result.transcription = yandexData.transcription;
                    result.audioUrl = yandexData.audioUrl;
                    console.log(`✅ [CombinedService] Yandex SUCCESS: ${result.meanings.length} meanings`);
                    
                    // ✅ 2. Для каждого значения ищем примеры в Free Dictionary
                    await this.enrichWithFreeDictExamples(result);
                } else {
                    console.log(`❌ [CombinedService] Yandex returned 0 meanings`);
                }
            } catch (error) {
                console.log(`❌ [CombinedService] Yandex ERROR: ${error.message}`);
            }
        }

        console.log(`📊 [CombinedService] FINAL RESULT:`);
        console.log(`   - Word: ${result.word}`);
        console.log(`   - Meanings: ${result.meanings.length}`);
        console.log(`   - Translations: ${result.translations.length}`);
        
        result.meanings.forEach((meaning, index) => {
            console.log(`   ${index + 1}. "${meaning.translation}" (${meaning.partOfSpeech}) -> "${meaning.englishDefinition}"`);
            console.log(`      Examples: ${meaning.examples?.length || 0}`);
            if (meaning.examples && meaning.examples.length > 0) {
                meaning.examples.forEach((ex, exIndex) => {
                    console.log(`        ${exIndex + 1}. ${ex.english}`);
                });
            }
        });
        
        console.log(`🎯 ========== END getWordData for: "${word}" ==========\n`);
        
        return result;
    }

    async getYandexDataEnRu(word) {
        try {
            console.log(`\n🔍 [Yandex] Making API request for EN-RU: "${word}"`);
            
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
            return this.processYandexResponseEnRu(response.data, word);
            
        } catch (error) {
            console.error(`❌ [Yandex] API ERROR:`, {
                message: error.message,
                status: error.response?.status
            });
            throw new Error(`Yandex: ${error.message}`);
        }
    }

    processYandexResponseEnRu(data, word) {
        console.log(`\n🔍 [Yandex] Processing EN-RU response for: "${word}"`);
        
        const result = {
            word: word,
            transcription: '',
            audioUrl: `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(word)}&tl=en-gb&client=tw-ob`,
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
        }

        // ✅ ИЗВЛЕКАЕМ ЗНАЧЕНИЯ И ПЕРЕВОДЫ
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

                        // ✅ СОЗДАЕМ ЗНАЧЕНИЕ
                        const detailedMeaning = {
                            id: `yd_${defIndex}_${transIndex}`,
                            englishWord: englishWord,
                            translation: russianTranslation,
                            englishDefinition: this.extractRealEnglishDefinition(translation, englishWord),
                            partOfSpeech: this.normalizePOS(translationPOS),
                            examples: [], // Будем заполнять из FreeDict
                            source: 'Yandex'
                        };

                        result.meanings.push(detailedMeaning);
                        
                        if (!result.translations.includes(russianTranslation)) {
                            result.translations.push(russianTranslation);
                        }

                        console.log(`      ✅ Created meaning: "${detailedMeaning.englishDefinition}"`);
                    }
                });
            }
        });

        console.log(`🎯 [Yandex] Processed ${result.meanings.length} meanings, ${result.translations.length} translations`);
        return result;
    }

    async enrichWithFreeDictExamples(result) {
        console.log(`\n🔍 [FreeDict] Enriching with examples for: "${result.word}"`);
        
        for (const meaning of result.meanings) {
            try {
                console.log(`\n📖 Processing meaning: "${meaning.englishWord}" -> "${meaning.translation}"`);
                console.log(`   - POS: ${meaning.partOfSpeech}`);
                console.log(`   - English definition: "${meaning.englishDefinition}"`);
                
                // ✅ Ищем примеры в Free Dictionary
                const examples = await this.findExamplesInFreeDict(
                    meaning.englishWord,
                    meaning.partOfSpeech,
                    meaning.englishDefinition
                );
                
                meaning.examples = examples;
                console.log(`   ✅ Found ${examples.length} examples`);
                
            } catch (error) {
                console.log(`   ❌ Error finding examples: ${error.message}`);
                meaning.examples = [];
            }
        }
    }

    async findExamplesInFreeDict(englishWord, pos, englishDefinition) {
        try {
            console.log(`   🔍 Searching FreeDict for: "${englishWord}" (${pos})`);
            
            const response = await axios.get(
                `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(englishWord)}`,
                { timeout: 5000 }
            );

            const data = response.data;
            
            if (!Array.isArray(data) || data.length === 0) {
                console.log(`   ❌ No FreeDict data found`);
                return [];
            }

            const entry = data[0];
            const examples = [];

            // ✅ Ищем значения с подходящей частью речи
            if (entry.meanings && Array.isArray(entry.meanings)) {
                for (const meaning of entry.meanings) {
                    const freeDictPOS = this.normalizePOS(meaning.partOfSpeech);
                    
                    // ✅ Проверяем совпадение части речи
                    if (freeDictPOS === pos) {
                        console.log(`   ✅ POS match: ${freeDictPOS}`);
                        
                        if (meaning.definitions && Array.isArray(meaning.definitions)) {
                            for (const definition of meaning.definitions) {
                                // ✅ Проверяем вхождение ключевых слов из английского определения
                                if (this.doesDefinitionMatch(englishDefinition, definition.definition)) {
                                    console.log(`   ✅ Definition match found`);
                                    
                                    // ✅ Берем пример если есть
                                    if (definition.example) {
                                        examples.push({
                                            english: definition.example,
                                            russian: ''
                                        });
                                        console.log(`   ✅ Added example: ${definition.example.substring(0, 50)}...`);
                                    }
                                }
                            }
                        }
                    }
                }
            }

            return examples.slice(0, 2); // Ограничиваем количество примеров

        } catch (error) {
            console.log(`   ❌ FreeDict error: ${error.message}`);
            return [];
        }
    }

    doesDefinitionMatch(yandexDefinition, freeDictDefinition) {
        if (!freeDictDefinition) return false;
        
        // ✅ Извлекаем ключевые слова из Яндекс определения
        const keywords = this.extractKeywords(yandexDefinition);
        const freeDictLower = freeDictDefinition.toLowerCase();
        
        console.log(`      Checking definition match:`);
        console.log(`      Yandex: "${yandexDefinition}"`);
        console.log(`      FreeDict: "${freeDictDefinition}"`);
        console.log(`      Keywords: ${keywords.join(', ')}`);
        
        // ✅ Проверяем вхождение ключевых слов
        for (const keyword of keywords) {
            if (freeDictLower.includes(keyword)) {
                console.log(`      ✅ Keyword "${keyword}" found in FreeDict definition`);
                return true;
            }
        }
        
        console.log(`      ❌ No keyword matches found`);
        return false;
    }

    extractKeywords(definition) {
        // Извлекаем значимые слова из определения
        const words = definition.toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(word => 
                word.length > 3 && // Слова длиннее 3 символов
                !this.isStopWord(word)
            );
        
        return [...new Set(words)]; // Уникальные слова
    }

    isStopWord(word) {
        const stopWords = new Set([
            'the', 'and', 'for', 'with', 'from', 'that', 'this', 'which',
            'have', 'has', 'had', 'been', 'being', 'what', 'when', 'where',
            'who', 'whom', 'whose', 'how', 'why', 'because', 'about'
        ]);
        return stopWords.has(word);
    }

    extractRealEnglishDefinition(translation, englishWord) {
        // ✅ ПРИОРИТЕТ 1: поле "mean" - английские значения
        if (translation.mean && Array.isArray(translation.mean)) {
            const englishMeans = translation.mean
                .filter(mean => mean.text && !this.isRussianText(mean.text))
                .map(mean => mean.text);

            if (englishMeans.length > 0) {
                return englishMeans.join(', ');
            }
        }

        // ✅ ПРИОРИТЕТ 2: базовое определение
        return `${englishWord} - ${translation.text}`;
    }

    normalizePOS(pos) {
        if (!pos) return 'unknown';
        
        const posMap = {
            // Русские -> английские
            'существительное': 'noun',
            'глагол': 'verb', 
            'прилагательное': 'adjective',
            'наречие': 'adverb',
            'местоимение': 'pronoun',
            'предлог': 'preposition',
            'союз': 'conjunction',
            'междометие': 'interjection',
            // Английские -> нормализованные
            'noun': 'noun',
            'verb': 'verb',
            'adjective': 'adjective',
            'adverb': 'adverb',
            'pronoun': 'pronoun',
            'preposition': 'preposition',
            'conjunction': 'conjunction',
            'interjection': 'interjection'
        };

        const normalized = posMap[pos.toLowerCase()] || pos.toLowerCase();
        return normalized;
    }

    isRussianText(text) {
        return /[а-яА-Я]/.test(text);
    }
}
