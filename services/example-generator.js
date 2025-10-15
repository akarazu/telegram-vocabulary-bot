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
            
            const response = await axios.get('https://dictionary.yandex.net/api/v1/dicservice.json/lookup', {
                params: {
                    key: process.env.YANDEX_DICTIONARY_API_KEY,
                    lang: 'en-ru',
                    text: word,
                    ui: 'ru'
                },
                timeout: 10000
            });

            console.log('✅ Yandex API response received');
            
            // ✅ ЛОГИРУЕМ ПОЛНЫЙ ОТВЕТ ДЛЯ ДЕБАГА
            console.log('📊 Full Yandex response structure:');
            console.log(JSON.stringify(response.data, null, 2));
            
            return this.extractExamplesFromYandex(response.data, word);
            
        } catch (error) {
            console.error('❌ Yandex API error:', error.message);
            if (error.response) {
                console.error('Yandex response status:', error.response.status);
                console.error('Yandex response data:', error.response.data);
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

        // ✅ ДЕТАЛЬНО ИССЛЕДУЕМ СТРУКТУРУ КАЖДОГО ОПРЕДЕЛЕНИЯ
        data.def.forEach((definition, defIndex) => {
            console.log(`\n🔍 Definition ${defIndex + 1}:`);
            console.log('   Text:', definition.text);
            console.log('   POS:', definition.pos);
            console.log('   Has tr:', !!definition.tr);
            console.log('   tr count:', definition.tr ? definition.tr.length : 0);

            if (definition.tr && Array.isArray(definition.tr)) {
                definition.tr.forEach((translation, trIndex) => {
                    console.log(`   🔍 Translation ${trIndex + 1}: "${translation.text}"`);
                    console.log('      Has ex:', !!translation.ex);
                    console.log('      ex count:', translation.ex ? translation.ex.length : 0);

                    // ✅ ИЩЕМ ПРИМЕРЫ В КАЖДОМ ПЕРЕВОДЕ
                    if (translation.ex && Array.isArray(translation.ex)) {
                        console.log(`      Processing ${translation.ex.length} example(s)...`);
                        
                        translation.ex.forEach((example, exIndex) => {
                            if (totalExamplesFound >= 3) return;
                            
                            console.log(`      🔍 Example ${exIndex + 1}:`);
                            console.log('         English:', example.text);
                            console.log('         Has tr:', !!example.tr);
                            console.log('         tr:', example.tr);

                            if (example.text && example.tr && Array.isArray(example.tr) && example.tr[0]?.text) {
                                const englishExample = example.text.trim();
                                const russianExample = example.tr[0].text.trim();
                                
                                if (englishExample && russianExample) {
                                    const formattedExample = `${englishExample} - ${russianExample}`;
                                    examples.push(formattedExample);
                                    totalExamplesFound++;
                                    console.log(`      ✅ ADDED: "${formattedExample}"`);
                                } else {
                                    console.log('      ❌ Example missing English or Russian text');
                                }
                            } else {
                                console.log('      ❌ Example structure invalid');
                            }
                        });
                    } else {
                        console.log('      ❌ No examples in this translation');
                    }
                });
            } else {
                console.log('   ❌ No translations in this definition');
            }
        });

        console.log(`\n📊 FINAL: Extracted ${examples.length} examples from Yandex`);
        
        if (examples.length === 0) {
            console.log('❌ No examples could be extracted from Yandex response');
        }

        return examples;
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
