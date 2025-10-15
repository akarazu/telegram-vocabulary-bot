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
            // ✅ ЗАПРОС БЕЗ ФЛАГОВ - примеры должны приходить по умолчанию
            const params = {
                key: process.env.YANDEX_DICTIONARY_API_KEY,
                lang: 'en-ru', 
                text: word,
                ui: 'ru'
                // NO FLAGS - examples should come by default
            };

            console.log('🔍 Request params (no flags):', {
                key: '***' + (process.env.YANDEX_DICTIONARY_API_KEY ? process.env.YANDEX_DICTIONARY_API_KEY.slice(-4) : 'none'),
                lang: params.lang,
                text: params.text,
                ui: params.ui
            });

            const response = await axios.get('https://dictionary.yandex.net/api/v1/dicservice.json/lookup', {
                params: params,
                timeout: 10000
            });

            console.log('✅ Yandex API response received');
            console.log('📊 Response status:', response.status);
            
            // ✅ ДЕТАЛЬНЫЙ АНАЛИЗ ОТВЕТА
            if (response.data && response.data.def) {
                console.log(`📊 Found ${response.data.def.length} definition(s)`);
                
                // Проверяем каждый definition на наличие примеров
                response.data.def.forEach((def, index) => {
                    console.log(`\n📖 Definition ${index + 1}: "${def.text}"`);
                    if (def.tr && def.tr.length > 0) {
                        def.tr.forEach((tr, trIndex) => {
                            console.log(`   Translation ${trIndex + 1}: "${tr.text}"`);
                            console.log(`   Has 'ex' field: ${!!tr.ex}`);
                            if (tr.ex) {
                                console.log(`   'ex' field type: ${typeof tr.ex}`);
                                console.log(`   'ex' field value:`, tr.ex);
                            }
                        });
                    }
                });
            }

            return this.extractExamplesFromYandex(response.data, word);
            
        } catch (error) {
            console.error('❌ Yandex API request failed:', error.message);
            return [];
        }
    }

    extractExamplesFromYandex(data, originalWord) {
        console.log(`\n🔍 ========== EXTRACTING EXAMPLES ==========`);
        
        if (!data || !data.def || !Array.isArray(data.def)) {
            console.log('❌ No definitions in response');
            return [];
        }

        const examples = [];

        data.def.forEach((definition) => {
            if (definition.tr && Array.isArray(definition.tr)) {
                definition.tr.forEach((translation) => {
                    // ✅ ИЩЕМ ПОЛЕ ex В КАЖДОМ ПЕРЕВОДЕ
                    if (translation.ex && Array.isArray(translation.ex)) {
                        console.log(`✅ FOUND EXAMPLES in translation "${translation.text}":`, translation.ex.length);
                        
                        translation.ex.forEach((example) => {
                            if (example.text && example.tr && Array.isArray(example.tr) && example.tr[0]?.text) {
                                const englishExample = example.text.trim();
                                const russianExample = example.tr[0].text.trim();
                                const formattedExample = `${englishExample} - ${russianExample}`;
                                examples.push(formattedExample);
                                console.log(`   ✅ ADDED: "${formattedExample}"`);
                            }
                        });
                    }
                });
            }
        });

        console.log(`📊 FINAL: Extracted ${examples.length} examples`);
        return examples.slice(0, 3);
    }

    generateContextualExamples(word, translation) {
        console.log('✏️ Using contextual examples');
        return [
            `I often use the word "${word}" in my conversations. - Я часто использую слово "${translation}" в разговорах.`,
            `Can you give me an example with "${word}"? - Можете привести пример с "${translation}"?`,
            `The word "${word}" is very useful in English. - Слово "${translation}" очень полезно в английском языке.`
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
