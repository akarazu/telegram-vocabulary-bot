import axios from 'axios';

export class ExampleGeneratorService {
    constructor() {
        this.useYandex = !!process.env.YANDEX_DICTIONARY_API_KEY;
    }

    async generateExamples(word, translation) {
        console.log(`🔄 Generating examples for: "${word}" -> "${translation}"`);
        
        if (!this.useYandex) {
            console.log('❌ Yandex API key not available, using generic examples');
            return this.getGenericExamples(word, translation);
        }

        try {
            console.log('🔍 PRIMARY: Trying Yandex API for examples...');
            const yandexExamples = await this.getYandexExamples(word);
            
            if (yandexExamples && yandexExamples.length > 0) {
                console.log(`✅ PRIMARY: Found ${yandexExamples.length} examples from Yandex`);
                return yandexExamples;
            } else {
                console.log('❌ PRIMARY: No examples found in Yandex response');
                return this.getGenericExamples(word, translation);
            }
        } catch (error) {
            console.log('❌ PRIMARY: Yandex examples failed:', error.message);
            return this.getGenericExamples(word, translation);
        }
    }

    async getYandexExamples(word) {
        try {
            console.log(`🔍 Yandex API call for: "${word}"`);
            
            // ✅ ОБНОВЛЕННЫЙ ЗАПРОС С ФЛАГОМ ДЛЯ ПРИМЕРОВ
            const response = await axios.get('https://dictionary.yandex.net/api/v1/dicservice.json/lookup', {
                params: {
                    key: process.env.YANDEX_DICTIONARY_API_KEY,
                    lang: 'en-ru',
                    text: word,
                    ui: 'ru',
                    flags: 0x0004 // Флаг для включения примеров
                },
                timeout: 10000
            });

            console.log('✅ Yandex API response received');
            
            // ✅ ЛОГИРУЕМ СТРУКТУРУ ОТВЕТА
            console.log('📊 Yandex response has definitions:', response.data.def ? response.data.def.length : 0);
            
            return this.extractExamplesFromYandex(response.data, word);
            
        } catch (error) {
            console.error('❌ Yandex API error:', error.message);
            if (error.response) {
                console.error('Yandex response status:', error.response.status);
                if (error.response.data) {
                    console.error('Yandex error details:', JSON.stringify(error.response.data, null, 2));
                }
            }
            return [];
        }
    }

    extractExamplesFromYandex(data, originalWord) {
        if (!data || !data.def || !Array.isArray(data.def) || data.def.length === 0) {
            console.log('❌ Yandex: No definitions in response');
            return [];
        }

        console.log(`🔍 Yandex found ${data.def.length} definition(s)`);

        const examples = [];
        let totalExamplesFound = 0;

        data.def.forEach((definition, defIndex) => {
            console.log(`\n🔍 Definition ${defIndex + 1}: "${definition.text}"`);

            if (definition.tr && Array.isArray(definition.tr)) {
                definition.tr.forEach((translation, trIndex) => {
                    console.log(`   🔍 Translation ${trIndex + 1}: "${translation.text}"`);
                    
                    // ✅ ПРОВЕРЯЕМ РАЗЛИЧНЫЕ ВАРИАНТЫ ГДЕ МОГУТ БЫТЬ ПРИМЕРЫ
                    
                    // 1. Основные примеры в поле "ex"
                    if (translation.ex && Array.isArray(translation.ex)) {
                        console.log(`      Found ${translation.ex.length} example(s) in 'ex' field`);
                        this.processExamples(translation.ex, examples, totalExamplesFound);
                    }
                    
                    // 2. Примеры в синонимах
                    if (translation.syn && Array.isArray(translation.syn)) {
                        translation.syn.forEach((synonym, synIndex) => {
                            if (synonym.ex && Array.isArray(synonym.ex)) {
                                console.log(`      Found ${synonym.ex.length} example(s) in synonym ${synIndex + 1}`);
                                this.processExamples(synonym.ex, examples, totalExamplesFound);
                            }
                        });
                    }
                    
                    // 3. Если примеров нет, создаем из самого перевода
                    if (examples.length === 0 && translation.text) {
                        console.log('      Creating example from translation');
                        const example = `${originalWord} - ${translation.text}`;
                        examples.push(example);
                        totalExamplesFound++;
                        console.log(`      ✅ CREATED: "${example}"`);
                    }
                });
            }
        });

        console.log(`\n📊 FINAL: ${examples.length} examples extracted`);
        return examples.slice(0, 3); // Ограничиваем 3 примерами
    }

    processExamples(examplesArray, examples, totalExamplesFound) {
        examplesArray.forEach((example, exIndex) => {
            if (totalExamplesFound >= 3) return;
            
            if (example.text && example.tr && Array.isArray(example.tr) && example.tr[0]?.text) {
                const englishExample = example.text.trim();
                const russianExample = example.tr[0].text.trim();
                
                if (englishExample && russianExample) {
                    const formattedExample = `${englishExample} - ${russianExample}`;
                    examples.push(formattedExample);
                    totalExamplesFound++;
                    console.log(`      ✅ ADDED: "${formattedExample}"`);
                }
            }
        });
    }

    getGenericExamples(word, translation) {
        console.log('✏️  Using generic examples as fallback');
        return [
            `I often use the word "${word}" in my conversations. - Я часто использую слово "${translation}" в разговорах.`,
            `Can you give me an example with "${word}"? - Можете привести пример с "${translation}"?`
        ];
    }

    formatExamplesForDisplay(examples) {
        if (!examples || !Array.isArray(examples) || examples.length === 0) {
            return 'Примеры не найдены';
        }
        
        return examples.map((example, index) => {
            return `${index + 1}. ${typeof example === 'string' ? example : String(example)}`;
        }).join('\n');
    }

    formatExamplesForStorage(examples) {
        if (!examples || !Array.isArray(examples) || examples.length === 0) {
            return '';
        }
        
        return examples.map(example => 
            typeof example === 'string' ? example : String(example)
        ).join(' | ');
    }
}
