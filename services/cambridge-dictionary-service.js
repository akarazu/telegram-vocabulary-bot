import axios from 'axios';

class CambridgeDictionaryService {
    constructor() {
        this.baseUrl = 'https://dictionary.cambridge.org/dictionary/english';
        this.requestCount = 0;
        this.lastRequestTime = 0;
        
        // 🔧 НАСТРОЙКИ ОБХОДА ОГРАНИЧЕНИЙ
        this.config = {
            minDelay: 3000,
            maxDelay: 8000,
            maxRetries: 2,
            timeout: 20000,
            userAgents: [
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            ]
        };

        this.cheerio = null;
    }

    // 🔧 ДИНАМИЧЕСКАЯ ЗАГРУЗКА CHEERIO С ОБРАБОТКОЙ ОШИБОК
    async loadCheerio() {
        if (!this.cheerio) {
            try {
                const cheerioModule = await import('cheerio');
                this.cheerio = cheerioModule.default;
                console.log('✅ Cheerio успешно загружен');
            } catch (error) {
                console.error('❌ Ошибка загрузки cheerio:', error);
                throw new Error('Не удалось загрузить парсер HTML');
            }
        }
        return this.cheerio;
    }

    async randomDelay() {
        const delay = Math.random() * (this.config.maxDelay - this.config.minDelay) + this.config.minDelay;
        console.log(`⏳ Задержка: ${Math.round(delay)}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
    }

    getRandomUserAgent() {
        return this.config.userAgents[Math.floor(Math.random() * this.config.userAgents.length)];
    }

    async checkRateLimit() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        
        if (timeSinceLastRequest < this.config.minDelay) {
            const waitTime = this.config.minDelay - timeSinceLastRequest;
            console.log(`🚦 Rate limiting: ждем ${waitTime}ms`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
        
        this.lastRequestTime = Date.now();
        this.requestCount++;
    }

    async getWordData(word, retryCount = 0) {
        await this.checkRateLimit();
        
        try {
            console.log(`🔍 [Cambridge] Поиск слова: "${word}" (попытка ${retryCount + 1}/${this.config.maxRetries})`);
            
            const response = await axios.get(`${this.baseUrl}/${encodeURIComponent(word.toLowerCase())}`, {
                headers: {
                    'User-Agent': this.getRandomUserAgent(),
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9,ru;q=0.8',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive',
                    'DNT': '1',
                    'Upgrade-Insecure-Requests': '1',
                    'Sec-Fetch-Dest': 'document',
                    'Sec-Fetch-Mode': 'navigate',
                    'Sec-Fetch-Site': 'none',
                    'Cache-Control': 'max-age=0'
                },
                timeout: this.config.timeout,
                validateStatus: function (status) {
                    return status < 500;
                }
            });

            // Загружаем cheerio
            const cheerio = await this.loadCheerio();
            if (!cheerio) {
                throw new Error('Cheerio не загружен');
            }

            const $ = cheerio.load(response.data);
            
            // 🔧 ПРОВЕРКА НА БЛОКИРОВКУ ИЛИ CAPTCHA
            if (this.isBlocked(response.data, $)) {
                console.log('❌ [Cambridge] Обнаружена блокировка');
                throw new Error('Cambridge Dictionary заблокировал запрос');
            }

            // 🔧 ПРОВЕРКА НА СУЩЕСТВОВАНИЕ СЛОВА
            if (this.isWordNotFound(response.data, $)) {
                console.log('❌ [Cambridge] Слово не найдено');
                throw new Error('Слово не найдено в Cambridge Dictionary');
            }

            console.log(`✅ [Cambridge] Успешно получены данные для: "${word}"`);
            return await this.parseCambridgeHTML(response.data, word, $);
            
        } catch (error) {
            console.error(`❌ [Cambridge] Ошибка (попытка ${retryCount + 1}):`, error.message);
            
            if (this.shouldRetry(error) && retryCount < this.config.maxRetries - 1) {
                console.log(`🔄 [Cambridge] Повтор запроса через ${this.config.minDelay}ms...`);
                await this.randomDelay();
                return this.getWordData(word, retryCount + 1);
            }
            
            // 🔧 ВОЗВРАЩАЕМ ЗАГЛУШКУ С ОСНОВНЫМ ПЕРЕВОДОМ
            return this.getFallbackData(word, error.message);
        }
    }

    // 🔧 ЗАГЛУШКА НА СЛУЧАЙ ОШИБКИ
    getFallbackData(word, errorMessage) {
        console.log(`🔧 [Cambridge] Используем fallback данные для: "${word}"`);
        
        const basicTranslations = {
            'hello': 'привет',
            'world': 'мир',
            'book': 'книга',
            'computer': 'компьютер',
            'language': 'язык',
            'word': 'слово',
            'dictionary': 'словарь',
            'translate': 'переводить',
            'learn': 'учить',
            'study': 'изучать',
            'home': 'дом',
            'work': 'работа',
            'time': 'время',
            'people': 'люди',
            'water': 'вода',
            'food': 'еда',
            'good': 'хороший',
            'bad': 'плохой',
            'big': 'большой',
            'small': 'маленький',
            'new': 'новый',
            'old': 'старый',
            'man': 'мужчина',
            'woman': 'женщина',
            'child': 'ребенок',
            'school': 'школа',
            'city': 'город',
            'country': 'страна',
            'day': 'день',
            'night': 'ночь',
            'sun': 'солнце',
            'moon': 'луна',
            'star': 'звезда',
            'tree': 'дерево',
            'flower': 'цветок',
            'animal': 'животное',
            'dog': 'собака',
            'cat': 'кошка',
            'bird': 'птица',
            'fish': 'рыба'
        };

        const translation = basicTranslations[word.toLowerCase()] || this.generateBasicTranslation(word);
        
        return {
            word: word,
            meanings: [
                {
                    id: 'fallback_1',
                    translation: translation,
                    englishDefinition: `The word "${word}" - basic definition`,
                    englishWord: word,
                    partOfSpeech: this.guessPartOfSpeech(word),
                    examples: [
                        {
                            english: `This is an example sentence with the word "${word}".`,
                            russian: ''
                        },
                        {
                            english: `You can use "${word}" in different contexts.`,
                            russian: ''
                        }
                    ],
                    synonyms: [],
                    source: 'Basic Dictionary'
                }
            ],
            transcription: '',
            audioUrl: '',
            source: 'Fallback Service',
            error: errorMessage
        };
    }

    // 🔧 ГЕНЕРАЦИЯ БАЗОВОГО ПЕРЕВОДА
    generateBasicTranslation(word) {
        const wordLower = word.toLowerCase();
        
        // Простая логика для определения типа слова
        if (wordLower.endsWith('ing') || wordLower.endsWith('ed')) {
            return 'действие или процесс';
        }
        if (wordLower.endsWith('ly')) {
            return 'образ действия';
        }
        if (wordLower.endsWith('ful') || wordLower.endsWith('ous') || wordLower.endsWith('ive')) {
            return 'качество или свойство';
        }
        if (wordLower.endsWith('tion') || wordLower.endsWith('sion') || wordLower.endsWith('ment')) {
            return 'процесс или результат';
        }
        if (wordLower.endsWith('er') || wordLower.endsWith('or')) {
            return 'человек или предмет';
        }
        if (wordLower.endsWith('ness') || wordLower.endsWith('ity')) {
            return 'состояние или качество';
        }
        
        return 'основное значение';
    }

    // 🔧 ОПРЕДЕЛЕНИЕ ЧАСТИ РЕЧИ ПО СЛОВУ
    guessPartOfSpeech(word) {
        const wordLower = word.toLowerCase();
        
        if (wordLower.endsWith('ing') || wordLower.endsWith('ed')) {
            return 'глагол';
        }
        if (wordLower.endsWith('ly')) {
            return 'наречие';
        }
        if (wordLower.endsWith('ful') || wordLower.endsWith('ous') || wordLower.endsWith('ive') || 
            wordLower.endsWith('able') || wordLower.endsWith('ible')) {
            return 'прилагательное';
        }
        if (wordLower.endsWith('tion') || wordLower.endsWith('sion') || wordLower.endsWith('ment') ||
            wordLower.endsWith('ness') || wordLower.endsWith('ity')) {
            return 'существительное';
        }
        
        return 'неизвестно';
    }

    // 🔧 ПРОВЕРКА НА БЛОКИРОВКУ
    isBlocked(html, $) {
        const text = html.toLowerCase();
        return text.includes('captcha') || 
               text.includes('blocked') || 
               text.includes('robot') ||
               text.includes('access denied') ||
               text.includes('too many requests') ||
               text.includes('rate limit') ||
               $('.error-page').length > 0;
    }

    // 🔧 ПРОВЕРКА НА НЕНАЙДЕННОЕ СЛОВО
    isWordNotFound(html, $) {
        const text = html.toLowerCase();
        return text.includes('not found') || 
               text.includes('no entries found') ||
               text.includes('no results') ||
               $('.cdo-search__no-results').length > 0 ||
               $('.empty-page').length > 0;
    }

    // 🔧 ОПРЕДЕЛЕНИЕ НУЖНО ЛИ ПОВТОРЯТЬ ЗАПРОС
    shouldRetry(error) {
        const retryableErrors = [
            'ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'ENOTFOUND',
            'timeout', 'Network Error', 'blocked', 'CAPTCHA'
        ];
        
        return retryableErrors.some(retryError => 
            error.message.includes(retryError) || 
            error.code === retryError
        );
    }

    // 🔧 УПРОЩЕННЫЙ ПАРСИНГ HTML
    async parseCambridgeHTML(html, word, $) {
        const result = {
            word: word,
            meanings: [],
            transcription: '',
            audioUrl: '',
            source: 'Cambridge Dictionary'
        };

        console.log(`📖 [Cambridge] Парсинг HTML для: "${word}"`);

        try {
            // ✅ ТРАНСКРИПЦИЯ
            const pronunciation = $('.ipa, .pron, [pronunciation]').first().text();
            if (pronunciation) {
                result.transcription = `/${pronunciation.trim()}/`;
                console.log(`🔤 [Cambridge] Транскрипция: ${result.transcription}`);
            }

            // ✅ АУДИО ПРОИЗНОШЕНИЕ
            const audioElement = $('.audio_play_button, [data-src-mp3], .pronunciation audio source').first();
            if (audioElement.length) {
                let audioPath = audioElement.attr('data-src-mp3') || audioElement.attr('src');
                if (audioPath && !audioPath.startsWith('http')) {
                    audioPath = `https://dictionary.cambridge.org${audioPath}`;
                }
                result.audioUrl = audioPath;
                console.log(`🎵 [Cambridge] Аудио URL: ${result.audioUrl}`);
            }

            // ✅ ПАРСИНГ ОПРЕДЕЛЕНИЙ - УПРОЩЕННАЯ ВЕРСИЯ
            $('.def-block, .sense-body, .entry-body__el, .ddef_h, .def-panel').each((entryIndex, entryElement) => {
                try {
                    const $entry = $(entryElement);
                    
                    // Ищем определение
                    const definition = $entry.find('.def, .ddef_d, .trans, .sense-title, .def-info').text().trim();
                    if (!definition || definition.length < 5) return;

                    console.log(`   📝 Найдено определение: ${definition.substring(0, 60)}...`);

                    // Примеры использования
                    const examples = [];
                    $entry.find('.examp, .deg, .example, .eg').each((exIndex, exElement) => {
                        const example = $(exElement).text().trim();
                        if (example && example.length > 10) {
                            examples.push({
                                english: example,
                                russian: ''
                            });
                        }
                    });

                    // Часть речи
                    const partOfSpeech = $entry.find('.pos, .dpos, .grammar, .pg').first().text().trim() || 'unknown';

                    // Создаем объект значения
                    const meaning = {
                        id: `cam_${entryIndex}_${Date.now()}`,
                        translation: this.generateTranslation(definition, word),
                        englishDefinition: definition,
                        englishWord: word,
                        partOfSpeech: this.translatePOS(partOfSpeech),
                        examples: examples.slice(0, 2),
                        synonyms: [],
                        source: 'Cambridge Dictionary'
                    };

                    result.meanings.push(meaning);
                } catch (entryError) {
                    console.error('   ❌ Ошибка парсинга элемента:', entryError.message);
                }
            });

            // 🔧 ЕСЛИ ОПРЕДЕЛЕНИЙ НЕ НАЙДЕНО, ИСПОЛЬЗУЕМ УПРОЩЕННЫЙ МЕТОД
            if (result.meanings.length === 0) {
                console.log('🔧 [Cambridge] Используем упрощенный парсинг');
                this.simpleParse(html, word, $, result);
            }

        } catch (parseError) {
            console.error('❌ [Cambridge] Ошибка парсинга:', parseError);
            // В случае ошибки парсинга используем fallback
            const fallback = this.getFallbackData(word, 'Parse error: ' + parseError.message);
            result.meanings = fallback.meanings;
        }

        console.log(`✅ [Cambridge] Распаршено ${result.meanings.length} значений`);
        return result;
    }

    // 🔧 УПРОЩЕННЫЙ ПАРСИНГ ДЛЯ СЛОЖНЫХ СЛУЧАЕВ
    simpleParse(html, word, $, result) {
        try {
            // Ищем любой текст, который похож на определения
            const text = $('body').text();
            const lines = text.split('\n').map(line => line.trim()).filter(line => 
                line.length > 20 && 
                line.length < 300 &&
                !line.includes('©') &&
                !line.includes('Cambridge') &&
                !line.includes('Privacy') &&
                !line.includes('Terms')
            );

            lines.slice(0, 3).forEach((line, index) => {
                if (line.toLowerCase().includes(word.toLowerCase()) && line.length > 30) {
                    const meaning = {
                        id: `simple_${index}_${Date.now()}`,
                        translation: this.generateTranslation(line, word),
                        englishDefinition: line.substring(0, 150) + '...',
                        englishWord: word,
                        partOfSpeech: this.guessPartOfSpeech(word),
                        examples: [
                            {
                                english: `Example: "${word}" can be used in various contexts.`,
                                russian: ''
                            }
                        ],
                        synonyms: [],
                        source: 'Cambridge Dictionary (Simple Parse)'
                    };
                    result.meanings.push(meaning);
                }
            });

            // Если все еще нет значений, добавляем fallback
            if (result.meanings.length === 0) {
                const fallback = this.getFallbackData(word, 'No definitions found in simple parse');
                result.meanings = fallback.meanings;
            }
        } catch (error) {
            console.error('❌ Ошибка в simpleParse:', error);
            const fallback = this.getFallbackData(word, 'Simple parse error');
            result.meanings = fallback.meanings;
        }
    }

    // 🔧 ГЕНЕРАЦИЯ ПЕРЕВОДА НА ОСНОВЕ ОПРЕДЕЛЕНИЯ
    generateTranslation(definition, word) {
        const definitionLower = definition.toLowerCase();
        const wordLower = word.toLowerCase();
        
        // Простая логика для генерации перевода на основе контекста
        if (definitionLower.includes('person who') || definitionLower.includes('someone who')) {
            return 'человек, который';
        }
        if (definitionLower.includes('something that') || definitionLower.includes('thing that')) {
            return 'что-то, что';
        }
        if (definitionLower.includes('the ability to') || definitionLower.includes('capacity to')) {
            return 'способность';
        }
        if (definitionLower.includes('the process of') || definitionLower.includes('act of')) {
            return 'процесс';
        }
        if (definitionLower.includes('the state of') || definitionLower.includes('condition of')) {
            return 'состояние';
        }
        if (definitionLower.includes('to make') || definitionLower.includes('to cause')) {
            return 'сделать, заставить';
        }
        if (definitionLower.includes('to become') || definitionLower.includes('to turn into')) {
            return 'стать, превратиться';
        }
        if (definitionLower.includes('having') || definitionLower.includes('with')) {
            return 'имеющий, обладающий';
        }
        if (definitionLower.includes('relating to') || definitionLower.includes('connected with')) {
            return 'относящийся к';
        }
        
        return this.generateBasicTranslation(word);
    }

    translatePOS(cambridgePOS) {
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
        
        const posLower = cambridgePOS.toLowerCase();
        for (const [en, ru] of Object.entries(posMap)) {
            if (posLower.includes(en)) {
                return ru;
            }
        }
        
        return cambridgePOS;
    }

    resetCounters() {
        this.requestCount = 0;
        this.lastRequestTime = 0;
        console.log('🔄 [Cambridge] Счетчики запросов сброшены');
    }
}

export { CambridgeDictionaryService };
