import axios from 'axios';

export class ExampleGeneratorService {
    constructor() {
        this.useYandex = !!process.env.YANDEX_DICTIONARY_API_KEY;
        console.log('🔧 ExampleGeneratorService initialized, useYandex:', this.useYandex);
    }

    async generateExamples(word, translation) {
        console.log(`\n🔄 ========== GENERATING EXAMPLES ==========`);
        console.log(`🔄 Input: word="${word}", translation="${translation}"`);
        
        if (!this.useYandex) {
            console.log('❌ Yandex API key not available, using contextual examples');
            return this.generateContextualExamples(word, translation);
        }

        try {
            console.log('🔍 PRIMARY: Trying Yandex API for examples...');
            const yandexExamples = await this.getYandexExamples(word);
            
            if (yandexExamples && yandexExamples.length > 0) {
                console.log(`✅ PRIMARY SUCCESS: Found ${yandexExamples.length} examples from Yandex`);
                console.log('📋 Yandex examples:', yandexExamples);
                return yandexExamples;
            } else {
                console.log('❌ PRIMARY FAILED: No examples found in Yandex response');
                console.log('🔄 FALLBACK: Using contextual examples');
                return this.generateContextualExamples(word, translation);
            }
        } catch (error) {
            console.log('❌ PRIMARY ERROR: Yandex examples failed:', error.message);
            console.log('🔄 FALLBACK: Using contextual examples');
            return this.generateContextualExamples(word, translation);
        }
    }

    async getYandexExamples(word) {
        console.log(`\n🔍 ========== YANDEX API CALL ==========`);
        console.log(`🔍 Making request for word: "${word}"`);
        
        try {
            const params = {
                key: process.env.YANDEX_DICTIONARY_API_KEY,
                lang: 'en-ru',
                text: word,
                ui: 'ru',
                flags: 0x0004 // Флаг для примеров
            };

            console.log('🔍 Request params:', {
                key: '***' + (process.env.YANDEX_DICTIONARY_API_KEY ? process.env.YANDEX_DICTIONARY_API_KEY.slice(-4) : 'none'),
                lang: params.lang,
                text: params.text,
                ui: params.ui,
                flags: params.flags.toString(16)
            });

            const response = await axios.get('https://dictionary.yandex.net/api/v1/dicservice.json/lookup', {
                params: params,
                timeout: 10000
            });

            console.log('✅ Yandex API response received');
            console.log('📊 Response status:', response.status);
            console.log('📊 Response has data:', !!response.data);
            
            return this.extractExamplesFromYandex(response.data, word);
            
        } catch (error) {
            console.error('❌ Yandex API request failed');
            console.error('Error message:', error.message);
            
            if (error.response) {
                console.error('Response status:', error.response.status);
                console.error('Response headers:', error.response.headers);
                if (error.response.data) {
                    console.error('Response data:', JSON.stringify(error.response.data, null, 2));
                }
            } else if (error.request) {
                console.error('No response received:', error.request);
            }
            
            console.error('Error config:', {
                url: error.config?.url,
                method: error.config?.method,
                params: error.config?.params
            });
            
            return [];
        }
    }

    extractExamplesFromYandex(data, originalWord) {
        console.log(`\n🔍 ========== EXTRACTING EXAMPLES ==========`);
        
        if (!data) {
            console.log('❌ No data in response');
            return [];
        }

        console.log('📊 Response keys:', Object.keys(data));
        console.log('📊 Response code:', data.code);
        console.log('📊 Response nmt_code:', data.nmt_code);

        if (!data.def || !Array.isArray(data.def)) {
            console.log('❌ No "def" array in response');
            return [];
        }

        console.log(`🔍 Found ${data.def.length} definition(s)`);

        const examples = [];
        let totalExamplesFound = 0;

        data.def.forEach((definition, defIndex) => {
            console.log(`\n📖 Definition ${defIndex + 1}:`);
            console.log('   text:', definition.text);
            console.log('   pos:', definition.pos);
            console.log('   ts:', definition.ts);
            console.log('   keys:', Object.keys(definition));

            if (definition.tr && Array.isArray(definition.tr)) {
                console.log(`   📚 Found ${definition.tr.length} translation(s)`);
                
                definition.tr.forEach((translation, trIndex) => {
                    console.log(`   🔍 Translation ${trIndex + 1}:`);
                    console.log('      text:', translation.text);
                    console.log('      pos:', translation.pos);
                    console.log('      keys:', Object.keys(translation));

                    // Проверяем поле "ex"
                    if (translation.ex) {
                        console.log('      ✅ HAS "ex" FIELD:', translation.ex);
                        if (Array.isArray(translation.ex)) {
                            console.log(`      📝 Found ${translation.ex.length} example(s) in 'ex' field`);
                            
                            translation.ex.forEach((example, exIndex) => {
                                if (totalExamplesFound >= 3) {
                                    console.log('      ⏹️  Skipping - reached limit');
                                    return;
                                }
                                
                                console.log(`      🔍 Example ${exIndex + 1}:`);
                                console.log('         text:', example.text);
                                console.log('         tr:', example.tr);
                                console.log('         keys:', Object.keys(example));

                                if (example.text && example.tr && Array.isArray(example.tr) && example.tr[0]?.text) {
                                    const englishExample = example.text.trim();
                                    const russianExample = example.tr[0].text.trim();
                                    
                                    console.log('         ✅ Valid example structure');
                                    console.log('         English:', englishExample);
                                    console.log('         Russian:', russianExample);
                                    
                                    const formattedExample = `${englishExample} - ${russianExample}`;
                                    examples.push(formattedExample);
                                    totalExamplesFound++;
                                    console.log(`         ✅ ADDED: "${formattedExample}"`);
                                } else {
                                    console.log('         ❌ Invalid example structure');
                                }
                            });
                        } else {
                            console.log('      ❌ "ex" is not an array:', typeof translation.ex);
                        }
                    } else {
                        console.log('      ❌ NO "ex" FIELD in translation');
                    }

                    // Проверяем синонимы
                    if (translation.syn && Array.isArray(translation.syn)) {
                        console.log(`      🔄 Checking ${translation.syn.length} synonym(s) for examples...`);
                        translation.syn.forEach((synonym, synIndex) => {
                            if (synonym.ex) {
                                console.log(`      📝 Synonym ${synIndex + 1} HAS "ex":`, synonym.ex);
                            }
                        });
                    }
                });
            } else {
                console.log('   ❌ NO translations in definition');
            }
        });

        console.log(`\n📊 ========== EXTRACTION RESULTS ==========`);
        console.log(`📊 Total examples extracted: ${examples.length}`);
        
        if (examples.length === 0) {
            console.log('❌ No examples could be extracted from Yandex response');
            console.log('💡 Possible reasons:');
            console.log('   - Яндекс не предоставляет примеры для этого слова');
            console.log('   - Примеры недоступны в бесплатном тарифе');
            console.log('   - Структура ответа отличается от ожидаемой');
        } else {
            console.log('✅ Examples found:', examples);
        }

        return examples;
    }

    generateContextualExamples(word, translation) {
        console.log(`\n✏️ ========== GENERATING CONTEXTUAL EXAMPLES ==========`);
        
        const examples = [
            `I often use the word "${word}" in my conversations. - Я часто использую слово "${translation}" в разговорах.`,
            `Can you give me an example with "${word}"? - Можете привести пример с "${translation}"?`,
            `The word "${word}" is very useful in English. - Слово "${translation}" очень полезно в английском языке.`
        ];

        console.log(`✅ Generated ${examples.length} contextual examples`);
        console.log('📋 Examples:', examples);
        
        return examples;
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
