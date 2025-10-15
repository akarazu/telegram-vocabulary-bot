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

        // ✅ ПЕРВОЕ: получаем транскрипцию и аудио из Яндекс
        if (this.useYandex) {
            try {
                console.log('🔍 PRIMARY: Getting transcription and audio from Yandex...');
                const yandexTranscription = await this.yandexService.getTranscription(word);
                result.transcription = yandexTranscription.transcription || '';
                result.audioUrl = yandexTranscription.audioUrl || '';
                
                if (result.transcription) {
                    console.log('✅ PRIMARY: Yandex transcription found');
                }
                if (result.audioUrl) {
                    console.log('✅ PRIMARY: Yandex audio found');
                }
            } catch (error) {
                console.log('❌ PRIMARY: Yandex transcription failed:', error.message);
            }
        }

        // ✅ ВТОРОЕ: получаем переводы из Яндекс
        if (this.useYandex) {
            try {
                console.log('🔍 PRIMARY: Getting translations from Yandex...');
                const yandexTranslations = await this.getYandexTranslations(word);
                if (yandexTranslations.translations && yandexTranslations.translations.length > 0) {
                    console.log('✅ PRIMARY: Yandex translations found');
                    result.translations = yandexTranslations.translations;
                }
            } catch (error) {
                console.log('❌ PRIMARY: Yandex translations failed:', error.message);
            }
        }

        // ✅ ЕСЛИ Яндекс недоступен или не нашел данные, используем бэкап
        if (!this.useYandex || (!result.transcription && !result.audioUrl)) {
            try {
                console.log('🔄 FALLBACK: Using Backup service...');
                const backupResult = await this.backupService.getTranscription(word);
                if (!result.transcription) result.transcription = backupResult.transcription || '';
                if (!result.audioUrl) result.audioUrl = backupResult.audioUrl || '';
            } catch (error) {
                console.log('❌ FALLBACK: Backup failed:', error.message);
            }
        }

        // ✅ ЕСЛИ переводы не найдены, используем бэкап
        if (result.translations.length === 0) {
            try {
                console.log('🔄 FALLBACK: Getting backup translations...');
                const backupTranslations = await this.getBackupTranslations(word);
                if (backupTranslations.length > 0) {
                    result.translations = backupTranslations;
                    console.log('✅ FALLBACK: Backup translations found');
                }
            } catch (error) {
                console.log('❌ FALLBACK: Backup translations failed:', error.message);
            }
        }

        // ✅ ФИНАЛЬНЫЕ FALLBACK'и
        if (!result.transcription) {
            result.transcription = this.generateSimpleTranscription(word);
        }
        if (!result.audioUrl) {
            result.audioUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(word)}&tl=en-gb&client=tw-ob`;
        }
        if (result.translations.length === 0) {
            result.translations = this.getSimpleTranslations(word);
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
            console.log(`🔍 Yandex API call for translations: "${word}"`);
            
            const response = await axios.get('https://dictionary.yandex.net/api/v1/dicservice.json/lookup', {
                params: {
                    key: process.env.YANDEX_DICTIONARY_API_KEY,
                    lang: 'en-ru',
                    text: word,
                    ui: 'ru'
                },
                timeout: 10000
            });

            console.log('✅ Yandex API response received for translations');
            return this.extractTranslationsFromYandex(response.data, word);
            
        } catch (error) {
            console.error('❌ Yandex translation error:', error.message);
            if (error.response) {
                console.error('Yandex response status:', error.response.status);
                console.error('Yandex response data:', error.response.data);
            }
            return { translations: [] };
        }
    }

    extractTranslationsFromYandex(data, originalWord) {
        const translations = new Set();
        
        if (!data.def || data.def.length === 0) {
            console.log('❌ Yandex: No definitions found in response');
            return { translations: [] };
        }

        console.log(`🔍 Yandex found ${data.def.length} definition(s) for translations`);

        data.def.forEach((definition, index) => {
            console.log(`🔍 Definition ${index + 1}:`, definition.text);
            
            if (definition.tr && definition.tr.length > 0) {
                console.log(`🔍 Processing ${definition.tr.length} translation(s)`);
                
                definition.tr.forEach((translation, trIndex) => {
                    console.log(`🔍 Translation ${trIndex + 1}:`, translation.text);
                    
                    if (translation.text && translation.text.trim()) {
                        const russianTranslation = translation.text.trim();
                        
                        if (this.isRussianText(russianTranslation) && 
                            russianTranslation.toLowerCase() !== originalWord.toLowerCase()) {
                            translations.add(russianTranslation);
                            console.log(`✅ Added translation: "${russianTranslation}"`);
                        }
                    }
                });
            }
        });

        const translationArray = Array.from(translations).slice(0, 4);
        console.log(`✅ Yandex translations found: ${translationArray.length}`);
        
        return { translations: translationArray };
    }

    // ✅ Функция для проверки русского текста
    isRussianText(text) {
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

        data.forEach(entry => {
            if (entry.meanings && Array.isArray(entry.meanings)) {
                entry.meanings.forEach(meaning => {
                    if (meaning.definitions && Array.isArray(meaning.definitions)) {
                        meaning.definitions.forEach(definition => {
                            if (definition.definition && definition.definition.trim()) {
                                const shortDef = definition.definition
                                    .split(/[.,;!?]/)[0]
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

        return Array.from(translations).slice(0, 4);
    }

    // ✅ Простая генерация транскрипции (fallback)
    generateSimpleTranscription(word) {
        return `/ˈ${word.toLowerCase().replace(/ /g, 'ˌ')}/`;
    }

    // ✅ Простые fallback-переводы
    getSimpleTranslations(word) {
        return [`перевод для "${word}"`];
    }
}
