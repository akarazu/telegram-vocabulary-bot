// services/cambridge-dictionary-service.js
import axios from 'axios';
import * as cheerio from 'cheerio';

export class CambridgeDictionaryService {
  constructor() {
    this.baseUrl = 'https://dictionary.cambridge.org/dictionary/english-russian';
    
    // Оптимизация: кеширование результатов
    this.cache = new Map();
    this.CACHE_TTL = 60 * 60 * 1000; // 1 час для словарных данных
    
    // Оптимизация: ограничение параллельных запросов
    this.concurrentRequests = 0;
    this.maxConcurrentRequests = 2; // Уменьшено для экономии
    
    // Оптимизация: настройки HTTP клиента
    this.http = axios.create({
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept':
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,ru;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache',
        'DNT': '1'
      },
      timeout: 10000, // Уменьшено с 15 до 10 секунд
      withCredentials: true,
      maxRedirects: 3, // Уменьшено с 5
      validateStatus: s => s >= 200 && s < 400,
      // Оптимизация: повторные попытки
      retry: 1,
      retryDelay: 1000
    });

    // Оптимизация: черный список проблемных слов
    this.problemWords = new Set();
    
    // Оптимизация: запуск очистки кеша
    this.startCacheCleanup();
    
    console.log('🔧 CambridgeDictionaryService initialized with optimizations');
  }

  // Оптимизация: кеширование с TTL
  async getCachedWordData(word) {
    const cacheKey = `cam_${word.toLowerCase().trim()}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      console.log(`📚 [Cambridge] Cache HIT for: "${word}"`);
      return cached.data;
    }
    
    // Проверяем черный список
    if (this.problemWords.has(word.toLowerCase())) {
      console.log(`🚫 [Cambridge] Skipping blacklisted word: "${word}"`);
      return { word, meanings: [], audio: null };
    }
    
    console.log(`🔍 [Cambridge] Cache MISS for: "${word}"`);
    const data = await this.fetchWordData(word);
    
    // Кешируем даже пустые результаты
    this.cache.set(cacheKey, {
      data: data,
      timestamp: Date.now()
    });
    
    // Ограничиваем размер кеша
    if (this.cache.size > 500) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    
    return data;
  }

  // Основной метод с кешированием
  async getWordData(word) {
    return this.getCachedWordData(word);
  }

  // Оптимизация: управление параллельными запросами
  async fetchWordData(word) {
    // Проверяем лимит параллельных запросов
    if (this.concurrentRequests >= this.maxConcurrentRequests) {
      console.log(`⏳ [Cambridge] Rate limit reached, skipping: "${word}"`);
      return { word, meanings: [], audio: null };
    }

    this.concurrentRequests++;
    
    try {
      const url = `${this.baseUrl}/${encodeURIComponent(word.trim().toLowerCase())}`;
      console.log(`🌐 [Cambridge] Fetching: "${word}"`);
      
      const response = await Promise.race([
        this.http.get(url),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Cambridge API timeout')), 10000)
        )
      ]);

      console.log(`✅ [Cambridge] Success: "${word}" - Status: ${response.status}`);
      return this._parse(response.data, word);
      
    } catch (error) {
      console.error(`❌ [Cambridge] ERROR for "${word}":`, error.message);
      
      // Добавляем проблемные слова в черный список
      if (error.message.includes('timeout') || error.message.includes('ENOTFOUND')) {
        this.problemWords.add(word.toLowerCase());
        console.log(`🚫 [Cambridge] Added to blacklist: "${word}"`);
      }
      
      return { word, meanings: [], audio: null };
    } finally {
      this.concurrentRequests--;
    }
  }

  // Оптимизированный парсинг
  _parse(html, word) {
    try {
      const $ = cheerio.load(html);
      const meanings = [];
      const seen = new Set();

      // Быстрая проверка на 404 или отсутствие результатов
      const noResults = $('.empty-page, .dictionary-nodata, .cdo-search__no-results').length > 0;
      if (noResults) {
        console.log(`❌ [Cambridge] No results found for: "${word}"`);
        this.problemWords.add(word.toLowerCase());
        return { word, meanings: [], audio: null };
      }

      // Оптимизация: ограничиваем количество обрабатываемых элементов
      $('.entry-body__el').slice(0, 5).each((_, entry) => {
        const $entry = $(entry);

        const partOfSpeech =
          $entry.find('.posgram .pos, .pos.dpos').first().text().trim() || 'unknown';
        
        const level =
          $entry.find('.epp-xref, .def-block .epp-xref').first().text().trim() || '';

        // Оптимизация: ограничиваем количество def-block
        $entry.find('.def-block.ddef_block').slice(0, 3).each((__, defBlock) => {
          const $block = $(defBlock);
          const englishDefinition = $block.find('.def.ddef_d').first().text().trim();

          const blockTranslations = $block
            .find('.trans.dtrans, span.trans.dtrans.dtrans-se')
            .map((___, el) => $(el).text().trim())
            .get()
            .filter(Boolean)
            .slice(0, 5); // Ограничиваем количество переводов

          // Оптимизация: ограничиваем количество примеров
          const examples = $block
            .find('.examp .eg')
            .slice(0, 2)
            .map((___, ex) => ({ 
              english: $(ex).text().trim(), 
              russian: '' 
            }))
            .get();

          if (blockTranslations.length === 0 && !englishDefinition) return;

          if (blockTranslations.length) {
            blockTranslations.forEach(tr => {
              const translation = tr.trim();
              const key = `${translation}||${englishDefinition}`;
              if (translation && !seen.has(key)) {
                meanings.push({
                  id: `cam_${Date.now()}_${meanings.length}`,
                  translation,
                  englishDefinition: englishDefinition || `Definition for ${word}`,
                  englishWord: word,
                  partOfSpeech,
                  examples,
                  synonyms: [],
                  level,
                  source: 'Cambridge Dictionary'
                });
                seen.add(key);
              }
            });
          } else if (englishDefinition) {
            const key = `__no_ru__||${englishDefinition}`;
            if (!seen.has(key)) {
              meanings.push({
                id: `cam_${Date.now()}_${meanings.length}`,
                translation: '',
                englishDefinition,
                englishWord: word,
                partOfSpeech,
                examples,
                synonyms: [],
                level,
                source: 'Cambridge Dictionary'
              });
              seen.add(key);
            }
          }
        });
      });

      // Британское аудио
      let ukAudio = $('.uk.dpron-i .audio_play_button[data-src-mp3]').attr('data-src-mp3')
        || $('.dpron-i .audio_play_button[data-src-mp3]').first().attr('data-src-mp3')
        || null;

      // Cambridge иногда отдаёт относительный путь — нормализуем
      if (ukAudio) {
        if (ukAudio.startsWith('//')) ukAudio = `https:${ukAudio}`;
        if (ukAudio.startsWith('/')) ukAudio = `https://dictionary.cambridge.org${ukAudio}`;
      }

      console.log(`📊 [Cambridge] Parsed "${word}": ${meanings.length} meanings, audio: ${ukAudio ? 'YES' : 'NO'}`);
      
      return { word, meanings, audio: ukAudio };
      
    } catch (parseError) {
      console.error(`❌ [Cambridge] Parse ERROR for "${word}":`, parseError.message);
      return { word, meanings: [], audio: null };
    }
  }

  // Оптимизация: массовый запрос слов (для будущего использования)
  async getMultipleWordsData(words) {
    const results = {};
    const BATCH_SIZE = 3; // Маленькие батчи для экономии
    const DELAY_BETWEEN_BATCHES = 2000; // Задержка между батчами
    
    console.log(`🔄 [Cambridge] Batch processing ${words.length} words`);
    
    for (let i = 0; i < words.length; i += BATCH_SIZE) {
      const batch = words.slice(i, i + BATCH_SIZE);
      console.log(`📦 [Cambridge] Processing batch ${Math.floor(i/BATCH_SIZE) + 1}`);
      
      const batchPromises = batch.map(word => 
        this.getWordData(word).then(data => {
          results[word] = data;
          return data;
        })
      );
      
      await Promise.allSettled(batchPromises);
      
      // Задержка между батчами
      if (i + BATCH_SIZE < words.length) {
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
      }
    }
    
    console.log(`✅ [Cambridge] Batch processing completed: ${Object.keys(results).length} words`);
    return results;
  }

  // Оптимизация: предзагрузка популярных слов
  async preloadCommonWords(commonWords = []) {
    if (commonWords.length === 0) return;
    
    console.log(`🔮 [Cambridge] Preloading ${commonWords.length} common words`);
    
    const preloadResults = {};
    for (const word of commonWords.slice(0, 10)) { // Ограничиваем предзагрузку
      try {
        const data = await this.getWordData(word);
        preloadResults[word] = data;
        console.log(`✅ [Cambridge] Preloaded: "${word}"`);
      } catch (error) {
        console.error(`❌ [Cambridge] Preload failed for "${word}":`, error.message);
      }
      
      // Задержка между предзагрузками
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    return preloadResults;
  }

  // Оптимизация: очистка кеша
  startCacheCleanup() {
    setInterval(() => {
      const now = Date.now();
      let cleanedCount = 0;
      
      for (const [key, value] of this.cache.entries()) {
        if (now - value.timestamp > this.CACHE_TTL) {
          this.cache.delete(key);
          cleanedCount++;
        }
      }
      
      if (cleanedCount > 0) {
        console.log(`🧹 [Cambridge] Cache cleanup: removed ${cleanedCount} expired entries`);
      }
      
      // Очищаем старые записи из черного списка (раз в день)
      if (Math.random() < 0.01) { // 1% chance каждый запуск
        const oldSize = this.problemWords.size;
        // Можно добавить логику для очистки старых проблемных слов
        console.log(`📋 [Cambridge] Blacklist size: ${this.problemWords.size}`);
      }
      
    }, 10 * 60 * 1000); // Каждые 10 минут
  }

  // Методы для отладки и мониторинга
  getCacheStats() {
    return {
      cacheSize: this.cache.size,
      blacklistSize: this.problemWords.size,
      concurrentRequests: this.concurrentRequests
    };
  }

  clearCache() {
    const previousSize = this.cache.size;
    this.cache.clear();
    console.log(`🗑️ [Cambridge] Cache cleared: ${previousSize} entries removed`);
    return previousSize;
  }

  removeFromBlacklist(word) {
    const removed = this.problemWords.delete(word.toLowerCase());
    if (removed) {
      console.log(`✅ [Cambridge] Removed from blacklist: "${word}"`);
    }
    return removed;
  }

  // Оптимизация: проверка доступности сервиса
  async healthCheck() {
    try {
      const testWord = 'hello'; // Простое слово для проверки
      const response = await this.http.get(`${this.baseUrl}/${testWord}`, {
        timeout: 5000
      });
      
      return {
        status: 'healthy',
        responseTime: response.duration,
        statusCode: response.status
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message
      };
    }
  }

  // Оптимизация: graceful shutdown
  async shutdown() {
    console.log('🔄 [Cambridge] Shutting down service...');
    // Сохраняем кеш (если нужно)
    this.cache.clear();
    this.problemWords.clear();
    console.log('✅ [Cambridge] Service shutdown completed');
  }
}

// Создаем глобальный экземпляр для повторного использования
let cambridgeServiceInstance = null;

export function getCambridgeService() {
  if (!cambridgeServiceInstance) {
    cambridgeServiceInstance = new CambridgeDictionaryService();
    
    // Предзагружаем самые частые слова при инициализации
    const commonWords = [
      'hello', 'world', 'time', 'people', 'water', 'food', 'house', 
      'work', 'school', 'book', 'friend', 'family', 'music', 'love'
    ];
    
    // Запускаем предзагрузку в фоне (не блокируем инициализацию)
    setTimeout(() => {
      cambridgeServiceInstance.preloadCommonWords(commonWords)
        .catch(error => console.error('❌ Preload failed:', error));
    }, 5000);
  }
  
  return cambridgeServiceInstance;
}

// Graceful shutdown при завершении процесса
process.on('SIGINT', async () => {
  if (cambridgeServiceInstance) {
    await cambridgeServiceInstance.shutdown();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  if (cambridgeServiceInstance) {
    await cambridgeServiceInstance.shutdown();
  }
  process.exit(0);
});
