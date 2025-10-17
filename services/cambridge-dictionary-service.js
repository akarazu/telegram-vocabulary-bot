import axios from 'axios';

// Для Railway используем такой импорт
let cheerio;

class CambridgeDictionaryService {
    constructor() {
        this.baseUrl = 'https://dictionary.cambridge.org/dictionary/english';
        this.requestCount = 0;
        this.lastRequestTime = 0;
        
        // 🔧 НАСТРОЙКИ ОБХОДА ОГРАНИЧЕНИЙ
        this.config = {
            minDelay: 2000,
            maxDelay: 5000,
            maxRetries: 3,
            timeout: 15000,
            userAgents: [
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15'
            ],
            referers: [
                'https://www.google.com/',
                'https://www.bing.com/',
                'https://duckduckgo.com/',
                'https://www.yahoo.com/',
                'https://www.wikipedia.org/'
            ]
        };
    }

    // 🔧 ДИНАМИЧЕСКАЯ ЗАГРУЗКА CHEERIO
    async loadCheerio() {
        if (!cheerio) {
            // Для Railway используем обычный require
            cheerio = (await import('cheerio')).default;
        }
        return cheerio;
    }

    async randomDelay() {
        const delay = Math.random() * (this.config.maxDelay - this.config.minDelay) + this.config.minDelay;
        console.log(`⏳ Задержка: ${Math.round(delay)}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
    }

    getRandomUserAgent() {
        return this.config.userAgents[Math.floor(Math.random() * this.config.userAgents.length)];
    }

    getRandomReferer() {
        return this.config.referers[Math.floor(Math.random() * this.config.referers.length)];
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
            
            const response = await axios.get(`${this.baseUrl}/${encodeURIComponent(word)}`, {
                headers: {
                    'User-Agent': this.getRandomUserAgent(),
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9,ru;q=0.8',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive',
                    'Referer': this.getRandomReferer(),
                    'DNT': '1',
                    'Upgrade-Insecure-Requests': '1',
                    'Sec-Fetch-Dest': 'document',
                    'Sec-Fetch-Mode': 'navigate',
                    'Sec-Fetch-Site': 'cross-site',
                    'Cache-Control': 'max-age=0'
                },
                timeout: this.config.timeout,
                validateStatus: function (status) {
                    return status < 400;
                }
            });

            // Загружаем cheerio
            const cheerio = await this.loadCheerio();
            
            // 🔧 ПРОВЕРКА НА БЛОКИРОВКУ ИЛИ CAPTCHA
            if (this.isBlocked(response.data, cheerio)) {
                throw new Error('Cambridge Dictionary заблокировал запрос');
            }

            // 🔧 ПРОВЕРКА НА СУЩЕСТВОВАНИЕ СЛОВА
            if (this.isWordNotFound(response.data, cheerio)) {
                throw new Error('Слово не найдено в Cambridge Dictionary');
            }

            console.log(`✅ [Cambridge] Успешно получены данные для: "${word}"`);
            return this.parseCambridgeHTML(response.data, word, cheerio);
            
        } catch (error) {
            console.error(`❌ [Cambridge] Ошибка (попытка ${retryCount + 1}):`, error.message);
            
            if (this.shouldRetry(error) && retryCount < this.config.maxRetries - 1) {
                console.log(`🔄 [Cambridge] Повтор запроса через ${this.config.minDelay}ms...`);
                await this.randomDelay();
                return this.getWordData(word, retryCount + 1);
            }
            
            return { 
                word, 
                meanings: [], 
                transcription: '', 
                audioUrl: '',
                error: error.message 
            };
        }
    }

    // 🔧 ПРОВЕРКА НА БЛОКИРОВКУ (теперь принимает cheerio)
    isBlocked(html, $) {
        if (!$) {
            // Простая проверка без парсинга
            return html.includes('captcha') || html.includes('blocked') || html.includes('robot');
        }
        
        const loaded$ = typeof $ === 'function' ? $(html) : $.load(html);
        const hasCaptcha = loaded$('input[name="captcha"]').length > 0 || 
                          html.includes('captcha') || 
                          html.includes('robot') ||
                          html.includes('access denied');
        
        const isBlocked = html.includes('blocked') || 
                         html.includes('too many requests') ||
                         html.includes('rate limit') ||
                         loaded$('.error-page').length > 0;
        
        return hasCaptcha || isBlocked;
    }

    // 🔧 ПРОВЕРКА НА НЕНАЙДЕННОЕ СЛОВО (теперь принимает cheerio)
    isWordNotFound(html, $) {
        if (!$) {
            return html.includes('not found') || html.includes('no entries found');
        }
        
        const loaded$ = typeof $ === 'function' ? $(html) : $.load(html);
        const notFoundMessage = loaded$('.cdo-search__no-results, .empty-page, .no-results');
        const hasNotFound = notFoundMessage.length > 0 || 
                           html.includes('not found') || 
                           html.includes('no entries found');
        
        return hasNotFound;
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

    // 🔧 ПАРСИНГ HTML (теперь принимает cheerio)
    async parseCambridgeHTML(html, word, $) {
        // Загружаем cheerio если не передан
        const cheerio = $ || await this.loadCheerio();
        const loaded$ = typeof cheerio === 'function' ? cheerio(html) : cheerio.load(html);
        
        const result = {
            word: word,
            meanings: [],
            transcription: '',
            audioUrl: '',
            source: 'Cambridge Dictionary'
        };

        console.log(`📖 [Cambridge] Парсинг HTML для: "${word}"`);

        // ✅ ТРАНСКРИПЦИЯ
        const pronunciation = loaded$('.pronunciation .ipa').first().text();
        if (pronunciation) {
            result.transcription = `/${pronunciation}/`;
            console.log(`🔤 [Cambridge] Транскрипция: ${result.transcription}`);
        }

        // ✅ АУДИО ПРОИЗНОШЕНИЕ
        const audioElement = loaded$('.audio_play_button[data-src-mp3]').first();
        if (audioElement.length) {
            const audioPath = audioElement.attr('data-src-mp3');
            result.audioUrl = `https://dictionary.cambridge.org${audioPath}`;
            console.log(`🎵 [Cambridge] Аудио URL: ${result.audioUrl}`);
        }

        // ✅ ОБРАБАТЫВАЕМ КАЖДУЮ ЧАСТЬ РЕЧИ
        loaded$('.pr.entry-body__el').each((entryIndex, entryElement) => {
            const $entry = loaded$(entryElement);
            
            const partOfSpeech = $entry.find('.pos.dpos').first().text().trim();
            console.log(`\n📚 [Cambridge] Часть речи: ${partOfSpeech}`);

            // ✅ ОБРАБАТЫВАЕМ КАЖДОЕ ОПРЕДЕЛЕНИЕ
            $entry.find('.def-block.ddef_block').each((defIndex, defElement) => {
                const $def = loaded$(defElement);
                
                const definition = $def.find('.def.ddef_d.db').text().trim();
                if (!definition) return;
                
                console.log(`   📝 Определение: ${definition.substring(0, 50)}...`);

                // Примеры использования
                const examples = [];
                $def.find('.examp.dexamp').each((exIndex, exElement) => {
                    const example = loaded$(exElement).text().trim();
                    if (example) {
                        examples.push({
                            english: example,
                            russian: ''
                        });
                    }
                });

                console.log(`   📚 Найдено примеров: ${examples.length}`);

                // Создаем объект значения
                const meaning = {
                    id: `cam_${entryIndex}_${defIndex}`,
                    translation: this.getRussianTranslation(definition),
                    englishDefinition: definition,
                    englishWord: word,
                    partOfSpeech: this.translatePOS(partOfSpeech),
                    examples: examples,
                    synonyms: this.extractSynonyms($def, loaded$),
                    source: 'Cambridge Dictionary'
                };

                result.meanings.push(meaning);
            });
        });

        // ✅ ОБРАБАТЫВАЕМ ИДИОМЫ И ВЫРАЖЕНИЯ
        this.parseIdioms(loaded$, result, word);

        console.log(`✅ [Cambridge] Распаршено ${result.meanings.length} значений`);
        return result;
    }

    parseIdioms($, result, word) {
        $('.idiom-block').each((idiomIndex, idiomElement) => {
            const $idiom = $(idiomElement);
            const idiomTitle = $idiom.find('.idiom-title').text().trim();
            
            if (idiomTitle) {
                $idiom.find('.def-block').each((defIndex, defElement) => {
                    const definition = $(defElement).find('.def').text().trim();
                    const examples = [];
                    
                    $(defElement).find('.examp').each((exIndex, exElement) => {
                        examples.push({
                            english: $(exElement).text().trim(),
                            russian: ''
                        });
                    });

                    result.meanings.push({
                        id: `idiom_${idiomIndex}_${defIndex}`,
                        translation: `${idiomTitle} - идиома`,
                        englishDefinition: `${idiomTitle}: ${definition}`,
                        englishWord: word,
                        partOfSpeech: 'idiom',
                        examples: examples,
                        synonyms: [],
                        source: 'Cambridge Dictionary Idioms'
                    });
                });
            }
        });
    }

    extractSynonyms($defBlock, $) {
        const synonyms = [];
        $defBlock.find('.synonyms .item').each((index, element) => {
            const synonym = $(element).text().trim();
            if (synonym) {
                synonyms.push(synonym);
            }
        });
        return synonyms;
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
            'interjection': 'междометие',
            'determiner': 'определитель',
            'modal verb': 'модальный глагол',
            'phrasal verb': 'фразовый глагол',
            'idiom': 'идиома'
        };
        return posMap[cambridgePOS.toLowerCase()] || cambridgePOS;
    }

    getRussianTranslation(definition) {
        const commonTranslations = {
            'a single unit of language': 'единица языка',
            'to express something': 'выражать что-либо',
            'having a lot of': 'имеющий много',
            'in a way that': 'таким образом, что',
            'the ability to': 'способность',
            'a person who': 'человек, который',
            'something that': 'что-то, что',
            'the process of': 'процесс',
            'the state of': 'состояние',
            'to make something': 'сделать что-то',
            'to become something': 'стать чем-то',
            'to give something': 'дать что-то',
            'to take something': 'взять что-то',
            'to have something': 'иметь что-то',
            'to be something': 'быть чем-то'
        };
        
        for (const [en, ru] of Object.entries(commonTranslations)) {
            if (definition.toLowerCase().includes(en)) {
                return ru;
            }
        }
        
        return 'основное значение';
    }

    resetCounters() {
        this.requestCount = 0;
        this.lastRequestTime = 0;
        console.log('🔄 [Cambridge] Счетчики запросов сброшены');
    }

    getStats() {
        return {
            totalRequests: this.requestCount,
            lastRequestTime: this.lastRequestTime,
            timeSinceLastRequest: Date.now() - this.lastRequestTime
        };
    }
}

export { CambridgeDictionaryService };
