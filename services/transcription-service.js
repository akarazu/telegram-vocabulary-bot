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

        // ✅ СНАЧАЛА пробуем Яндекс (если доступен)
        if (this.useYandex) {
            try {
                console.log('🔍 PRIMARY: Trying Yandex Dictionary...');
                const yandexResult = await this.getYandexTranslations(word);
                if (yandexResult.translations && yandexResult.translations.length > 0) {
                    console.log('✅ PRIMARY: Using Yandex translations');
                    result.translations = yandexResult.translations;
                }
            } catch (error) {
                console.log('❌ PRIMARY: Yandex failed:', error.message);
            }
        }

        // ✅ ПОТОМ пробуем бэкап для транскрипции и аудио
        try {
            console.log('🔄 BACKUP: Trying Backup Dictionary for transcription...');
            const backupResult = await this.backupService.getTranscription(word);
            result.transcription = backupResult.transcription || '';
            result.audioUrl = backupResult.audioUrl || '';
        } catch (error) {
            console.log('❌ BACKUP: Backup failed:', error.message);
        }

        // ✅ Если Яндекс недоступен, сразу используем бэкап для переводов
        if (!this.useYandex || result.translations.length === 0) {
            try {
                console.log('🔍 PRIMARY (no Yandex): Trying Backup Dictionary for translations...');
                const backupTranslations = await this.getBackupTranslations(word);
                if (backupTranslations.length > 0) {
                    result.translations = backupTranslations;
                }
            } catch (error) {
                console.log('❌ PRIMARY: Backup failed:', error.message);
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
            return { translations: [] };
        }

        console.log('🔍 Yandex API response structure:', JSON.stringify(data.def[0], null, 2));

        data.def.forEach(definition => {
            if (definition.tr && definition.tr.length > 0) {
                definition.tr.forEach(translation => {
                    // ✅ ИЗВЛЕКАЕМ РУССКИЕ ПЕРЕВОДЫ, А НЕ АНГЛИЙСКИЕ СЛОВА
                    if (translation.text && translation.text.trim()) {
                        const russianTranslation = translation.text.trim();
                        
                        // Проверяем что это действительно русский перевод, а не английское слово
                        if (this.isRussianText(russianTranslation) && 
                            russianTranslation.toLowerCase() !== originalWord.toLowerCase()) {
                            translations.add(russianTranslation);
                        }
                    }
                });
            }
        });

        const translationArray = Array.from(translations).slice(0, 4);
        console.log(`✅ Yandex translations found: ${translationArray.join(', ')}`);
        
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
                `https://api.dictionaryapi.dev/api/v2/entries/en/${word}`,
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
            return [];
        }

        data.forEach(entry => {
            if (entry.meanings && Array.isArray(entry.meanings)) {
                entry.meanings.forEach(meaning => {
                    // Используем partOfSpeech как перевод
                    if (meaning.partOfSpeech) {
                        translations.add(meaning.partOfSpeech);
                    }
                    
                    if (meaning.definitions && Array.isArray(meaning.definitions)) {
                        meaning.definitions.forEach(definition => {
                            if (definition.definition && definition.definition.trim()) {
                                const shortDef = definition.definition
                                    .split(' ')
                                    .slice(0, 4)
                                    .join(' ');
                                if (shortDef.length < 50) {
                                    translations.add(shortDef);
                                }
                            }
                        });
                    }
                    
                    if (meaning.synonyms && Array.isArray(meaning.synonyms)) {
                        meaning.synonyms.forEach(synonym => {
                            if (synonym && synonym.trim()) {
                                translations.add(synonym.trim());
                            }
                        });
                    }
                });
            }
        });

        const translationArray = Array.from(translations).slice(0, 4);
        console.log(`✅ FreeDictionary translations found: ${translationArray.join(', ')}`);
        
        return translationArray;
    }
}
