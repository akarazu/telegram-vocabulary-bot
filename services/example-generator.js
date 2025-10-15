import axios from 'axios';

export class ExampleGeneratorService {
    constructor() {
        console.log('🔧 ExampleGeneratorService initialized - Using Free Dictionary API + Smart Fallback');
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
                return this.generateSmartContextualExamples(word, translation);
            }
        } catch (error) {
            console.log('❌ PRIMARY ERROR: Free Dictionary API failed:', error.message);
            return this.generateSmartContextualExamples(word, translation);
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
            return this.extractExamplesFromFreeDictionary(response.data, word);
            
        } catch (error) {
            if (error.response && error.response.status === 404) {
                console.log(`❌ Free Dictionary: Word "${word}" not found (404)`);
                console.log('💡 This word might be a proper noun, abbreviation, or specialized term');
            } else {
                console.error('❌ Free Dictionary API error:', error.message);
            }
            return [];
        }
    }

    extractExamplesFromFreeDictionary(data, originalWord) {
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
                            if (exampleCount >= 3) return;
                            
                            // ✅ ИЗВЛЕКАЕМ ПРИМЕРЫ ИЗ ПОЛЯ "example"
                            if (definition.example && definition.example.trim()) {
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

    generateSmartContextualExamples(word, translation) {
        console.log('✏️ Generating smart contextual examples');
        
        const lowerWord = word.toLowerCase();
        
        // ✅ УМНАЯ ГЕНЕРАЦИЯ В ЗАВИСИМОСТИ ОТ ТИПА СЛОВА
        
        // Месяцы
        const months = ['january', 'february', 'march', 'april', 'may', 'june', 
                       'july', 'august', 'september', 'october', 'november', 'december'];
        if (months.includes(lowerWord)) {
            return [
                `My birthday is in ${word}. - Мой день рождения в ${translation}.`,
                `We are going on vacation in ${word}. - Мы едем в отпуск в ${translation}.`,
                `${word} is my favorite month. - ${this.capitalizeFirst(translation)} мой любимый месяц.`
            ];
        }
        
        // Дни недели
        const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        if (days.includes(lowerWord)) {
            return [
                `I have a meeting on ${word}. - У меня встреча в ${translation}.`,
                `See you next ${word}. - Увидимся в следующий ${translation}.`,
                `${word} is usually a busy day. - ${this.capitalizeFirst(translation)} обычно busy день.`
            ];
        }
        
        // Имена
        const commonNames = ['john', 'mary', 'michael', 'sarah', 'david', 'lisa', 'robert', 'jennifer'];
        if (commonNames.includes(lowerWord)) {
            return [
                `${this.capitalizeFirst(word)} is my friend. - ${this.capitalizeFirst(translation)} мой друг.`,
                `I work with ${word}. - Я работаю с ${translation}.`,
                `Have you met ${word}? - Ты знаком с ${translation}?`
            ];
        }
        
        // Страны, города
        const places = ['london', 'paris', 'moscow', 'new york', 'tokyo', 'berlin'];
        if (places.includes(lowerWord)) {
            return [
                `I want to visit ${word}. - Я хочу посетить ${translation}.`,
                `${this.capitalizeFirst(word)} is a beautiful city. - ${this.capitalizeFirst(translation)} красивый город.`,
                `She lives in ${word}. - Она живет в ${translation}.`
            ];
        }
        
        // Общие контекстные примеры
        return this.generateGeneralContextualExamples(word, translation);
    }

    generateGeneralContextualExamples(word, translation) {
        console.log('✏️ Using general contextual examples');
        
        return [
            `I often use the word "${word}" in English. - Я часто использую слово "${translation}" в английском.`,
            `Can you explain "${word}"? - Можете объяснить "${translation}"?`,
            `This is an example of "${word}" usage. - Это пример использования "${translation}".`
        ];
    }

    capitalizeFirst(string) {
        return string.charAt(0).toUpperCase() + string.slice(1);
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
