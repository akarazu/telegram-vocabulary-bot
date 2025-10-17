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
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                timeout: 10000,
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
            // ПАРСИМ ПЕРЕВОДЫ - ищем русские переводы в HTML
            const translationMatches = html.match(/<span class="trans dtrans dtrans-se[^>]*>([^<]+)<\/span>/g);
            
            if (translationMatches) {
                translationMatches.forEach((match, index) => {
                    const translation = match.replace(/<[^>]+>/g, '').trim();
                    
                    if (translation && !translation.includes('{') && !translation.includes('}')) {
                        const meaning = {
                            id: `cam_${index}`,
                            translation: translation,
                            englishDefinition: this.findEnglishDefinition(html, index),
                            englishWord: word,
                            partOfSpeech: this.findPartOfSpeech(html, index),
                            examples: this.findExamples(html, index),
                            synonyms: [],
                            source: 'Cambridge Dictionary'
                        };
                        
                        result.meanings.push(meaning);
                        console.log(`✅ Найден перевод: ${translation}`);
                    }
                });
            }

            // Альтернативный поиск переводов
            if (result.meanings.length === 0) {
                this.alternativeTranslationParse(html, word, result);
            }

        } catch (error) {
            console.error('❌ Ошибка парсинга:', error);
        }

        console.log(`✅ [Cambridge] Найдено ${result.meanings.length} переводов`);
        return result;
    }

    alternativeTranslationParse(html, word, result) {
        // Другие паттерны для поиска переводов
        const patterns = [
            /<span[^>]*data-trans="([^"]*)"[^>]*>/g,
            /<span[^>]*class="[^"]*trans[^"]*"[^>]*>([^<]+)<\/span>/g,
            /"translation":"([^"]+)"/g
        ];

        for (const pattern of patterns) {
            const matches = [...html.matchAll(pattern)];
            if (matches.length > 0) {
                matches.forEach((match, index) => {
                    const translation = match[1] || match[0].replace(pattern, '$1').replace(/<[^>]+>/g, '').trim();
                    
                    if (translation && translation.length > 1 && !translation.includes('{')) {
                        const meaning = {
                            id: `alt_${index}`,
                            translation: translation,
                            englishDefinition: `Definition for ${word}`,
                            englishWord: word,
                            partOfSpeech: 'unknown',
                            examples: [],
                            synonyms: [],
                            source: 'Cambridge Dictionary'
                        };
                        
                        if (!result.meanings.some(m => m.translation === translation)) {
                            result.meanings.push(meaning);
                            console.log(`✅ Найден перевод (alt): ${translation}`);
                        }
                    }
                });
                
                if (result.meanings.length > 0) break;
            }
        }
    }

    findEnglishDefinition(html, index) {
        // Ищем английское определение рядом с переводом
        const defPattern = /<div class="def ddef_d db">([^<]+)<\/div>/g;
        const matches = [...html.matchAll(defPattern)];
        
        if (matches[index]) {
            return matches[index][1].trim();
        }
        return `Definition ${index + 1}`;
    }

    findPartOfSpeech(html, index) {
        // Ищем часть речи
        const posPattern = /<span class="pos dpos">([^<]+)<\/span>/g;
        const matches = [...html.matchAll(posPattern)];
        
        if (matches[index]) {
            return this.translatePOS(matches[index][1]);
        }
        return 'unknown';
    }

    findExamples(html, index) {
        // Ищем примеры использования
        const examplePattern = /<span class="eg deg">([^<]+)<\/span>/g;
        const matches = [...html.matchAll(examplePattern)];
        const examples = [];
        
        if (matches[index]) {
            examples.push({
                english: matches[index][1].trim(),
                russian: ''
            });
        }
        
        return examples;
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
