import axios from 'axios';

export class ExampleGeneratorService {
    constructor() {
        console.log('🔧 ExampleGeneratorService initialized - Using Free Dictionary API');
    }

    async generateExamples(word, translation) {
        console.log(`\n🔄 ========== GENERATING EXAMPLES ==========`);
        console.log(`🔄 Input: word="${word}", translation="${translation}"`);
        
        // ✅ ПЕРВОЕ: пробуем Free Dictionary API
        try {
            console.log('🔍 PRIMARY: Trying Free Dictionary API for examples...');
            const freeDictExamples = await this.getFreeDictionaryExamples(word);
            if (freeDictExamples && freeDictExamples.length > 0) {
                console.log(`✅ PRIMARY SUCCESS: Found ${freeDictExamples.length} examples from Free Dictionary`);
                return freeDictExamples;
            } else {
                console.log('❌ PRIMARY FAILED: No examples found in Free Dictionary');
                return this.generateContextualExamples(word, translation);
            }
        } catch (error) {
            console.log('❌ PRIMARY ERROR: Free Dictionary API failed:', error.message);
            return this.generateContextualExamples(word, translation);
        }
    }

    async getFreeDictionaryExamples(word) {
        try {
            console.log(`🔍 Free Dictionary API call for: "${word}"`);
            
            const response = await axios.get(
                `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
                { timeout: 5000 }
            );

            console.log('✅ Free Dictionary API response received');
            return this.extractExamplesFromFreeDictionary(response.data, word);
            
        } catch (error) {
            console.error('❌ Free Dictionary API error:', error.message);
            if (error.response) {
                console.error('Response status:', error.response.status);
                if (error.response.data) {
                    console.error('Response data:', error.response.data);
                }
            }
            return [];
        }
    }

    extractExamplesFromFreeDictionary(data, originalWord) {
        console.log(`\n🔍 ========== EXTRACTING FROM FREE DICTIONARY ==========`);
        
        if (!data || !Array.isArray(data) || data.length === 0) {
            console.log('❌ No entries found in Free Dictionary response');
            return [];
        }

        console.log(`📊 Found ${data.length} entry/entries`);

        const examples = [];
        let exampleCount = 0;

        data.forEach((entry, entryIndex) => {
            console.log(`\n📖 Entry ${entryIndex + 1}: "${entry.word}"`);
            
            if (entry.meanings && Array.isArray(entry.meanings)) {
                console.log(`   📚 Found ${entry.meanings.length} meaning(s)`);
                
                entry.meanings.forEach((meaning, meaningIndex) => {
                    console.log(`   🔍 Meaning ${meaningIndex + 1}: ${meaning.partOfSpeech || 'unknown'}`);
                    
                    if (meaning.definitions && Array.isArray(meaning.definitions)) {
                        console.log(`      📝 Found ${meaning.definitions.length} definition(s)`);
                        
                        meaning.definitions.forEach((definition, defIndex) => {
                            if (exampleCount >= 3) return;
                            
                            console.log(`      🔍 Definition ${defIndex + 1}:`);
                            console.log(`         Definition: ${definition.definition}`);
                            console.log(`         Has example: ${!!definition.example}`);
                            
                            // ✅ ИЗВЛЕКАЕМ ПРИМЕРЫ ИЗ ПОЛЯ "example"
                            if (definition.example && definition.example.trim()) {
                                const englishExample = definition.example.trim();
                                const formattedExample = `${englishExample} - Пример использования`;
                                examples.push(formattedExample);
                                exampleCount++;
                                console.log(`         ✅ ADDED: "${formattedExample}"`);
                            }
                        });
                    }
                });
            }
            
            // ✅ ТАКЖЕ ПРОВЕРЯЕМ ПОЛЕ "sourceUrls" ДЛЯ ДОПОЛНИТЕЛЬНЫХ ПРИМЕРОВ
            if (entry.sourceUrls && Array.isArray(entry.sourceUrls) && entry.sourceUrls.length > 0) {
                console.log(`   🔗 Source URLs: ${entry.sourceUrls.length} available`);
            }
        });

        console.log(`\n📊 FINAL: Extracted ${examples.length} examples from Free Dictionary`);
        return examples;
    }

    generateContextualExamples(word, translation) {
        console.log('✏️ Generating high-quality contextual examples');
        
        // ✅ КАЧЕСТВЕННЫЕ КОНТЕКСТНЫЕ ПРИМЕРЫ
        const examples = [
            `I often use the word "${word}" in my conversations. - Я часто использую слово "${translation}" в разговорах.`,
            `Can you give me an example with "${word}"? - Можете привести пример с "${translation}"?`,
            `The word "${word}" is very useful in English. - Слово "${translation}" очень полезно в английском языке.`,
            `Let's practice using "${word}" in a sentence. - Давайте попрактикуемся использовать "${translation}" в предложении.`,
            `This is a good example of "${word}" usage. - Это хороший пример использования "${translation}".`
        ];

        return examples.slice(0, 3);
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
