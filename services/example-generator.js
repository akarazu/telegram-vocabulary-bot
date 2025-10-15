import axios from 'axios';

export class ExampleGeneratorService {
    constructor() {
        this.useYandex = !!process.env.YANDEX_DICTIONARY_API_KEY;
    }

    async generateExamples(word, translation) {
        console.log(`🔄 Generating examples for: "${word}" -> "${translation}"`);
        
        let examples = [];

        // ✅ ПЕРВОЕ: пробуем получить примеры из Яндекс API
        if (this.useYandex) {
            try {
                console.log('🔍 PRIMARY: Trying Yandex API for examples...');
                const yandexExamples = await this.getYandexExamples(word);
                if (yandexExamples && yandexExamples.length > 0) {
                    examples = yandexExamples;
                    console.log(`✅ PRIMARY: Found ${yandexExamples.length} examples from Yandex`);
                    return examples;
                }
            } catch (error) {
                console.log('❌ PRIMARY: Yandex examples failed:', error.message);
            }
        }

        // ✅ ВТОРОЕ: пробуем получить примеры из бэкап словаря
        try {
            console.log('🔄 FALLBACK: Trying Backup Dictionary for examples...');
            const backupExamples = await this.getBackupExamples(word);
            if (backupExamples && backupExamples.length > 0) {
                examples = backupExamples;
                console.log(`✅ FALLBACK: Found ${backupExamples.length} examples from Backup`);
                return examples;
            }
        } catch (error) {
            console.log('❌ FALLBACK: Backup examples failed:', error.message);
        }

        // ✅ ТРЕТЬЕ: генерируем простые примеры вручную
        console.log('✏️  GENERIC: Creating generic examples...');
        examples = this.getGenericExamples(word, translation);
        console.log(`✅ GENERIC: Created ${examples.length} generic examples`);

        return examples;
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

            return this.extractExamplesFromYandex(response.data, word);
            
        } catch (error) {
            console.error('❌ Yandex examples error:', error.message);
            return [];
        }
    }

    extractExamplesFromYandex(data, originalWord) {
        // ✅ ВСЕГДА ВОЗВРАЩАЕМ МАССИВ
        if (!data.def || !Array.isArray(data.def) || data.def.length === 0) {
            console.log('❌ Yandex: No definitions found for examples');
            return [];
        }

        console.log(`🔍 Yandex found ${data.def.length} definition(s) for examples`);

        const examples = [];
        let exampleCount = 0;

        for (const definition of data.def) {
            if (exampleCount >= 3) break; // Ограничиваем 3 примерами
            
            if (definition.ex && Array.isArray(definition.ex)) {
                console.log(`🔍 Processing ${definition.ex.length} example(s) from Yandex`);
                
                for (const example of definition.ex) {
                    if (exampleCount >= 3) break;
                    
                    if (example.text && example.tr && Array.isArray(example.tr)) {
                        const englishExample = example.text.trim();
                        const russianExample = example.tr[0]?.text?.trim();
                        
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

        return examples;
    }

    async getBackupExamples(word) {
        try {
            console.log(`🔍 Backup API call for examples: "${word}"`);
            
            const response = await axios.get(
                `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
                { timeout: 5000 }
            );

            return this.extractExamplesFromFreeDictionary(response.data, word);
        } catch (error) {
            console.error('Free Dictionary API error for examples:', error.message);
            return []; // ✅ ВСЕГДА ВОЗВРАЩАЕМ МАССИВ
        }
    }

    extractExamplesFromFreeDictionary(data, originalWord) {
        // ✅ ВСЕГДА ВОЗВРАЩАЕМ МАССИВ
        if (!Array.isArray(data) || data.length === 0) {
            console.log('❌ FreeDictionary: No entries found for examples');
            return [];
        }

        console.log(`🔍 FreeDictionary found ${data.length} entry/entries for examples`);

        const examples = [];
        let exampleCount = 0;

        for (const entry of data) {
            if (exampleCount >= 3) break;
            
            if (entry.meanings && Array.isArray(entry.meanings)) {
                for (const meaning of entry.meanings) {
                    if (exampleCount >= 3) break;
                    
                    if (meaning.definitions && Array.isArray(meaning.definitions)) {
                        for (const definition of meaning.definitions) {
                            if (exampleCount >= 3) break;
                            
                            if (definition.example && definition.example.trim()) {
                                const englishExample = definition.example.trim();
                                // ✅ ФОРМАТИРУЕМ ПРИМЕР КАК СТРОКУ
                                const formattedExample = `${englishExample} - Пример использования`;
                                examples.push(formattedExample);
                                exampleCount++;
                                console.log(`✅ Backup example: "${formattedExample}"`);
                            }
                        }
                    }
                }
            }
        }

        return examples;
    }

    getGenericExamples(word, translation) {
        // ✅ ВСЕГДА ВОЗВРАЩАЕМ МАССИВ ИЗ 2 СТРОК
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
            // ✅ ОБРАБАТЫВАЕМ РАЗНЫЕ ФОРМАТЫ ДАННЫХ
            if (typeof example === 'string') {
                return `${index + 1}. ${example}`;
            } else if (example && typeof example === 'object' && example.english && example.russian) {
                return `${index + 1}. ${example.english} - ${example.russian}`;
            } else {
                // ✅ ЕСЛИ НЕИЗВЕСТНЫЙ ФОРМАТ, ПРЕОБРАЗУЕМ В СТРОКУ
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
            if (typeof example === 'string') {
                return example;
            } else if (example && typeof example === 'object' && example.english && example.russian) {
                return `${example.english} - ${example.russian}`;
            } else {
                return String(example);
            }
        });
        
        // ✅ ОБЪЕДИНЯЕМ ЧЕРЕЗ РАЗДЕЛИТЕЛЬ
        return stringExamples.join(' | ');
    }
}
