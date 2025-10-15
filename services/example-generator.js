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
            
            // Если есть выбранный перевод, генерируем примеры на его основе
            if (selectedTranslation) {
                console.log(`🔧 Generating context-based examples for: "${selectedTranslation}"`);
                const contextExamples = await this.generateContextExamples(word, selectedTranslation);
                if (contextExamples.length > 0) {
                    return contextExamples;
                }
            }
            
            // Если нет перевода или не удалось сгенерировать, используем обычные примеры
            for (const apiName of this.freeApis) {
                console.log(`🔧 Trying ${apiName}...`);
                let examples = [];
                
                switch (apiName) {
                    case 'YandexDictionary':
                        if (this.yandexApiKey) {
                            examples = await this.generateWithYandex(word, selectedTranslation);
                        }
                        break;
                    case 'FreeDictionary':
                        examples = await this.generateWithFreeDictionary(word, selectedTranslation);
                        break;
                }
                
                if (examples.length > 0) {
                    console.log(`✅ ${apiName} found ${examples.length} examples`);
                    return examples;
                }
            }
            
            // Fallback на базовые примеры с учетом перевода
            console.log('🔧 All APIs failed, using basic examples');
            return this.generateBasicExamples(word, selectedTranslation);
            
        } catch (error) {
            console.error('❌ Error generating examples:', error.message);
            return this.generateBasicExamples(word, selectedTranslation);
        }
    }

    async generateContextExamples(word, translation) {
        try {
            // Генерируем примеры, которые отражают конкретное значение слова
            const contextExamples = [
                `In the sense of "${translation}", the word "${word}" can be used like this.`,
                `When "${word}" means "${translation}", you might say:`,
                `For the meaning "${translation}", here's an example with "${word}":`,
                `As "${translation}", the word "${word}" appears in contexts like this.`,
                `If "${word}" refers to "${translation}", it could be used in this way.`
            ];
            
            // Добавляем конкретные примеры в зависимости от перевода
            const specificExamples = this.getSpecificExamplesByTranslation(word, translation);
            return [...specificExamples, ...contextExamples].slice(0, 3);
            
        } catch (error) {
            console.error('❌ Context examples error:', error.message);
            return [];
        }
    }

    getSpecificExamplesByTranslation(word, translation) {
        // Генерируем конкретные примеры в зависимости от типа перевода
        const examples = [];
        
        if (translation.includes('глагол') || translation.includes('verb') || 
            translation.includes('действие')) {
            examples.push(
                `You can ${word} every day to improve your skills.`,
                `She will ${word} the document before sending it.`,
                `They ${word}ed together on the project.`
            );
        } 
        else if (translation.includes('существительное') || translation.includes('noun') ||
                 translation.includes('предмет')) {
            examples.push(
                `The ${word} was on the table.`,
                `I need to buy a new ${word} for my room.`,
                `This ${word} is very important for the process.`
            );
        }
        else if (translation.includes('прилагательное') || translation.includes('adjective') ||
                 translation.includes('качество')) {
            examples.push(
                `It was a very ${word} experience.`,
                `She has a ${word} personality.`,
                `The weather is ${word} today.`
            );
        }
        else {
            // Общие примеры для других частей речи
            examples.push(
                `I really like the word "${word}" when it means "${translation}".`,
                `The term "${word}" in the context of "${translation}" is commonly used.`,
                `When learning English, understanding "${word}" as "${translation}" is key.`
            );
        }
        
        return examples;
    }

    async generateWithYandex(word, translation = null) {
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

            const examples = this.extractExamplesFromYandex(response.data, word, translation);
            return examples.slice(0, 3);
            
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

        data.def.forEach(definition => {
            if (definition.tr && definition.tr.length > 0) {
                definition.tr.forEach(translation => {
                    // Если указан конкретный перевод, ищем примеры только для него
                    if (targetTranslation && translation.text !== targetTranslation) {
                        return;
                    }
                    
                    // Примеры из основного перевода
                    if (translation.ex && translation.ex.length > 0) {
                        translation.ex.forEach(example => {
                            if (example.text && example.tr && example.tr[0] && example.tr[0].text) {
                                const englishExample = example.text;
                                if (englishExample.toLowerCase().includes(word.toLowerCase())) {
                                    examples.push(englishExample);
                                }
                            }
                        });
                    }
                });
            }
        });

        return examples;
    }

    async generateWithFreeDictionary(word, translation = null) {
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
                            // Если есть конкретный перевод, пытаемся сопоставить с partOfSpeech
                            if (translation && meaning.partOfSpeech) {
                                const matchesTranslation = this.doesMeaningMatchTranslation(meaning, translation);
                                if (!matchesTranslation) continue;
                            }
                            
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

    doesMeaningMatchTranslation(meaning, translation) {
        // Простая эвристика для сопоставления значения с переводом
        const translationLower = translation.toLowerCase();
        const partOfSpeech = meaning.partOfSpeech?.toLowerCase() || '';
        
        if (translationLower.includes('verb') || translationLower.includes('глагол')) {
            return partOfSpeech.includes('verb');
        }
        if (translationLower.includes('noun') || translationLower.includes('существительное')) {
            return partOfSpeech.includes('noun');
        }
        if (translationLower.includes('adjective') || translationLower.includes('прилагательное')) {
            return partOfSpeech.includes('adjective');
        }
        
        return true; // Если не можем определить, берем все примеры
    }

    generateBasicExamples(word, translation = null) {
        let basicExamples = [];
        
        if (translation) {
            // Примеры с учетом конкретного перевода
            basicExamples = [
                `When "${word}" means "${translation}", it can be used in this context.`,
                `In the sense of "${translation}", here's an example: "${word}" plays an important role.`,
                `For the meaning "${translation}", consider this usage of "${word}".`,
                `As "${translation}", the word "${word}" appears in sentences like this.`,
                `If you understand "${word}" as "${translation}", you might encounter it in this way.`
            ];
        } else {
            // Общие примеры
            basicExamples = [
                `I need to use the word "${word}" in my essay.`,
                `Can you explain the meaning of "${word}"?`,
                `The word "${word}" is commonly used in everyday conversation.`,
                `She used the word "${word}" correctly in her sentence.`,
                `Learning how to use "${word}" properly is important for English learners.`
            ];
        }
        
        // Выбираем случайные 3 примера
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
