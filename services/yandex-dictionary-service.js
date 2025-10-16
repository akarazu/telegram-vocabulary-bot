import axios from 'axios';

export class YandexDictionaryService {
  constructor() {
    this.useYandex = !!process.env.YANDEX_DICTIONARY_API_KEY;
  }

  async getWordWithAutoExamples(word) {
    console.log(`🔍 [YandexService] Getting word data with examples for: "${word}"`);

    // Базовый результат на случай всех фэйлов
    const baseResult = this.getBasicFallback(word);

    // 1) Пробуем Яндекс
    let yandexData = null;
    if (this.useYandex) {
      try {
        yandexData = await this.getYandexWithExamples(word);
        if (yandexData.meanings.length > 0) {
          console.log(`✅ [YandexService] Yandex found ${yandexData.meanings.length} meanings`);
        } else {
          console.log('ℹ️ [YandexService] Yandex returned no meanings');
        }
      } catch (error) {
        console.log('❌ [YandexService] Yandex failed:', error.message);
      }
    }

    // 2) Если у Яндекса нет значений — фоллбек на FreeDictionary
    if (!yandexData || yandexData.meanings.length === 0) {
      try {
        const freeDictData = await this.getFreeDictionaryWithExamples(word);
        if (freeDictData.meanings.length > 0) {
          console.log(`✅ [YandexService] FreeDictionary found ${freeDictData.meanings.length} meanings`);
          return freeDictData;
        }
      } catch (error) {
        console.log('❌ [YandexService] FreeDictionary failed:', error.message);
      }
      return baseResult;
    }

    // 3) Если у Яндекса значения есть, но мало/нет примеров — дольём примеры из FreeDictionary по части речи
    const yandexHasAnyExamples = yandexData.meanings.some(m => (m.examples?.length ?? 0) > 0);
    if (!yandexHasAnyExamples) {
      try {
        const freeDictData = await this.getFreeDictionaryWithExamples(word);
        if (freeDictData.meanings.length > 0) {
          this.mergeExamplesByPOS(yandexData, freeDictData, { perMeaningLimit: 3 });
          const mergedHasExamples = yandexData.meanings.some(m => (m.examples?.length ?? 0) > 0);
          console.log(
            mergedHasExamples
              ? '✨ [YandexService] Enriched Yandex meanings with FreeDictionary examples'
              : 'ℹ️ [YandexService] No examples to enrich from FreeDictionary'
          );
        }
      } catch (error) {
        console.log('❌ [YandexService] Enrichment (FreeDictionary) failed:', error.message);
      }
    }

    return yandexData ?? baseResult;
  }

  // --------------------------- YANDEX ---------------------------

  async getYandexWithExamples(word) {
    try {
      console.log(`🔍 [YandexService] Making Yandex API request for: "${word}"`);

      const response = await axios.get('https://dictionary.yandex.net/api/v1/dicservice.json/lookup', {
        params: {
          key: process.env.YANDEX_DICTIONARY_API_KEY,
          lang: 'en-ru',
          text: word,
          ui: 'ru',
          flags: 4, // MORPHO
        },
        timeout: 10000,
      });

      console.log('📊 [YandexService] Yandex API response status:', response.status);
      // Раскомментируй при необходимости полного дампа:
      // console.log('📋 [YandexService] Yandex raw response:');
      // console.log(JSON.stringify(response.data, null, 2));

      // Краткая сводка по примерам
      const data = response.data;
      const counts = (data.def ?? []).map((d, i) => ({
        def: i,
        pos: d.pos,
        tr: (d.tr ?? []).length,
        exByTr: (d.tr ?? []).reduce((n, t) => n + (t.ex?.length ?? 0), 0),
      }));
      console.log('🧭 [YandexService] examples summary per def:', counts);

      return this.processYandexResponseWithExamples(data, word);
    } catch (error) {
      console.error('❌ [YandexService] Yandex API error:', {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
      });
      throw new Error(`Yandex: ${error.message}`);
    }
  }

  processYandexResponseWithExamples(data, word) {
    const result = {
      word: word,
      transcription: '',
      audioUrl: `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(word)}&tl=en-gb&client=tw-ob`,
      meanings: [],
      translations: [],
    };

    if (!data.def || data.def.length === 0) {
      console.log('❌ [YandexService] No definitions found in Yandex response');
      return result;
    }

    console.log(`🔍 [YandexService] Yandex found ${data.def.length} definition(s)`);

    data.def.forEach((definition, defIndex) => {
      const mainPOS = definition.pos || 'unknown';
      console.log(`📖 [YandexService] Definition ${defIndex + 1}: POS=${mainPOS}, text="${definition.text}"`);

      if (definition.tr && Array.isArray(definition.tr)) {
        console.log(`   🔸 [YandexService] Found ${definition.tr.length} translation(s)`);

        definition.tr.forEach((translation, transIndex) => {
          if (!translation?.text) return;

          const russianTranslation = translation.text.trim();
          const translationPOS = translation.pos || mainPOS;

          console.log(`   🔸 [YandexService] Translation ${transIndex + 1}: "${russianTranslation}" (${translationPOS})`);

          // ✅ Извлекаем примеры (если они есть)
          const examples = this.extractExamplesFromYandex(translation);
          console.log(`   📝 [YandexService] Found ${examples.length} examples for this translation`);

          const meaningNuances = this.extractMeaningNuances(translation);
          const synonyms = translation.syn ? translation.syn.map(s => s.text) : [];

          console.log(`   🎯 [YandexService] Meaning nuances: ${meaningNuances.length}, Synonyms: ${synonyms.length}`);

          const detailedMeaning = {
            partOfSpeech: translationPOS,
            translation: russianTranslation,
            definition: this.buildDefinition(translation, meaningNuances),
            examples: examples,
            meaningNuances: meaningNuances,
            synonyms: synonyms,
            source: 'Yandex',
          };

          result.meanings.push(detailedMeaning);

          // В список «переводов» добавляем только кириллицу, чтобы не тянуть пометы в латинице
          if (this.isRussianText(russianTranslation) && !result.translations.includes(russianTranslation)) {
            result.translations.push(russianTranslation);
          }
        });
      } else {
        console.log(`   ❌ [YandexService] No translations found for definition ${defIndex + 1}`);
      }
    });

    // ✅ Транскрипция (если есть)
    if (data.def[0].ts) {
      result.transcription = `/${data.def[0].ts}/`;
      console.log(`🔤 [YandexService] Transcription found: ${result.transcription}`);
    }

    const exCount = result.meanings.reduce((acc, m) => acc + (m.examples?.length ?? 0), 0);
    console.log(`🎯 [YandexService] Final result: ${result.meanings.length} meanings with ${exCount} examples`);
    return result;
  }

  extractExamplesFromYandex(translation) {
    const seen = new Set();
    const out = [];

    const pushEx = (en, ru) => {
      if (!en) return;
      const key = `${en}|||${ru || ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ english: en, russian: ru || '', full: ru ? `${en} - ${ru}` : en });
    };

    // Обычные примеры у текущего перевода
    if (Array.isArray(translation.ex)) {
      for (const ex of translation.ex) {
        const en = ex?.text;
        const ru = Array.isArray(ex?.tr) && ex.tr[0]?.text ? ex.tr[0].text : '';
        pushEx(en, ru);
      }
    }

    // (Опционально) Примеры, встречающиеся у синонимов данного перевода
    if (Array.isArray(translation.syn)) {
      for (const s of translation.syn) {
        if (Array.isArray(s.ex)) {
          for (const ex of s.ex) {
            const en = ex?.text;
            const ru = Array.isArray(ex?.tr) && ex.tr[0]?.text ? ex.tr[0].text : '';
            pushEx(en, ru);
          }
        }
      }
    }
    return out;
  }

  extractMeaningNuances(translation) {
    const nuances = [];
    if (translation.mean && Array.isArray(translation.mean)) {
      translation.mean.forEach(meanObj => {
        if (meanObj.text) nuances.push(meanObj.text);
      });
    }
    return nuances;
  }

  buildDefinition(translation, meaningNuances) {
    let definition = translation.text;
    if (meaningNuances.length > 0) {
      definition += ` (${meaningNuances.join(', ')})`;
    }
    return definition;
  }

  // --------------------------- FREE DICTIONARY ---------------------------

  async getFreeDictionaryWithExamples(word) {
    try {
      console.log(`🔍 [YandexService] Trying FreeDictionary API for: "${word}"`);

      const response = await axios.get(
        `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
        { timeout: 7000 }
      );

      return this.processFreeDictionaryResponse(response.data, word);
    } catch (error) {
      throw new Error(`FreeDictionary: ${error.message}`);
    }
  }

  processFreeDictionaryResponse(data, word) {
    const result = {
      word: word,
      transcription: '',
      audioUrl: `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(word)}&tl=en-gb&client=tw-ob`,
      meanings: [],
      translations: [],
    };

    if (!Array.isArray(data) || data.length === 0) {
      return result;
    }

    const entry = data[0];

    if (entry.phonetic) {
      result.transcription = `/${entry.phonetic}/`;
    }

    (entry.meanings ?? []).forEach(meaning => {
      const pos = meaning.partOfSpeech;
      (meaning.definitions ?? []).forEach(definition => {
        const translation = this.autoTranslateDefinition(definition.definition, word);
        const examples = [];

        if (definition.example) {
          examples.push({
            english: definition.example,
            russian: this.autoTranslateExample(definition.example),
            full: definition.example,
          });
        }

        const detailedMeaning = {
          partOfSpeech: pos,
          translation: translation,
          definition: definition.definition,
          examples: examples,
          meaningNuances: [],
          synonyms: [],
          source: 'FreeDictionary',
        };

        result.meanings.push(detailedMeaning);

        if (!result.translations.includes(translation)) {
          result.translations.push(translation);
        }
      });
    });

    console.log(`✅ [YandexService] FreeDictionary: ${result.meanings.length} meanings`);
    return result;
  }

  // --------------------------- ENRICHMENT ---------------------------

  mergeExamplesByPOS(yandexData, freeDictData, { perMeaningLimit = 3 } = {}) {
    const byPos = this.groupBy(
      freeDictData.meanings,
      m => this.normalizePOS(m.partOfSpeech)
    );

    for (const m of yandexData.meanings) {
      const pos = this.normalizePOS(m.partOfSpeech);
      const donorMeanings = byPos[pos] || [];
      if (!donorMeanings.length) continue;

      const donorExamples = donorMeanings.flatMap(dm => dm.examples ?? []);
      if (!donorExamples.length) continue;

      const existing = new Set((m.examples ?? []).map(e => `${e.english}|||${e.russian}`));
      const toAdd = [];

      for (const ex of donorExamples) {
        const key = `${ex.english}|||${ex.russian}`;
        if (existing.has(key)) continue;
        toAdd.push(ex);
        if (toAdd.length >= perMeaningLimit) break;
      }

      if (toAdd.length) {
        m.examples = [...(m.examples ?? []), ...toAdd];
      }
    }
  }

  normalizePOS(pos) {
    if (!pos) return 'unknown';
    const p = String(pos).toLowerCase();
    if (p.startsWith('noun')) return 'noun';
    if (p.startsWith('verb')) return 'verb';
    if (p.startsWith('adj')) return 'adjective';
    if (p.startsWith('adv')) return 'adverb';
    return p;
  }

  groupBy(arr, keyFn) {
    const map = Object.create(null);
    for (const item of arr || []) {
      const k = keyFn(item);
      if (!map[k]) map[k] = [];
      map[k].push(item);
    }
    return map;
  }

  // --------------------------- HELPERS ---------------------------

  autoTranslateDefinition(definition, word) {
    const simpleDef = definition
      .toLowerCase()
      .replace(new RegExp(word, 'gi'), '')
      .split('.')[0]
      .trim()
      .substring(0, 50);

    return simpleDef || `значение "${word}"`;
  }

  autoTranslateExample(example) {
    return `перевод: ${example.substring(0, 30)}...`;
  }

  getBasicFallback(word) {
    console.log(`⚠️ [YandexService] Using basic fallback for: "${word}"`);

    return {
      word: word,
      transcription: `/${word}/`,
      audioUrl: `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(word)}&tl=en-gb&client=tw-ob`,
      meanings: [
        {
          partOfSpeech: 'noun',
          translation: `перевод "${word}"`,
          definition: `Basic definition of ${word}`,
          examples: [],
          meaningNuances: [],
          synonyms: [],
          source: 'fallback',
        },
      ],
      translations: [`перевод "${word}"`],
    };
  }

  isRussianText(text) {
    return /[а-яА-Я]/.test(text);
  }
}
