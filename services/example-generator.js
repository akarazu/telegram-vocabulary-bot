import axios from 'axios';

export class ExampleGeneratorService {
    constructor() {
        this.yandexApiKey = process.env.YANDEX_DICTIONARY_API_KEY;
        
        this.freeApis = [
            'YandexDictionary',
            'FreeDictionary'
        ];
    }

    async generateExamples(word, selectedTranslation = null) {
        try {
            console.log(`🤖 Generating examples for: "${word}" with translation: "${selectedTranslation}"`);
            
            // Если есть выбранный перевод, пробуем получить контекстные примеры
            if (selectedTranslation && selectedTranslation !== 'null') {
                console.log(`🔧 Getting context-based examples for: "${selectedTranslation}"`);
                
                // Сначала пробуем Яндекс с конкретным переводом
                if (this.yandexApiKey) {
                    const yandexExamples = await this.generateWithYandex(word, selectedTranslation);
                    if (yandexExamples.length > 0) {
                        console.log(`✅ Yandex found ${yandexExamples.length} context examples`);
                        return yandexExamples;
                    }
                }
                
                // Затем пробуем FreeDictionary с контекстом
                const freeDictExamples = await this.generateWithFreeDictionary(word, selectedTranslation);
                if (freeDictExamples.length > 0) {
                    console.log(`✅ FreeDictionary found ${freeDictExamples.length} context examples`);
                    return freeDictExamples;
                }
                
                // Если API не дали результатов, генерируем контекстные примеры
                console.log('🔧 Generating contextual examples based on translation');
                const contextualExamples = this.generateContextualExamples(word, selectedTranslation);
                if (contextualExamples.length > 0) {
                    return contextualExamples;
                }
            }
            
            // Если нет перевода или не удалось сгенерировать контекстные, используем общие примеры
            console.log('🔧 Getting general examples');
            for (const apiName of this.freeApis) {
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
                    console.log(`✅ ${apiName} found ${examples.length} general examples`);
                    return examples;
                }
            }
            
            // Fallback на базовые примеры
            console.log('🔧 Using basic examples');
            return this.generateBasicExamples(word, selectedTranslation);
            
        } catch (error) {
            console.error('❌ Error generating examples:', error.message);
            return this.generateBasicExamples(word, selectedTranslation);
        }
    }

    async generateWithYandex(word, targetTranslation = null) {
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

            return this.extractExamplesFromYandex(response.data, word, targetTranslation);
            
        } catch (error) {
            console.error('❌ Yandex Dictionary error:', error.message);
            return [];
        }
    }

    extractExamplesFromYandex(data, word, targetTranslation = null) {
        const examples = [];
        
        if (!data.def || data.def.length === 0) {
            return examples;
        }

        console.log('🔍 Yandex API response structure:', JSON.stringify(data.def[0], null, 2));

        data.def.forEach(definition => {
            // Ищем примеры на уровне определения
            if (definition.ex && definition.ex.length > 0) {
                definition.ex.forEach(example => {
                    if (example.text && example.tr && example.tr[0] && example.tr[0].text) {
                        const englishExample = example.text.trim();
                        const russianTranslation = example.tr[0].text;
                        
                        // Проверяем, что пример содержит слово и имеет разумную длину
                        if (englishExample.toLowerCase().includes(word.toLowerCase()) &&
                            englishExample.length > 10 && englishExample.length < 200) {
                            
                            // Если указан целевой перевод, проверяем соответствие
                            if (!targetTranslation || russianTranslation.includes(targetTranslation)) {
                                examples.push(englishExample);
                            }
                        }
                    }
                });
            }
            
            // Ищем примеры в переводах
            if (definition.tr && definition.tr.length > 0) {
                definition.tr.forEach(translation => {
                    const translationText = translation.text || '';
                    
                    // Если указан конкретный перевод, проверяем соответствие
                    if (targetTranslation && translationText !== targetTranslation) {
                        return;
                    }
                    
                    // Примеры из перевода
                    if (translation.ex && translation.ex.length > 0) {
                        translation.ex.forEach(example => {
                            if (example.text && example.tr && example.tr[0] && example.tr[0].text) {
                                const englishExample = example.text.trim();
                                if (englishExample.toLowerCase().includes(word.toLowerCase()) &&
                                    englishExample.length > 10 && englishExample.length < 200) {
                                    examples.push(englishExample);
                                }
                            }
                        });
                    }
                });
            }
        });

        console.log(`📝 Yandex extracted ${examples.length} examples`);
        return examples.slice(0, 3);
    }

    async generateWithFreeDictionary(word, targetTranslation = null) {
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
                
                console.log(`📝 FreeDictionary extracted ${examples.length} examples`);
                return examples.slice(0, 3);
            }
            
            return [];
            
        } catch (error) {
            console.error('❌ FreeDictionary error:', error.message);
            return [];
        }
    }

    generateContextualExamples(word, translation) {
        // Генерируем контекстные примеры на основе перевода
        const examples = [];
        
        // Определяем тип слова по переводу
        const isVerb = translation.includes('глагол') || translation.match(/\b(verb|to\s+\w+)\b/i);
        const isNoun = translation.includes('существительное') || translation.match(/\b(noun|the\s+\w+)\b/i);
        const isAdjective = translation.includes('прилагательное') || translation.match(/\b(adjective)\b/i);
        
        if (isVerb) {
            examples.push(
                `You should ${word} regularly to maintain good habits.`,
                `She will ${word} the proposal before the meeting.`,
                `They have ${word}ed together on many projects.`
            );
        } 
        else if (isNoun) {
            examples.push(
                `The ${word} was placed on the shelf.`,
                `We need to discuss this ${word} in detail.`,
                `Her favorite ${word} is the one she bought yesterday.`
            );
        }
        else if (isAdjective) {
            examples.push(
                `It was a ${word} experience that I'll never forget.`,
                `She has such a ${word} personality that everyone likes her.`,
                `The solution seems ${word} at first glance.`
            );
        }
        else {
            // Общие контекстные примеры
            examples.push(
                `In the context of "${translation}", the word "${word}" is often used like this.`,
                `When "${word}" means "${translation}", you might encounter it in this sentence.`,
                `For the meaning "${translation}", here's a typical usage of "${word}".`
            );
        }
        
        console.log(`📝 Generated ${examples.length} contextual examples`);
        return examples.slice(0, 3);
    }

    generateBasicExamples(word, translation = null) {
        let basicExamples = [];
        
        if (translation && translation !== 'null') {
            basicExamples = [
                `When "${word}" means "${translation}", it can be used in various contexts.`,
                `In the sense of "${translation}", here's how "${word}" might be used.`,
                `For the meaning "${translation}", consider this example with "${word}".`
            ];
        } else {
            basicExamples = [
                `I need to use the word "${word}" in my writing.`,
                `Can you explain how to use "${word}" correctly?`,
                `The word "${word}" appears frequently in English texts.`
            ];
        }
        
        const shuffled = [...basicExamples].sort(() => 0.5 - Math.random());
        return shuffled.slice(0, 3);
    }

    async checkApisAvailability() {
        const availableApis = [];
        
        if (this.yandexApiKey) availableApis.push('Yandex Dictionary');
        availableApis.push('Free Dictionary');
        
        console.log(`🔧 Available example generation APIs: ${availableApis.join(', ')}`);
        return availableApis;
    }
}
