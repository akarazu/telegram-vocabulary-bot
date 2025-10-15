import axios from 'axios';

export class ExampleGeneratorService {
    constructor() {
        // Бесплатные API (Merriam-Webster Learners действительно бесплатный)
        this.freeApis = [
            'FreeDictionary',
            'MerriamWebsterLearners',
            'WordNik'
        ];
    }

    async generateExamples(word, translation = null) {
        try {
            console.log(`🤖 Generating free examples for: "${word}"`);
            
            // Пробуем все бесплатные API по порядку
            for (const apiName of this.freeApis) {
                console.log(`🔧 Trying ${apiName}...`);
                let examples = [];
                
                switch (apiName) {
                    case 'FreeDictionary':
                        examples = await this.generateWithFreeDictionary(word);
                        break;
                    case 'MerriamWebsterLearners':
                        examples = await this.generateWithMerriamWebsterLearners(word);
                        break;
                    case 'WordNik':
                        examples = await this.generateWithWordNik(word);
                        break;
                }
                
                if (examples.length > 0) {
                    console.log(`✅ ${apiName} found ${examples.length} examples`);
                    return examples;
                }
            }
            
            // Fallback на базовые примеры
            console.log('🔧 All free APIs failed, using basic examples');
            return this.generateBasicExamples(word);
            
        } catch (error) {
            console.error('❌ Error generating examples:', error.message);
            return this.generateBasicExamples(word);
        }
    }

    async generateWithFreeDictionary(word) {
        try {
            const response = await axios.get(
                `https://api.dictionaryapi.dev/api/v2/entries/en/${word}`,
                { timeout: 5000 }
            );

            if (response.data && Array.isArray(response.data)) {
                const examples = [];
                
                for (const entry of response.data) {
                    if (entry.meanings && Array.isArray(entry.meanings)) {
                        for (const meaning of entry.meanings) {
                            if (meaning.definitions && Array.isArray(meaning.definitions)) {
                                for (const definition of meaning.definitions) {
                                    if (definition.example && definition.example.trim()) {
                                        const cleanExample = definition.example.trim();
                                        if (cleanExample.length > 10 && cleanExample.length < 150) {
                                            examples.push(cleanExample);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                
                return examples.slice(0, 3);
            }
            
            return [];
            
        } catch (error) {
            console.error('❌ FreeDictionary error:', error.message);
            return [];
        }
    }

    async generateWithMerriamWebsterLearners(word) {
        try {
            // Merriam-Webster Learners Dictionary - бесплатный API
            const response = await axios.get(
                `https://www.dictionaryapi.com/api/v3/references/learners/json/${word}`,
                {
                    params: {
                        key: process.env.MERRIAM_WEBSTER_LEARNERS_KEY || 'demo' // demo key works for limited requests
                    },
                    timeout: 5000
                }
            );

            if (response.data && Array.isArray(response.data) && response.data[0]) {
                const examples = [];
                const entry = response.data[0];
                
                // Ищем примеры в определениях
                if (entry.def && Array.isArray(entry.def)) {
                    for (const definition of entry.def) {
                        if (definition.sseq && Array.isArray(definition.sseq)) {
                            for (const senseSeq of definition.sseq) {
                                for (const sense of senseSeq) {
                                    if (sense[1] && sense[1].dt) {
                                        for (const dt of sense[1].dt) {
                                            if (dt[0] === 'vis' && dt[1] && Array.isArray(dt[1].t)) {
                                                // Примеры использования
                                                const exampleText = dt[1].t.map(t => t).join(' ');
                                                if (exampleText && exampleText.includes(word)) {
                                                    examples.push(exampleText);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                
                // Также проверяем короткие определения как примеры
                if (entry.shortdef && Array.isArray(entry.shortdef)) {
                    for (const shortdef of entry.shortdef) {
                        if (shortdef && shortdef.length > 10) {
                            examples.push(shortdef);
                        }
                    }
                }
                
                return examples.slice(0, 3);
            }
            
            return [];
            
        } catch (error) {
            console.error('❌ Merriam-Webster Learners error:', error.message);
            return [];
        }
    }

    async generateWithWordNik(word) {
        try {
            // WordNik API - бесплатный с ограничениями
            const response = await axios.get(
                `https://api.wordnik.com/v4/word.json/${word}/examples`,
                {
                    params: {
                        includeDuplicates: false,
                        useCanonical: false,
                        skip: 0,
                        limit: 3,
                        api_key: process.env.WORDNIK_API_KEY || 'demo' // demo key works for limited requests
                    },
                    timeout: 5000
                }
            );

            if (response.data && response.data.examples && Array.isArray(response.data.examples)) {
                const examples = response.data.examples
                    .map(example => example.text?.trim())
                    .filter(text => text && text.length > 10 && text.length < 200)
                    .slice(0, 3);
                
                return examples;
            }
            
            return [];
            
        } catch (error) {
            console.error('❌ WordNik error:', error.message);
            return [];
        }
    }

    generateBasicExamples(word) {
        const basicExamples = [
            `I need to use the word "${word}" in my essay.`,
            `Can you explain the meaning of "${word}"?`,
            `The word "${word}" is commonly used in everyday conversation.`,
            `She used the word "${word}" correctly in her sentence.`,
            `Learning how to use "${word}" properly is important for English learners.`,
            `In this context, the word "${word}" has a specific meaning.`,
            `Could you give me an example with the word "${word}"?`,
            `The teacher explained the word "${word}" very clearly.`,
            `I encountered the word "${word}" while reading a book.`,
            `Using "${word}" appropriately will improve your English.`
        ];
        
        // Выбираем случайные 3 примера
        const shuffled = [...basicExamples].sort(() => 0.5 - Math.random());
        return shuffled.slice(0, 3);
    }

    // Метод для проверки доступности API
    async checkApisAvailability() {
        const availableApis = [...this.freeApis];
        console.log(`🔧 Available free example generation APIs: ${availableApis.join(', ')}`);
        return availableApis;
    }
}
