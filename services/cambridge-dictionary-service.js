// services/cambridge-dictionary-service.js
import axios from 'axios';
import * as cheerio from 'cheerio';

export class CambridgeDictionaryService {
  constructor() {
    this.baseUrl = 'https://dictionary.cambridge.org/dictionary/english-russian';
    this.http = axios.create({
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept':
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,ru;q=0.7',
        'Connection': 'keep-alive'
      },
      timeout: 15000,
      withCredentials: true,
      maxRedirects: 5,
      validateStatus: s => s >= 200 && s < 400
    });
  }

  async getWordData(word) {
    try {
      const url = `${this.baseUrl}/${encodeURIComponent(word.trim().toLowerCase())}`;
      const { data: html } = await this.http.get(url);
      return this._parse(html, word);
    } catch (e) {
      console.error('❌ [Cambridge] fetch error:', e?.message || e);
      return { word, meanings: [], audio: null };
    }
  }

  _parse(html, word) {
    const $ = cheerio.load(html);
    const meanings = [];
    const seen = new Set();

    $('.entry-body__el').each((_, entry) => {
      const $entry = $(entry);

      const partOfSpeech =
        $entry.find('.posgram .pos, .pos.dpos').first().text().trim() || 'unknown';
      const level =
        $entry.find('.epp-xref, .def-block .epp-xref').first().text().trim() || '';

      $entry.find('.def-block.ddef_block').each((__, defBlock) => {
        const $block = $(defBlock);
        const englishDefinition = $block.find('.def.ddef_d').first().text().trim();

        const blockTranslations = $block
          .find('.trans.dtrans, span.trans.dtrans.dtrans-se')
          .map((___, el) => $(el).text().trim())
          .get()
          .filter(Boolean);

        const examples = $block
          .find('.examp .eg')
          .map((___, ex) => ({ english: $(ex).text().trim(), russian: '' }))
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
    if (ukAudio && ukAudio.startsWith('//')) ukAudio = `https:${ukAudio}`;
    if (ukAudio && ukAudio.startsWith('/')) ukAudio = `https://dictionary.cambridge.org${ukAudio}`;

    return { word, meanings, audio: ukAudio };
  }
}
