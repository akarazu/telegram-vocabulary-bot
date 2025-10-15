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
            partOfSpeech: '' // ✅ ДОБАВЛЯЕМ ЧАСТЬ РЕЧИ
        };

        // ✅ ПЕРВОЕ: получаем ВСЕ данные из Яндекс за один запрос
        if (this.useYandex) {
            try {
                console.log('🔍 PRIMARY: Getting all data from Yandex...');
                const yandexData = await this.getYandexData(word);
                result.transcription = yandexData.transcription || '';
                result.audioUrl = yandexData.audioUrl || '';
                result.translations = yandexData.translations || [];
                result.partOfSpeech = yandexData.partOfSpeech || ''; // ✅ ЧАСТЬ РЕЧИ
                
                if (result.transcription) console.log('✅ PRIMARY: Yandex transcription found');
                if (result.audioUrl) console.log('✅ PRIMARY: Yandex audio found');
                if (result.partOfSpeech) console.log(`✅ PRIMARY: Yandex part of speech: ${result.partOfSpeech}`);
                if (result.translations.length > 0) console.log(`✅ PRIMARY: Yandex translations found: ${result.translations.length}`);
                
            } catch (error) {
                console.log('❌ PRIMARY: Yandex failed:', error.message);
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
            translations: result.translations.length,
            partOfSpeech: result.partOfSpeech || '❌ Not found'
        });

        return result;
    }

    // ✅ НОВЫЙ МЕТОД: получаем все данные из Яндекс за один запрос
    async getYandexData(word) {
        try {
            console.log(`🔍 Yandex API call for: "${word}"`);
            
            const response = await axios.get('https://dictionary.yandex.net/api/v1/dicservice.json/lookup', {
                params: {
                    key: process.env.YANDEX_DICTIONARY_API_KEY,
                    lang: 'en-ru',
                    text: word,
                    ui: 'ru'
                },
                timeout: 10000
            });

            console.log('✅ Yandex API response received');
            return this.extractDataFromYandex(response.data, word);
            
        } catch (error) {
            console.error('❌ Yandex API error:', error.message);
            return { transcription: '', audioUrl: '', translations: [], partOfSpeech: '' };
        }
    }

    // ✅ ОБНОВЛЕННЫЙ МЕТОД: извлекаем все данные из ответа Яндекс
extractDataFromYandex(data, originalWord) {
    const result = {
        transcription: '',
        audioUrl: '',
        translations: [],
        translationsWithPOS: [] // ✅ СОХРАНЯЕМ ПЕРЕВОДЫ С ЧАСТЯМИ РЕЧИ
    };

    if (!data.def || data.def.length === 0) {
        return result;
    }

    const firstDefinition = data.def[0];
    
    // Извлекаем транскрипцию
    if (firstDefinition.ts) {
        result.transcription = `/${firstDefinition.ts}/`;
    }
    
    // Извлекаем переводы с частями речи
    if (firstDefinition.tr && Array.isArray(firstDefinition.tr)) {
        firstDefinition.tr.forEach(translation => {
            if (translation.text && translation.text.trim()) {
                const russianTranslation = translation.text.trim();
                if (this.isRussianText(russianTranslation)) {
                    result.translations.push(russianTranslation);
                    // ✅ СОХРАНЯЕМ ПЕРЕВОД С ЧАСТЬЮ РЕЧИ
                    result.translationsWithPOS.push({
                        text: russianTranslation,
                        pos: translation.pos || firstDefinition.pos || 'unknown'
                    });
                }
            }
        });
    }
    
    result.audioUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(originalWord)}&tl=en-gb&client=tw-ob`;

    return result;
}
        
        result.translations = Array.from(translations).slice(0, 4);
        
        // ✅ ГЕНЕРИРУЕМ АУДИО URL
        result.audioUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(originalWord)}&tl=en-gb&client=tw-ob`;

        return result;
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

        console.log(`🔍 FreeDictionary found ${data.length} entry/entries`);

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

