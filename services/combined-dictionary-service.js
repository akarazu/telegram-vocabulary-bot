import axios from 'axios';

export class CombinedDictionaryService {
    constructor() {
        this.useYandex = !!process.env.YANDEX_DICTIONARY_API_KEY;
        console.log(`🔧 [SmartCombinedService] Initialized. Yandex API: ${this.useYandex}`);
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

        let yandexData = null;
        let freeDictData = null;

        // ✅ 1. Получаем данные от Яндекс
        if (this.useYandex) {
            try {
                console.log(`🔍 [Smart] Getting Yandex data...`);
                yandexData = await this.getYandexData(word);
                
                if (yandexData.meanings.length > 0) {
                    result.meanings = yandexData.meanings;
                    result.translations = yandexData.translations;
                    result.transcription = yandexData.transcription;
                    console.log(`✅ [Smart] Yandex SUCCESS: ${result.meanings.length} meanings`);
                }
            } catch (error) {
                console.log(`❌ [Smart] Yandex ERROR: ${error.message}`);
            }
        }

        // ✅ 2. Получаем данные от Free Dictionary
        try {
            console.log(`🔍 [Smart] Getting FreeDictionary data...`);
            freeDictData = await this.getFreeDictionaryData(word);
            
            if (freeDictData.meanings.length > 0) {
                console.log(`✅ [Smart] FreeDictionary SUCCESS: ${freeDictData.meanings.length} meanings`);
                
                // 🔥 3. Сопоставляем данные между API
                if (yandexData && yandexData.meanings.length > 0) {
                    await this.matchAndEnrichExamples(result, yandexData, freeDictData);
                } else {
                    // Если Яндекс не сработал, используем Free Dictionary
                    result.meanings = freeDictData.meanings;
                    result.audioUrl = freeDictData.audioUrl;
                    result.transcription = freeDictData.transcription;
                    this.createTranslationsForFreeDict(result);
                }
            }
        } catch (error) {
            console.log(`❌ [Smart] FreeDictionary ERROR: ${error.message}`);
        }

        // ✅ 4. Fallback если оба API не сработали
        if (result.meanings.length === 0) {
            console.log(`⚠️ [Smart] No data from APIs, using fallback`);
            this.createBasicMeanings(result, word);
        }

        console.log(`📊 [Smart] FINAL RESULT:`);
        console.log(`   - Word: ${result.word}`);
        console.log(`   - Transcription: ${result.transcription}`);
        console.log(`   - Meanings: ${result.meanings.length}`);
        console.log(`   - Translations: ${result.translations.length}`);
        
        result.meanings.forEach((meaning, index) => {
            console.log(`   ${index + 1}. "${meaning.translation}" -> "${meaning.englishDefinition}"`);
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

    async matchAndEnrichExamples(result, yandexData, freeDictData) {
        console.log(`\n🔍 [Smart] Starting data matching between APIs...`);
        
        const matchedMeanings = [];
        let matchCount = 0;

        // ✅ Для каждого значения из Яндекс
        for (const yandexMeaning of yandexData.meanings) {
            console.log(`\n📖 [Smart] Processing Yandex meaning: "${yandexMeaning.translation}"`);
            console.log(`   - POS: ${yandexMeaning.partOfSpeech}`);
            console.log(`   - Definition: ${yandexMeaning.englishDefinition}`);

            // ✅ Разбиваем значения из Яндекс по запятым
            const yandexValues = this.splitYandexValues(yandexMeaning.englishDefinition);
            console.log(`   - Split values: ${yandexValues.join(' | ')}`);

            // ✅ Ищем соответствующее значение в Free Dictionary
            const matchedFreeDictMeaning = this.findMatchingMeaning(
                yandexMeaning, 
                yandexValues,
                freeDictData.meanings
            );

            if (matchedFreeDictMeaning) {
                console.log(`   ✅ FOUND MATCH in FreeDictionary!`);
                
                // ✅ Создаем обогащенное значение
                const enrichedMeaning = this.createEnrichedMeaning(
                    yandexMeaning,
                    matchedFreeDictMeaning
                );
                
                matchedMeanings.push(enrichedMeaning);
                matchCount++;
            } else {
                console.log(`   ❌ NO MATCH found in FreeDictionary`);
                // Используем оригинальное значение из Яндекс без примеров
                matchedMeanings.push(yandexMeaning);
            }
        }

        result.meanings = matchedMeanings;
        console.log(`\n🎯 [Smart] Matching completed: ${matchCount}/${yandexData.meanings.length} meanings enriched with examples`);
    }

    splitYandexValues(definition) {
        // Разбиваем определение из Яндекс по запятым, но учитываем контекст
        const values = definition.split(',')
            .map(value => value.trim())
            .filter(value => value.length > 0);
        
        // Также добавляем оригинальное определение целиком
        if (values.length > 1) {
            values.unshift(definition);
        }
        
        return values;
    }

    findMatchingMeaning(yandexMeaning, yandexValues, freeDictMeanings) {
        const yandexPOS = this.normalizePOS(yandexMeaning.partOfSpeech);
        console.log(`   🔍 Looking for match - Yandex POS: "${yandexPOS}"`);

        // ✅ 1. Сначала ищем по точному совпадению части речи
        for (const freeDictMeaning of freeDictMeanings) {
            const freeDictPOS = this.normalizePOS(freeDictMeaning.partOfSpeech);
            console.log(`      Comparing with FreeDict POS: "${freeDictPOS}"`);

            if (this.doPOSMatch(yandexPOS, freeDictPOS)) {
                console.log(`      ✅ POS MATCH! Checking definition...`);
                
                // ✅ 2. Проверяем гибкое соответствие между значениями
                if (this.doesDefinitionMatchFlexible(yandexValues, freeDictMeaning)) {
                    console.log(`      ✅ DEFINITION MATCH!`);
                    return freeDictMeaning;
                } else {
                    console.log(`      ❌ Definition doesn't match`);
                }
            }
        }

        // ✅ 3. Если не нашли по точному совпадению POS, ищем любое значение с подходящим определением
        console.log(`   🔍 No exact POS match, looking for flexible definition match...`);
        for (const freeDictMeaning of freeDictMeanings) {
            if (this.doesDefinitionMatchFlexible(yandexValues, freeDictMeaning)) {
                console.log(`      ✅ Found meaning with definition match (flexible POS)`);
                return freeDictMeaning;
            }
        }

        // ✅ 4. Последний fallback - любое значение с примерами
        console.log(`   🔍 No definition match, looking for any meaning with examples...`);
        for (const freeDictMeaning of freeDictMeanings) {
            if (freeDictMeaning.examples && freeDictMeaning.examples.length > 0) {
                console.log(`      ✅ Found meaning with examples (fallback)`);
                return freeDictMeaning;
            }
        }

        return null;
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

    doPOSMatch(yandexPOS, freeDictPOS) {
        // Точное совпадение или общие категории
        if (yandexPOS === freeDictPOS) return true;
        
        // Группируем похожие части речи
        const posGroups = {
            'noun': ['noun'],
            'verb': ['verb'],
            'adjective': ['adjective'],
            'adverb': ['adverb']
        };

        const yandexGroup = Object.keys(posGroups).find(group => 
            posGroups[group].includes(yandexPOS)
        );
        const freeDictGroup = Object.keys(posGroups).find(group => 
            posGroups[group].includes(freeDictPOS)
        );

        return yandexGroup && freeDictGroup && yandexGroup === freeDictGroup;
    }

    doesDefinitionMatchFlexible(yandexValues, freeDictMeaning) {
        const freeDictDefinition = freeDictMeaning.englishDefinition.toLowerCase();
        console.log(`      FreeDict definition: ${freeDictDefinition}`);
        
        let bestMatchScore = 0;
        let bestMatchValue = '';

        // ✅ Для каждого значения из Яндекс (разделенного по запятым)
        for (const yandexValue of yandexValues) {
            const yandexKeywords = this.extractKeywords(yandexValue);
            console.log(`      Checking Yandex value: "${yandexValue}"`);
            console.log(`      Yandex keywords: ${yandexKeywords.join(', ')}`);

            const matchScore = this.calculateMatchScore(yandexKeywords, freeDictDefinition, yandexValue);
            console.log(`      Match score: ${matchScore.toFixed(2)}`);

            if (matchScore > bestMatchScore) {
                bestMatchScore = matchScore;
                bestMatchValue = yandexValue;
            }
        }

        // ✅ Устанавливаем порог совпадения
        const threshold = 0.3;
        const isMatch = bestMatchScore >= threshold;
        
        if (isMatch) {
            console.log(`      ✅ BEST MATCH: "${bestMatchValue}" (score: ${bestMatchScore.toFixed(2)})`);
        } else {
            console.log(`      ❌ No good match found (best score: ${bestMatchScore.toFixed(2)})`);
        }

        return isMatch;
    }

    calculateMatchScore(yandexKeywords, freeDictDefinition, yandexValue) {
        let score = 0;
        let matchedKeywords = 0;

        // ✅ 1. Подсчет совпадающих ключевых слов
        for (const keyword of yandexKeywords) {
            if (freeDictDefinition.includes(keyword)) {
                matchedKeywords++;
            }
        }

        // ✅ 2. Вес по совпадающим ключевым словам
        if (yandexKeywords.length > 0) {
            score += (matchedKeywords / yandexKeywords.length) * 0.6;
        }

        // ✅ 3. Сходство по длине определения
        const yandexWords = yandexValue.split(/\s+/).filter(w => w.length > 0);
        const freeDictWords = freeDictDefinition.split(/\s+/).filter(w => w.length > 0);
        
        const yandexLength = yandexWords.length;
        const freeDictLength = freeDictWords.length;
        
        if (Math.max(yandexLength, freeDictLength) > 0) {
            const lengthSimilarity = 1 - Math.abs(yandexLength - freeDictLength) / Math.max(yandexLength, freeDictLength);
            score += lengthSimilarity * 0.2;
        }

        // ✅ 4. Наличие общих значимых слов
        const yandexSignificantWords = new Set(yandexWords.filter(w => !this.isStopWord(w)));
        const freeDictSignificantWords = new Set(freeDictWords.filter(w => !this.isStopWord(w)));
        
        let commonWords = 0;
        yandexSignificantWords.forEach(word => {
            if (freeDictSignificantWords.has(word)) commonWords++;
        });

        if (yandexSignificantWords.size > 0) {
            score += (commonWords / yandexSignificantWords.size) * 0.2;
        }

        return Math.min(score, 1.0);
    }

    extractKeywords(definition) {
        const words = definition.toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(word => 
                word.length > 2 &&
                !this.isStopWord(word)
            );
        
        return [...new Set(words)];
    }

    isStopWord(word) {
        const stopWords = new Set([
            'the', 'and', 'for', 'with', 'from', 'that', 'this', 'which',
            'have', 'has', 'had', 'been', 'being', 'what', 'when', 'where',
            'who', 'whom', 'whose', 'how', 'why', 'because', 'about', 'their',
            'them', 'then', 'than', 'its', 'into', 'upon', 'without', 'within',
            'would', 'could', 'should', 'might', 'may', 'can', 'will', 'shall'
        ]);
        return stopWords.has(word);
    }

    createEnrichedMeaning(yandexMeaning, freeDictMeaning) {
        console.log(`   🎨 Creating enriched meaning...`);
        console.log(`      Yandex: ${yandexMeaning.englishDefinition}`);
        console.log(`      FreeDict examples: ${freeDictMeaning.examples?.length || 0}`);

        return {
            ...yandexMeaning,
            examples: freeDictMeaning.examples || [],
            enriched: true,
            source: 'Yandex + FreeDictionary'
        };
    }

    async getYandexData(word) {
        try {
            console.log(`\n🔍 [Yandex] Making API request for: "${word}"`);
            
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
            return this.processYandexResponse(response.data, word);
            
        } catch (error) {
            console.error(`❌ [Yandex] API ERROR:`, {
                message: error.message,
                status: error.response?.status
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
        }

        // ✅ ИЗВЛЕКАЕМ ЗНАЧЕНИЯ
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
                            translation: russianTranslation,
                            englishDefinition: this.extractRealEnglishDefinition(translation, englishWord),
                            englishWord: englishWord,
                            partOfSpeech: this.translatePOS(translationPOS),
                            examples: [], // Будем заполнять позже
                            synonyms: [],
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
                                synonyms: [],
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
