import axios from 'axios';

export class ExampleGeneratorService {
    constructor() {
        console.log('🔧 ExampleGeneratorService initialized - Using Free Dictionary API only');
    }

    async generateExamples(word, translation, partOfSpeech = '') {
        console.log(`\n🔄 ========== GENERATING EXAMPLES ==========`);
        console.log(`🔄 Input: word="${word}", translation="${translation}", partOfSpeech="${partOfSpeech}"`);
        
        // ✅ ПОЛУЧАЕМ ПРИМЕРЫ ИЗ FREE DICTIONARY API
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
        
        // Простые fallback-примеры если API не вернуло результатов
        const mainTranslation = translation.split(',')[0].trim();
        
        return [
            `I often use the word "${word}" in English. - Я часто использую слово "${mainTranslation}" в английском.`,
            `Can you give me an example with "${word}"? - Можете привести пример с "${mainTranslation}"?`,
            `This shows how to use "${word}" correctly. - Это показывает как правильно использовать "${mainTranslation}".`
        ];
    }

    formatExamplesForDisplay(examples) {
        if (!examples || !Array.isArray(examples) || examples.length === 0) {
            return 'Примеры не найдены';
        }
        return examples.map((example, index) => `${index + 1}. ${example}`).join('\n');
    }

    formatExamplesForStorage(examples) {
        if (!examples || !Array.isArray(examples) || examples.length === 0) {
            return '';
        }
        return examples.join(' | ');
    }
}
