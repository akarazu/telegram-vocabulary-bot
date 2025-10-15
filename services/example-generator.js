import axios from 'axios';

export class ExampleGeneratorService {
    constructor() {
        this.useYandex = !!process.env.YANDEX_DICTIONARY_API_KEY;
        console.log('🔧 ExampleGeneratorService initialized, useYandex:', this.useYandex);
    }

    async generateExamples(word, translation) {
        console.log(`\n🔄 ========== GENERATING EXAMPLES ==========`);
        console.log(`🔄 Input: word="${word}", translation="${translation}"`);
        
        // ✅ ВРЕМЕННО ИСПОЛЬЗУЕМ ТОЛЬКО КОНТЕКСТНЫЕ ПРИМЕРЫ
        // чтобы избежать проблем с API пока решаем проблему с Telegram
        console.log('⚠️  Temporarily using contextual examples due to Telegram conflicts');
        return this.generateContextualExamples(word, translation);
        
        /*
        // Раскомментируйте когда решите проблему с Telegram
        if (!this.useYandex) {
            console.log('❌ Yandex API key not available, using contextual examples');
            return this.generateContextualExamples(word, translation);
        }

        try {
            console.log('🔍 PRIMARY: Trying Yandex JSON API for examples...');
            const yandexExamples = await this.getYandexExamples(word);
            
            if (yandexExamples && yandexExamples.length > 0) {
                console.log(`✅ PRIMARY SUCCESS: Found ${yandexExamples.length} examples from Yandex`);
                return yandexExamples;
            } else {
                console.log('❌ PRIMARY FAILED: No examples found in Yandex response');
                return this.generateContextualExamples(word, translation);
            }
        } catch (error) {
            console.log('❌ PRIMARY ERROR: Yandex examples failed:', error.message);
            return this.generateContextualExamples(word, translation);
        }
        */
    }

    async getYandexExamples(word) {
        try {
            console.log(`🔍 Yandex JSON API call for: "${word}"`);
            
            const response = await axios.get('https://dictionary.yandex.net/api/v1/dicservice.json/lookup', {
                params: {
                    key: process.env.YANDEX_DICTIONARY_API_KEY,
                    lang: 'en-ru',
                    text: word,
                    ui: 'ru'
                    // Без флагов - используем настройки по умолчанию
                },
                timeout: 5000
            });

            console.log('✅ Yandex JSON API response received');
            return this.extractExamplesFromYandexJSON(response.data, word);
            
        } catch (error) {
            console.error('❌ Yandex JSON API error:', error.message);
            return [];
        }
    }

    extractExamplesFromYandexJSON(data, originalWord) {
        if (!data || !data.def || !Array.isArray(data.def)) {
            console.log('❌ No valid data in Yandex JSON response');
            return [];
        }

        console.log(`🔍 Processing ${data.def.length} definition(s) from Yandex JSON`);

        const examples = [];

        // ✅ ОБРАБАТЫВАЕМ JSON СТРУКТУРУ YANDEX
        data.def.forEach(definition => {
            if (definition.tr && Array.isArray(definition.tr)) {
                definition.tr.forEach(translation => {
                    // ✅ ПРОВЕРЯЕМ ПОЛЕ "ex" В КАЖДОМ ПЕРЕВОДЕ
                    if (translation.ex && Array.isArray(translation.ex)) {
                        translation.ex.forEach(example => {
                            if (example.text && example.tr && Array.isArray(example.tr)) {
                                const englishExample = example.text.trim();
                                const russianExample = example.tr[0]?.text?.trim();
                                
                                if (englishExample && russianExample) {
                                    const formattedExample = `${englishExample} - ${russianExample}`;
                                    examples.push(formattedExample);
                                    console.log(`✅ Yandex JSON example: "${formattedExample}"`);
                                }
                            }
                        });
                    }
                });
            }
        });

        console.log(`📊 Extracted ${examples.length} examples from Yandex JSON`);
        return examples.slice(0, 3);
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
