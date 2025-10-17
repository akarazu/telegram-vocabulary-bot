import axios from 'axios';

class CambridgeDictionaryService {
    constructor() {
        this.baseUrl = 'https://dictionary.cambridge.org/dictionary/english';
    }

    async getWordData(word) {
        try {
            console.log(`🔍 [Cambridge] Поиск слова: "${word}"`);
            
            const response = await axios.get(`${this.baseUrl}/${encodeURIComponent(word.toLowerCase())}`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive',
                },
                timeout: 15000,
            });

            return this.parseCambridgeHTML(response.data, word);
            
        } catch (error) {
            console.error(`❌ [Cambridge] Ошибка:`, error.message);
            return { word, meanings: [] };
        }
    }

    parseCambridgeHTML(html, word) {
        const result = {
            word: word,
            meanings: []
        };

        console.log(`📖 [Cambridge] Парсинг HTML для: "${word}"`);

        try {
            // 🔧 ОСНОВНОЙ ПАРСИНГ - ищем блоки с определениями
            const definitionBlocks = html.match(/<div class="def-block ddef_block[^>]*>[\s\S]*?<\/div><\/div>/g);
            
            if (definitionBlocks) {
                console.log(`🎯 Найдено блоков определений: ${definitionBlocks.length}`);
                
                definitionBlocks.forEach((block, blockIndex) => {
                    this.parseDefinitionBlock(block, word, blockIndex, result);
                });
            }

            // 🔧 АЛЬТЕРНАТИВНЫЙ ПАРСИНГ - если не нашли блоки
            if (result.meanings.length === 0) {
                console.log('🔧 Используем альтернативный парсинг...');
                this.alternativeParse(html, word, result);
            }

        } catch (error) {
            console.error('❌ Ошибка парсинга:', error);
        }

        console.log(`✅ [Cambridge] Найдено ${result.meanings.length} переводов`);
        
        // Логируем найденные переводы для отладки
        result.meanings.forEach((meaning, index) => {
            console.log(`   ${index + 1}. "${meaning.translation}" - ${meaning.englishDefinition.substring(0, 50)}...`);
        });
        
        return result;
    }

    parseDefinitionBlock(block, word, blockIndex, result) {
        try {
            // 🔍 ИЩЕМ ПЕРЕВОД (русский)
            const translationMatch = block.match(/<span class="trans dtrans dtrans-se[^>]*>([^<]+)<\/span>/);
            if (!translationMatch) {
                console.log(`   ❌ В блоке ${blockIndex} не найден перевод`);
                return;
            }

            const translation = translationMatch[1].trim();
            console.log(`   ✅ Найден перевод: "${translation}"`);

            // 🔍 ИЩЕМ АНГЛИЙСКОЕ ОПРЕДЕЛЕНИЕ
            const definitionMatch = block.match(/<div class="def ddef_d db">([^<]+)<\/div>/);
            const englishDefinition = definitionMatch ? definitionMatch[1].trim() : `Definition for ${word}`;

            // 🔍 ИЩЕМ ЧАСТЬ РЕЧИ
            const posMatch = block.match(/<span class="pos dpos">([^<]+)<\/span>/);
            const partOfSpeech = posMatch ? this.translatePOS(posMatch[1].trim()) : 'unknown';

            // 🔍 ИЩЕМ ПРИМЕРЫ
            const examples = [];
            const exampleMatches = block.match(/<span class="eg deg">([^<]+)<\/span>/g);
            if (exampleMatches) {
                exampleMatches.forEach(exampleMatch => {
                    const exampleText = exampleMatch.replace(/<[^>]+>/g, '').trim();
                    if (exampleText) {
                        examples.push({
                            english: exampleText,
                            russian: ''
                        });
                    }
                });
            }

            // 🔍 ИЩЕМ УРОВЕНЬ СЛОВА (A1, B2, etc)
            const levelMatch = block.match(/<span class="epp-xref dxref[^>]*>([^<]+)<\/span>/);
            const level = levelMatch ? levelMatch[1].trim() : '';

            const meaning = {
                id: `cam_${blockIndex}_${Date.now()}`,
                translation: translation,
                englishDefinition: englishDefinition,
                englishWord: word,
                partOfSpeech: partOfSpeech,
                examples: examples,
                synonyms: [],
                level: level,
                source: 'Cambridge Dictionary'
            };

            // Проверяем на дубликаты перед добавлением
            const isDuplicate = result.meanings.some(m => 
                m.translation === meaning.translation && 
                m.englishDefinition === meaning.englishDefinition
            );

            if (!isDuplicate) {
                result.meanings.push(meaning);
                console.log(`   ✅ Добавлено значение: "${translation}"`);
            } else {
                console.log(`   ⚠️ Пропущен дубликат: "${translation}"`);
            }

        } catch (error) {
            console.error(`   ❌ Ошибка парсинга блока ${blockIndex}:`, error.message);
        }
    }

    alternativeParse(html, word, result) {
        try {
            // 🔧 ПРОСТОЙ ПОИСК ПО РЕГУЛЯРНЫМ ВЫРАЖЕНИЯМ
            console.log('🔧 Простой поиск переводов...');
            
            // Ищем все русские переводы
            const allTranslations = html.match(/<span[^>]*lang="ru"[^>]*>([^<]+)<\/span>/g) || 
                                   html.match(/<span[^>]*class="[^"]*trans[^"]*"[^>]*>([^<]+)<\/span>/g);
            
            if (allTranslations) {
                allTranslations.forEach((match, index) => {
                    const translation = match.replace(/<[^>]+>/g, '').trim();
                    
                    // Фильтруем мусор
                    if (translation && 
                        translation.length > 2 && 
                        !translation.includes('{') && 
                        !translation.includes('}') &&
                        !translation.includes('Cambridge') &&
                        /[а-яА-Я]/.test(translation)) {
                        
                        const meaning = {
                            id: `alt_${index}_${Date.now()}`,
                            translation: translation,
                            englishDefinition: `Alternative definition for ${word}`,
                            englishWord: word,
                            partOfSpeech: 'unknown',
                            examples: [],
                            synonyms: [],
                            source: 'Cambridge Dictionary (Alt)'
                        };
                        
                        // Проверяем на дубликаты
                        if (!result.meanings.some(m => m.translation === translation)) {
                            result.meanings.push(meaning);
                            console.log(`   ✅ Альтернативный перевод: "${translation}"`);
                        }
                    }
                });
            }

            // 🔧 ПОИСК В JSON-LD структуре
            const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
            if (jsonLdMatch) {
                try {
                    const jsonData = JSON.parse(jsonLdMatch[1]);
                    this.parseJsonLd(jsonData, word, result);
                } catch (jsonError) {
                    console.log('   ❌ Не удалось распарсить JSON-LD');
                }
            }

        } catch (error) {
            console.error('❌ Ошибка альтернативного парсинга:', error);
        }
    }

    parseJsonLd(jsonData, word, result) {
        try {
            if (jsonData.description) {
                const meaning = {
                    id: `json_${Date.now()}`,
                    translation: this.generateTranslationFromDefinition(jsonData.description),
                    englishDefinition: jsonData.description,
                    englishWord: word,
                    partOfSpeech: 'unknown',
                    examples: [],
                    synonyms: [],
                    source: 'Cambridge Dictionary (JSON)'
                };
                
                if (!result.meanings.some(m => m.translation === meaning.translation)) {
                    result.meanings.push(meaning);
                    console.log(`   ✅ JSON перевод: "${meaning.translation}"`);
                }
            }
        } catch (error) {
            console.log('   ❌ Ошибка парсинга JSON-LD');
        }
    }

    generateTranslationFromDefinition(definition) {
        const def = definition.toLowerCase();
        
        if (def.includes('enjoy') && def.includes('pleasure')) return 'получать удовольствие';
        if (def.includes('person who') || def.includes('someone who')) return 'человек, который';
        if (def.includes('something that') || def.includes('thing that')) return 'что-то, что';
        if (def.includes('the ability to')) return 'способность';
        if (def.includes('the process of')) return 'процесс';
        if (def.includes('the state of')) return 'состояние';
        if (def.includes('to make') || def.includes('to cause')) return 'сделать';
        if (def.includes('to become')) return 'стать';
        if (def.includes('having') || def.includes('with')) return 'имеющий';
        if (def.includes('relating to')) return 'относящийся к';
        
        return 'основное значение';
    }

    translatePOS(englishPOS) {
        const posMap = {
            'noun': 'существительное',
            'verb': 'глагол', 
            'adjective': 'прилагательное',
            'adverb': 'наречие',
            'pronoun': 'местоимение',
            'preposition': 'предлог',
            'conjunction': 'союз',
            'interjection': 'междометие'
        };
        
        return posMap[englishPOS.toLowerCase()] || englishPOS;
    }
}

export { CambridgeDictionaryService };
