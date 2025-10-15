import axios from 'axios';

export class ExampleGeneratorService {
    constructor() {
        this.useYandex = !!process.env.YANDEX_DICTIONARY_API_KEY;
    }

    async generateExamples(word, translation) {
        console.log(`🔄 Generating examples for: "${word}" -> "${translation}"`);
        
        // ✅ ИСПОЛЬЗУЕМ ТОЛЬКО YANDEX API
        if (this.useYandex) {
            try {
                console.log('🔍 PRIMARY: Trying Yandex API for examples...');
                const yandexExamples = await this.getYandexExamples(word);
                if (yandexExamples && yandexExamples.length > 0) {
                    console.log(`✅ PRIMARY: Found ${yandexExamples.length} examples from Yandex`);
                    return yandexExamples;
                } else {
                    console.log('❌ PRIMARY: No examples found in Yandex');
                    return this.getGenericExamples(word, translation);
                }
            } catch (error) {
                console.log('❌ PRIMARY: Yandex examples failed:', error.message);
                return this.getGenericExamples(word, translation);
            }
        } else {
            console.log('❌ Yandex API key not available, using generic examples');
            return this.getGenericExamples(word, translation);
        }
    }

    async getYandexExamples(word) {
        try {
            console.log(`🔍 Yandex API call for examples: "${word}"`);
            
            const response = await axios.get('https://dictionary.yandex.net/api/v1/dicservice.json/lookup', {
                params: {
                    key: process.env.YANDEX_DICTIONARY_API_KEY,
                    lang: 'en-ru',
                    text: word,
                    ui: 'ru'
                },
                timeout: 10000
            });

            console.log('📊 Yandex API response received');
            return this.extractExamplesFromYandex(response.data, word);
            
        } catch (error) {
            console.error('❌ Yandex examples error:', error.message);
            if (error.response) {
                console.error('Yandex response status:', error.response.status);
                console.error('Yandex response data:', error.response.data);
            }
            return [];
        }
    }

    extractExamplesFromYandex(data, originalWord) {
        // ✅ ВСЕГДА ВОЗВРАЩАЕМ МАССИВ
        if (!data.def || !Array.isArray(data.def) || data.def.length === 0) {
            console.log('❌ Yandex: No definitions found for examples');
            return [];
        }

        console.log(`🔍 Yandex found ${data.def.length} definition(s)`);

        const examples = [];
        let exampleCount = 0;

        // ✅ ПРАВИЛЬНО ОБРАБАТЫВАЕМ СТРУКТУРУ YANDEX API
        for (const definition of data.def) {
            if (exampleCount >= 3) break;
            
            // ✅ ИЩЕМ ПРИМЕРЫ В ПЕРЕВОДАХ (tr)
            if (definition.tr && Array.isArray(definition.tr)) {
                for (const translation of definition.tr) {
                    if (exampleCount >= 3) break;
                    
                    // ✅ ПРИМЕРЫ НАХОДЯТСЯ В ПОЛЕ "ex" КАЖДОГО ПЕРЕВОДА
                    if (translation.ex && Array.isArray(translation.ex)) {
                        console.log(`🔍 Processing ${translation.ex.length} example(s) from translation: "${translation.text}"`);
                        
                        for (const example of translation.ex) {
                            if (exampleCount >= 3) break;
                            
                            // ✅ ПРАВИЛЬНАЯ СТРУКТУРА ПРИМЕРА: example.text (англ) и example.tr[0].text (рус)
                            if (example.text && example.tr && Array.isArray(example.tr) && example.tr[0]?.text) {
                                const englishExample = example.text.trim();
                                const russianExample = example.tr[0].text.trim();
                                
                                if (englishExample && russianExample) {
                                    // ✅ ФОРМАТИРУЕМ ПРИМЕР КАК СТРОКУ
                                    const formattedExample = `${englishExample} - ${russianExample}`;
                                    examples.push(formattedExample);
                                    exampleCount++;
                                    console.log(`✅ Yandex example: "${formattedExample}"`);
                                }
                            }
                        }
                    }
                }
            }
        }

        console.log(`📊 Extracted ${examples.length} examples from Yandex`);
        return examples;
    }

    getGenericExamples(word, translation) {
        // ✅ ВСЕГДА ВОЗВРАЩАЕМ МАССИВ ИЗ 2 СТРОК (fallback)
        console.log('✏️  Using generic examples as fallback');
        return [
            `I often use the word "${word}" in my conversations. - Я часто использую слово "${translation}" в разговорах.`,
            `Can you give me an example with "${word}"? - Можете привести пример с "${translation}"?`
        ];
    }

    // ✅ Дополнительный метод для форматирования примеров в читаемый вид
    formatExamplesForDisplay(examples) {
        // ✅ ЗАЩИТА ОТ НЕКОРРЕКТНЫХ ДАННЫХ
        if (!examples || !Array.isArray(examples)) {
            return 'Примеры не найдены';
        }
        
        if (examples.length === 0) {
            return 'Примеры не найдены';
        }
        
        return examples.map((example, index) => {
            if (typeof example === 'string') {
                return `${index + 1}. ${example}`;
            } else {
                return `${index + 1}. ${String(example)}`;
            }
        }).join('\n');
    }

    // ✅ НОВЫЙ МЕТОД: безопасное преобразование примеров для сохранения
    formatExamplesForStorage(examples) {
        // ✅ ЗАЩИТА ОТ НЕКОРРЕКТНЫХ ДАННЫХ
        if (!examples || !Array.isArray(examples)) {
            return '';
        }
        
        if (examples.length === 0) {
            return '';
        }
        
        // ✅ ПРЕОБРАЗУЕМ ВСЕ ЭЛЕМЕНТЫ В СТРОКИ
        const stringExamples = examples.map(example => {
            return typeof example === 'string' ? example : String(example);
        });
        
        // ✅ ОБЪЕДИНЯЕМ ЧЕРЕЗ РАЗДЕЛИТЕЛЬ
        return stringExamples.join(' | ');
    }
}
