import axios from 'axios';

export class ExampleGeneratorService {
    constructor() {
        console.log('🔧 ExampleGeneratorService initialized - Using Free Dictionary API with POS support');
    }

    async generateExamples(word, translation, selectedTranslationIndices = [], translationsWithPOS = []) {
        console.log(`\n🔄 ========== GENERATING EXAMPLES ==========`);
        console.log(`🔄 Input: word="${word}", translation="${translation}"`);
        console.log(`🔍 Selected indices:`, selectedTranslationIndices);
        console.log(`🔍 Translations with POS:`, translationsWithPOS);
        
        // ✅ ЕСЛИ ЕСТЬ ВЫБРАННЫЕ ПЕРЕВОДЫ С ИНФОРМАЦИЕЙ О ЧАСТЯХ РЕЧИ
        if (selectedTranslationIndices.length > 0 && translationsWithPOS.length > 0) {
            console.log('🔍 Using selected translations with POS analysis');
            const posExamples = this.generateExamplesForSelectedTranslations(word, selectedTranslationIndices, translationsWithPOS);
            if (posExamples.length > 0) {
                return posExamples;
            }
        }
        
        // ✅ ИНАЧЕ ИСПОЛЬЗУЕМ FREE DICTIONARY API
        try {
            console.log('🔍 Getting examples from Free Dictionary API...');
            const examples = await this.getFreeDictionaryExamples(word);
            
            if (examples && examples.length > 0) {
                console.log(`✅ SUCCESS: Found ${examples.length} examples from Free Dictionary API`);
                return examples;
            } else {
                console.log('❌ FAILED: No examples found in Free Dictionary API');
                return this.generateFallbackExamples(word, translation);
            }
        } catch (error) {
            console.log('❌ ERROR: Free Dictionary API failed:', error.message);
            return this.generateFallbackExamples(word, translation);
        }
    }

    // ✅ ГЕНЕРАЦИЯ ПРИМЕРОВ ДЛЯ ВЫБРАННЫХ ПЕРЕВОДОВ С УЧЕТОМ ЧАСТЕЙ РЕЧИ
    generateExamplesForSelectedTranslations(word, selectedIndices, translationsWithPOS) {
        const examples = [];
        
        selectedIndices.forEach(index => {
            if (translationsWithPOS[index]) {
                const translationData = translationsWithPOS[index];
                const translation = translationData.text;
                const pos = translationData.pos;
                
                console.log(`🔍 Processing: "${translation}" (${pos})`);
                
                // Генерируем примеры в зависимости от части речи
                if (this.isNoun(pos)) {
                    examples.push(...this.generateNounExamples(word, translation));
                } else if (this.isVerb(pos)) {
                    examples.push(...this.generateVerbExamples(word, translation));
                } else if (this.isAdjective(pos)) {
                    examples.push(...this.generateAdjectiveExamples(word, translation));
                } else {
                    examples.push(...this.generateGeneralExamples(word, translation));
                }
            }
        });
        
        console.log(`✅ Generated ${examples.length} examples for selected translations`);
        return examples.slice(0, 3);
    }

    // ✅ МЕТОДЫ ГЕНЕРАЦИИ ПРИМЕРОВ ПО ЧАСТЯМ РЕЧИ
    generateNounExamples(word, translation) {
        return [
            `The ${word} was completely unexpected. - ${this.capitalizeFirst(translation)} было совершенно неожиданным.`,
            `They discovered the ${word}. - Они обнаружили ${translation}.`,
            `This ${word} caused serious problems. - Это ${translation} вызвало серьезные проблемы.`
        ];
    }

    generateVerbExamples(word, translation) {
        return [
            `They will ${word} it tomorrow. - Они будут ${translation} это завтра.`,
            `You should not ${word} that. - Тебе не следует ${translation} это.`,
            `He tried to ${word} the plan. - Он попытался ${translation} план.`
        ];
    }

    generateAdjectiveExamples(word, translation) {
        return [
            `It was ${word}. - Это было ${translation}.`,
            `The situation became ${word}. - Ситуация стала ${translation}.`,
            `She looked ${word}. - Она выглядела ${translation}.`
        ];
    }

    generateGeneralExamples(word, translation) {
        return [
            `This is an example with "${word}". - Это пример с "${translation}".`,
            `How to use "${word}" correctly? - Как правильно использовать "${translation}"?`,
            `I often use "${word}" in conversations. - Я часто использую "${translation}" в разговорах.`
        ];
    }

    // ✅ ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ ДЛЯ ОПРЕДЕЛЕНИЯ ЧАСТЕЙ РЕЧИ
    isNoun(pos) {
        if (!pos) return false;
        const lowerPOS = pos.toLowerCase();
        const nounIndicators = ['noun', 'существительное', 'n', 'сущ'];
        return nounIndicators.some(indicator => lowerPOS.includes(indicator));
    }

    isVerb(pos) {
        if (!pos) return false;
        const lowerPOS = pos.toLowerCase();
        const verbIndicators = ['verb', 'глагол', 'v', 'гл'];
        return verbIndicators.some(indicator => lowerPOS.includes(indicator));
    }

    isAdjective(pos) {
        if (!pos) return false;
        const lowerPOS = pos.toLowerCase();
        const adjectiveIndicators = ['adjective', 'прилагательное', 'adj', 'прил'];
        return adjectiveIndicators.some(indicator => lowerPOS.includes(indicator));
    }

    capitalizeFirst(string) {
        return string.charAt(0).toUpperCase() + string.slice(1);
    }

    async getFreeDictionaryExamples(word) {
        try {
            console.log(`🔍 Free Dictionary API call for: "${word}"`);
            
            const encodedWord = encodeURIComponent(word.toLowerCase());
            const response = await axios.get(
                `https://api.dictionaryapi.dev/api/v2/entries/en/${encodedWord}`,
                { timeout: 5000 }
            );

            console.log('✅ Free Dictionary API response received');
            return this.extractExamplesFromFreeDictionary(response.data);
            
        } catch (error) {
            if (error.response && error.response.status === 404) {
                console.log(`❌ Free Dictionary: Word "${word}" not found (404)`);
            } else {
                console.error('❌ Free Dictionary API error:', error.message);
            }
            return [];
        }
    }

    extractExamplesFromFreeDictionary(data) {
        if (!data || !Array.isArray(data) || data.length === 0) {
            console.log('❌ No entries found in Free Dictionary response');
            return [];
        }

        console.log(`📊 Found ${data.length} entry/entries`);

        const examples = [];
        let exampleCount = 0;

        data.forEach((entry) => {
            if (entry.meanings && Array.isArray(entry.meanings)) {
                entry.meanings.forEach((meaning) => {
                    if (meaning.definitions && Array.isArray(meaning.definitions)) {
                        meaning.definitions.forEach((definition) => {
                            if (exampleCount < 3 && definition.example && definition.example.trim()) {
                                const englishExample = definition.example.trim();
                                const formattedExample = `${englishExample} - Пример использования`;
                                examples.push(formattedExample);
                                exampleCount++;
                                console.log(`✅ Free Dictionary example: "${formattedExample}"`);
                            }
                        });
                    }
                });
            }
        });

        console.log(`📊 Extracted ${examples.length} examples from Free Dictionary`);
        return examples;
    }

    generateFallbackExamples(word, translation) {
        console.log('✏️ Using fallback examples');
        
        const mainTranslation = translation.split(',')[0].trim();
        
        return [
            `I often use the word "${word}" in English. - Я часто использую слово "${mainTranslation}" в английском.`,
            `Can you give me an example with "${word}"? - Можете привести пример с "${mainTranslation}"?`,
            `This shows how to use "${word}" correctly. - Это показывает как правильно использовать "${mainTranslation}".`
        ];
    }
}
