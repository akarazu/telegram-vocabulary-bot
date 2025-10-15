import axios from 'axios';

export class ExampleGeneratorService {
    constructor() {
        this.yandexApiKey = process.env.YANDEX_DICTIONARY_API_KEY;
        
        // Только Яндекс и FreeDictionary
        this.freeApis = [
            'YandexDictionary',
            'FreeDictionary'
        ];
    }

    async generateExamples(word, translation = null) {
        try {
            console.log(`🤖 Generating examples for: "${word}"`);
            
            // Пробуем API по порядку
            for (const apiName of this.freeApis) {
                console.log(`🔧 Trying ${apiName}...`);
                let examples = [];
                
                switch (apiName) {
                    case 'YandexDictionary':
                        if (this.yandexApiKey) {
                            examples = await this.generateWithYandex(word);
                        }
                        break;
                    case 'FreeDictionary':
                        examples = await this.generateWithFreeDictionary(word);
                        break;
                }
                
                if (examples.length > 0) {
                    console.log(`✅ ${apiName} found ${examples.length} examples`);
                    return examples;
                }
            }
            
            // Fallback на базовые примеры
            console.log('🔧 All APIs failed, using basic examples');
            return this.generateBasicExamples(word);
            
        } catch (error) {
            console.error('❌ Error generating examples:', error.message);
            return this.generateBasicExamples(word);
        }
    }

    async generateWithYandex(word) {
        try {
            const response = await axios.get('https://dictionary.yandex.net/api/v1/dicservice.json/lookup', {
                params: {
                    key: this.yandexApiKey,
                    lang: 'en-ru',
                    text: word,
                    ui: 'ru'
                },
                timeout: 5000
            });

            const examples = this.extractExamplesFromYandex(response.data, word);
            return examples.slice(0, 3);
            
        } catch (error) {
            console.error('❌ Yandex Dictionary error:', error.message);
            return [];
        }
    }

    extractExamplesFromYandex(data, word) {
        const examples = [];
        
        if (!data.def || data.def.length === 0) {
            return examples;
        }

        data.def.forEach(definition => {
            // Ищем примеры в переводах
            if (definition.tr && definition.tr.length > 0) {
                definition.tr.forEach(translation => {
                    // Примеры из основного перевода
                    if (translation.ex && translation.ex.length > 0) {
                        translation.ex.forEach(example => {
                            if (example.text && example.tr && example.tr[0] && example.tr[0].text) {
                                const englishExample = example.text;
                                const russianTranslation = example.tr[0].text;
                                if (englishExample.toLowerCase().includes(word.toLowerCase())) {
                                    examples.push(englishExample);
                                }
                            }
                        });
                    }
                    
                    // Синонимы тоже могут содержать полезные примеры
                    if (translation.syn && translation.syn.length > 0) {
                        translation.syn.forEach(synonym => {
                            if (synonym.text && synonym.text.length > 10) {
                                examples.push(synonym.text);
                            }
                        });
                    }
                });
            }
            
            // Примеры из самого определения
            if (definition.ex && definition.ex.length > 0) {
                definition.ex.forEach(example => {
                    if (example.text && example.tr && example.tr[0] && example.tr[0].text) {
                        const englishExample = example.text;
                        if (englishExample.toLowerCase().includes(word.toLowerCase())) {
                            examples.push(englishExample);
                        }
                    }
                });
            }
        });

        return examples;
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
                                    // Примеры использования из определений
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
        const availableApis = [];
        
        if (this.yandexApiKey) availableApis.push('Yandex Dictionary');
        availableApis.push('Free Dictionary');
        
        console.log(`🔧 Available example generation APIs: ${availableApis.join(', ')}`);
        return availableApis;
    }
}
