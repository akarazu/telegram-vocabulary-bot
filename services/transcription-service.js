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
            examples: [] // Добавляем примеры использования
        };

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

        // ✅ Получаем переводы и примеры использования
        const translationData = await this.getTranslationsAndExamples(word);
        result.translations = translationData.translations;
        result.examples = translationData.examples;

        console.log(`📊 Final results for "${word}":`, {
            transcription: result.transcription || '❌ Not found',
            audioUrl: result.audioUrl ? '✅ Found' : '❌ Not found',
            translations: result.translations.length,
            examples: result.examples.length
        });

        return result;
    }

    async getTranslationsAndExamples(word) {
        let translations = [];
        let examples = [];
        
        // Сначала пробуем Free Dictionary API (там есть примеры использования)
        try {
            console.log('📖 Getting translations and examples from Free Dictionary...');
            const freeDictData = await this.getFreeDictionaryData(word);
            translations = freeDictData.translations;
            examples = freeDictData.examples;
            
            if (translations.length > 0) {
                console.log(`✅ Free Dictionary translations: ${translations.length}`);
            }
            if (examples.length > 0) {
                console.log(`✅ Free Dictionary examples: ${examples.length}`);
            }
        } catch (error) {
            console.log('❌ Free Dictionary failed');
        }

        // Если нет переводов, пробуем Яндекс
        if (translations.length === 0 && this.useYandex) {
            try {
                translations = await this.getYandexTranslations(word);
                if (translations.length > 0) {
                    console.log(`✅ Yandex translations: ${translations.join(', ')}`);
                }
            } catch (error) {
                console.log('❌ Yandex translations failed');
            }
        }

        // Если нет примеров, генерируем базовые
        if (examples.length === 0) {
            examples = this.generateBasicExamples(word);
            console.log(`🔧 Generated basic examples: ${examples.length}`);
        }

        return { translations, examples };
    }

    async getFreeDictionaryData(word) {
        try {
            const response = await axios.get(
                `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
                { timeout: 5000 }
            );

            return this.extractDataFromFreeDictionary(response.data, word);
        } catch (error) {
            console.error('Free Dictionary API error:', error.message);
            return { translations: [], examples: [] };
        }
    }

    extractDataFromFreeDictionary(data, word) {
        const translations = new Set();
        const examples = new Set();
        
        if (!Array.isArray(data) || data.length === 0) {
            return { translations: [], examples: [] };
        }

        data.forEach(entry => {
            if (entry.meanings && Array.isArray(entry.meanings)) {
                entry.meanings.forEach(meaning => {
                    // Добавляем partOfSpeech как перевод
                    if (meaning.partOfSpeech) {
                        translations.add(meaning.partOfSpeech);
                    }
                    
                    // Ищем в definitions
                    if (meaning.definitions && Array.isArray(meaning.definitions)) {
                        meaning.definitions.forEach(definition => {
                            // Добавляем короткое определение как перевод
                            if (definition.definition && definition.definition.trim()) {
                                const shortDef = definition.definition
                                    .split(' ')
                                    .slice(0, 4)
                                    .join(' ');
                                if (shortDef.length < 50) {
                                    translations.add(shortDef);
                                }
                            }
                            
                            // Добавляем примеры использования
                            if (definition.example && definition.example.trim()) {
                                const cleanExample = definition.example.trim();
                                if (cleanExample.length < 100) {
                                    examples.add(cleanExample);
                                }
                            }
                        });
                    }
                    
                    // Добавляем синонимы
                    if (meaning.synonyms && Array.isArray(meaning.synonyms)) {
                        meaning.synonyms.forEach(synonym => {
                            if (synonym && synonym.trim()) {
                                translations.add(synonym.trim());
                            }
                        });
                    }
                });
            }
            
            // Также проверяем license для примеров
            if (entry.license && entry.license.url) {
                console.log('📝 License info available for examples');
            }
        });

        return {
            translations: Array.from(translations).slice(0, 4),
            examples: Array.from(examples).slice(0, 3) // Ограничиваем 3 примерами
        };
    }

    generateBasicExamples(word) {
        // Базовые примеры использования для распространенных частей речи
        const basicExamples = [
            `I need to learn the word "${word}".`,
            `Can you use "${word}" in a sentence?`,
            `The "${word}" is very important in English.`,
            `She said "${word}" during the conversation.`,
            `What does "${word}" mean?`
        ];
        
        return basicExamples.slice(0, 2); // Возвращаем 2 базовых примера
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
}
