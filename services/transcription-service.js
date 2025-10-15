import { YandexDictionaryService } from './yandex-dictionary-service.js';
import { BackupDictionaryService } from './backup-dictionary-service.js';
import axios from 'axios';

export class TranscriptionService {
    constructor() {
        this.yandexService = new YandexDictionaryService();
        this.backupService = new BackupDictionaryService();
        this.useYandex = !!process.env.YANDEX_DICTIONARY_API_KEY;
        
        if (this.useYandex) {
            console.log('🎯 Using Yandex Dictionary API as primary');
        } else {
            console.log('🎯 Yandex API key not found, using Backup Dictionary as primary');
        }
    }

    async getUKTranscription(word) {
        console.log(`🔍 Searching transcription for: "${word}"`);
        
        let result = { 
            transcription: '', 
            audioUrl: '', 
            translations: [],
            examples: []
        };

        // ✅ ВСЕГДА сначала пробуем Яндекс для переводов (если доступен) - ДЛЯ ЛЮБЫХ СЛОВ И СЛОВОСОЧЕТАНИЙ
        if (this.useYandex) {
            try {
                console.log('🔍 PRIMARY: Trying Yandex Dictionary for translations...');
                const yandexResult = await this.getYandexTranslations(word);
                if (yandexResult.translations && yandexResult.translations.length > 0) {
                    console.log('✅ PRIMARY: Using Yandex translations');
                    result.translations = yandexResult.translations;
                }
            } catch (error) {
                console.log('❌ PRIMARY: Yandex failed:', error.message);
            }
        }

        // ✅ ПОТОМ пробуем бэкап для транскрипции и аудио - ДЛЯ ЛЮБЫХ СЛОВ И СЛОВОСОЧЕТАНИЙ
        try {
            console.log('🔄 BACKUP: Trying Backup Dictionary for transcription...');
            const backupResult = await this.backupService.getTranscription(word);
            result.transcription = backupResult.transcription || '';
            result.audioUrl = backupResult.audioUrl || '';
        } catch (error) {
            console.log('❌ BACKUP: Backup failed:', error.message);
        }

        // ✅ ЕСЛИ Яндекс недоступен или не нашел переводы, используем бэкап для переводов
        if (!this.useYandex || result.translations.length === 0) {
            try {
                console.log('🔍 FALLBACK: Trying Backup Dictionary for translations...');
                const backupTranslations = await this.getBackupTranslations(word);
                if (backupTranslations.length > 0) {
                    result.translations = backupTranslations;
                    console.log('✅ FALLBACK: Using Backup translations');
                }
            } catch (error) {
                console.log('❌ FALLBACK: Backup translations failed:', error.message);
            }
        }

        console.log(`📊 Final results for "${word}":`, {
            transcription: result.transcription || '❌ Not found',
            audioUrl: result.audioUrl ? '✅ Found' : '❌ Not found',
            translations: result.translations.length
        });

        return result;
    }

    async getYandexTranslations(word) {
        try {
            const response = await axios.get('https://dictionary.yandex.net/api/v1/dicservice.json/lookup', {
                params: {
                    key: process.env.YANDEX_DICTIONARY_API_KEY,
                    lang: 'en-ru',
                    text: word,
                    ui: 'ru'
                },
                timeout: 5000
            });

            return this.extractTranslationsFromYandex(response.data, word);
            
        } catch (error) {
            console.error('Yandex translation error:', error.message);
            return { translations: [] };
        }
    }

    extractTranslationsFromYandex(data, originalWord) {
        const translations = new Set();
        
        if (!data.def || data.def.length === 0) {
            console.log('❌ Yandex: No definitions found');
            return { translations: [] };
        }

        console.log(`🔍 Yandex found ${data.def.length} definition(s)`);

        data.def.forEach(definition => {
            if (definition.tr && definition.tr.length > 0) {
                console.log(`🔍 Processing ${definition.tr.length} translation(s) from Yandex`);
                
                definition.tr.forEach(translation => {
                    // ✅ ИЗВЛЕКАЕМ ТОЛЬКО ОСНОВНЫЕ РУССКИЕ ПЕРЕВОДЫ (БЕЗ СИНОНИМОВ)
                    if (translation.text && translation.text.trim()) {
                        const russianTranslation = translation.text.trim();
                        
                        // Проверяем что это действительно русский перевод
                        if (this.isRussianText(russianTranslation) && 
                            russianTranslation.toLowerCase() !== originalWord.toLowerCase()) {
                            translations.add(russianTranslation);
                            console.log(`✅ Yandex translation: "${russianTranslation}"`);
                        }
                    }
                });
            }
        });

        const translationArray = Array.from(translations).slice(0, 4);
        console.log(`✅ Yandex translations found: ${translationArray.length} - ${translationArray.join(', ')}`);
        
        return { translations: translationArray };
    }

    // ✅ Функция для проверки русского текста
    isRussianText(text) {
        // Проверяем содержит ли текст кириллические символы
        return /[а-яА-Я]/.test(text);
    }

    async getBackupTranslations(word) {
        try {
            const response = await axios.get(
                `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
                { timeout: 5000 }
            );

            return this.extractTranslationsFromFreeDictionary(response.data, word);
        } catch (error) {
            console.error('Free Dictionary API error:', error.message);
            return [];
        }
    }

    extractTranslationsFromFreeDictionary(data, originalWord) {
        const translations = new Set();
        
        if (!Array.isArray(data) || data.length === 0) {
            console.log('❌ FreeDictionary: No entries found');
            return [];
        }

        console.log(`🔍 FreeDictionary found ${data.length} entry/entries`);

        data.forEach(entry => {
            if (entry.meanings && Array.isArray(entry.meanings)) {
                entry.meanings.forEach(meaning => {
                    // Извлекаем только основные определения (БЕЗ СИНОНИМОВ)
                    if (meaning.definitions && Array.isArray(meaning.definitions)) {
                        meaning.definitions.forEach(definition => {
                            if (definition.definition && definition.definition.trim()) {
                                const shortDef = definition.definition
                                    .split(/[.,;!?]/)[0] // Берем только первое предложение
                                    .trim();
                                if (shortDef.length > 0 && shortDef.length < 80) {
                                    translations.add(shortDef);
                                }
                            }
                        });
                    }
                });
            }
        });

        const translationArray = Array.from(translations).slice(0, 4);
        console.log(`✅ FreeDictionary translations found: ${translationArray.length} - ${translationArray.join(', ')}`);
        
        return translationArray;
    }
}
