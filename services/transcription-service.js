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
        
        let result = { transcription: '', audioUrl: '', translations: [] };

        // ✅ СНАЧАЛА пробуем Яндекс (если доступен)
        if (this.useYandex) {
            try {
                console.log('🔍 PRIMARY: Trying Yandex Dictionary...');
                const yandexResult = await this.yandexService.getTranscription(word);
                if (yandexResult.transcription || yandexResult.audioUrl) {
                    console.log('✅ PRIMARY: Using Yandex result');
                    result.transcription = yandexResult.transcription;
                    result.audioUrl = yandexResult.audioUrl;
                } else {
                    console.log('❌ PRIMARY: Yandex found nothing');
                }
            } catch (error) {
                console.log('❌ PRIMARY: Yandex failed:', error.message);
            }
        }

        // ✅ ПОТОМ пробуем бэкап (если Яндекс не нашел или недоступен)
        if (!result.transcription || !result.audioUrl) {
            try {
                console.log('🔄 BACKUP: Trying Backup Dictionary...');
                const backupResult = await this.backupService.getTranscription(word);
                if (backupResult.transcription || backupResult.audioUrl) {
                    console.log('✅ BACKUP: Using Backup result');
                    if (!result.transcription) result.transcription = backupResult.transcription;
                    if (!result.audioUrl) result.audioUrl = backupResult.audioUrl;
                } else {
                    console.log('❌ BACKUP: Backup found nothing');
                }
            } catch (error) {
                console.log('❌ BACKUP: Backup failed:', error.message);
            }
        }

        // ✅ Если Яндекс недоступен, сразу используем бэкап
        if (!this.useYandex) {
            try {
                console.log('🔍 PRIMARY (no Yandex): Trying Backup Dictionary...');
                const backupResult = await this.backupService.getTranscription(word);
                if (backupResult.transcription || backupResult.audioUrl) {
                    console.log('✅ PRIMARY: Using Backup result');
                    result.transcription = backupResult.transcription;
                    result.audioUrl = backupResult.audioUrl;
                }
            } catch (error) {
                console.log('❌ PRIMARY: Backup failed:', error.message);
            }
        }

        // ✅ Получаем переводы
        result.translations = await this.getTranslations(word);

        console.log(`📊 Final results for "${word}":`, {
            transcription: result.transcription || '❌ Not found',
            audioUrl: result.audioUrl ? '✅ Found' : '❌ Not found',
            translations: result.translations.length
        });

        return result;
    }

    async getTranslations(word) {
        let translations = [];
        
        // Сначала пробуем Яндекс для переводов
        if (this.useYandex) {
            try {
                translations = await this.getYandexTranslations(word);
                if (translations.length > 0) {
                    console.log(`✅ Yandex translations: ${translations.join(', ')}`);
                    return translations;
                }
            } catch (error) {
                console.log('❌ Yandex translations failed');
            }
        }

        // Потом пробуем Free Dictionary API для переводов
        try {
            translations = await this.getFreeDictionaryTranslations(word);
            if (translations.length > 0) {
                console.log(`✅ Free Dictionary translations: ${translations.join(', ')}`);
            }
        } catch (error) {
            console.log('❌ Free Dictionary translations failed');
        }

        return translations;
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

            return this.extractTranslationsFromYandex(response.data);
        } catch (error) {
            console.error('Yandex translation error:', error.message);
            return [];
        }
    }

    extractTranslationsFromYandex(data) {
        const translations = new Set();
        
        if (!data.def || data.def.length === 0) {
            return [];
        }

        data.def.forEach(definition => {
            if (definition.tr && definition.tr.length > 0) {
                definition.tr.forEach(translation => {
                    if (translation.text && translation.text.trim()) {
                        const cleanTranslation = translation.text.trim();
                        translations.add(cleanTranslation);
                        
                        if (translation.syn && translation.syn.length > 0) {
                            translation.syn.forEach(synonym => {
                                if (synonym.text && synonym.text.trim()) {
                                    translations.add(synonym.text.trim());
                                }
                            });
                        }
                    }
                });
            }
        });

        return Array.from(translations).slice(0, 4);
    }

    async getFreeDictionaryTranslations(word) {
        try {
            const response = await axios.get(
                `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
                { timeout: 5000 }
            );

            return this.extractTranslationsFromFreeDictionary(response.data);
        } catch (error) {
            console.error('Free Dictionary API error:', error.message);
            return [];
        }
    }

    extractTranslationsFromFreeDictionary(data) {
        const translations = new Set();
        
        if (!Array.isArray(data) || data.length === 0) {
            return [];
        }

        data.forEach(entry => {
            if (entry.meanings && Array.isArray(entry.meanings)) {
                entry.meanings.forEach(meaning => {
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

        return Array.from(translations).slice(0, 4);
    }
}
