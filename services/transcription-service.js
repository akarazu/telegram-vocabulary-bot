import axios from 'axios';
import { BackupDictionaryService } from './backup-dictionary-service.js';

export class TranscriptionService {
    constructor() {
        this.yandexApiKey = process.env.YANDEX_DICTIONARY_API_KEY;
        this.backupService = new BackupDictionaryService();
        // Резервные API endpoints для основного поиска
        this.backupApis = [
            'https://api.dictionaryapi.dev/api/v2/entries/en',
            'https://api-free.dictionaryapi.dev/api/v2/entries/en'
        ];
    }

    async getUKTranscription(word) {
        try {
            console.log(`🔍 Searching for: "${word}"`);
            
            // ✅ Пробуем основной Free Dictionary API
            let dictionaryData = await this.getDictionaryData(word);
            
            let transcription = dictionaryData.transcription;
            let audioUrl = dictionaryData.audioUrl;
            
            // ✅ Если не нашли в основном API, пробуем резервный сервис
            if (!transcription || !audioUrl) {
                console.log('🔄 Trying backup dictionary service...');
                const backupResult = await this.backupService.getTranscription(word);
                if (!transcription) transcription = backupResult.transcription;
                if (!audioUrl) audioUrl = backupResult.audioUrl;
            }
            
            // ✅ Получаем переводы (сначала Яндекс, потом резервные)
            let translations = await this.getYandexTranslations(word);
            if (translations.length === 0) {
                translations = await this.getBackupTranslations(word);
            }
            
            console.log(`📊 Final results for "${word}":`, {
                transcription: transcription || '❌ Not found',
                audioUrl: audioUrl ? '✅ Found' : '❌ Not found',
                translations: translations.length
            });
            
            return {
                transcription: transcription,
                audioUrl: audioUrl,
                translations: translations
            };
        } catch (error) {
            console.error('❌ Error in getUKTranscription:', error.message);
            return {
                transcription: null,
                audioUrl: null,
                translations: []
            };
        }
    }

    async getDictionaryData(word) {
        for (const apiUrl of this.backupApis) {
            try {
                console.log(`📡 Trying: ${apiUrl}`);
                const fullUrl = `${apiUrl}/${encodeURIComponent(word.toLowerCase())}`;
                const response = await axios.get(fullUrl, { timeout: 8000 });

                if (!response.data || !response.data[0]) {
                    console.log(`❌ No data from ${apiUrl}`);
                    continue;
                }

                const wordData = response.data[0];
                console.log(`✅ Data found in ${apiUrl}`);
                
                const result = this.extractDataFromResponse(wordData);
                if (result.transcription || result.audioUrl) {
                    return result;
                }
                
            } catch (error) {
                console.log(`❌ ${apiUrl} failed:`, error.message);
                continue;
            }
        }
        
        return { transcription: null, audioUrl: null };
    }

    extractDataFromResponse(wordData) {
        let transcription = null;
        let audioUrl = null;

        console.log('📋 API response structure:', Object.keys(wordData));
        
        // 🔍 Ищем транскрипцию в phonetic
        if (wordData.phonetic) {
            transcription = wordData.phonetic;
            console.log(`✅ Found phonetic: ${transcription}`);
        }

        // 🔍 Ищем в phonetics
        if (wordData.phonetics && wordData.phonetics.length > 0) {
            console.log(`🔊 Phonetics found: ${wordData.phonetics.length}`);
            
            // Приоритет: UK произношение
            const ukPhonetic = wordData.phonetics.find(p => 
                p.audio && (p.audio.includes('-uk.mp3') || p.audio.includes('/uk/'))
            );
            
            if (ukPhonetic) {
                console.log('🎯 Found UK phonetic');
                if (ukPhonetic.text && !transcription) {
                    transcription = ukPhonetic.text;
                }
                if (ukPhonetic.audio) {
                    audioUrl = ukPhonetic.audio;
                }
            }

            // Если нет UK, берем US
            if (!audioUrl || !transcription) {
                const usPhonetic = wordData.phonetics.find(p => 
                    p.audio && (p.audio.includes('-us.mp3') || p.audio.includes('/us/'))
                );
                if (usPhonetic) {
                    console.log('🇺🇸 Found US phonetic');
                    if (usPhonetic.text && !transcription) {
                        transcription = usPhonetic.text;
                    }
                    if (usPhonetic.audio && !audioUrl) {
                        audioUrl = usPhonetic.audio;
                    }
                }
            }

            // Если все еще нет, берем любой доступный
            if (!audioUrl || !transcription) {
                const availablePhonetic = wordData.phonetics.find(p => p.text || p.audio);
                if (availablePhonetic) {
                    console.log('🔍 Using available phonetic');
                    if (availablePhonetic.text && !transcription) {
                        transcription = availablePhonetic.text;
                    }
                    if (availablePhonetic.audio && !audioUrl) {
                        audioUrl = availablePhonetic.audio;
                    }
                }
            }
        }

        return { transcription, audioUrl };
    }

    async getYandexTranslations(word) {
        try {
            if (!this.yandexApiKey) {
                console.log('❌ Yandex API key not found, using backup translations');
                return await this.getBackupTranslations(word);
            }

            const response = await axios.get('https://dictionary.yandex.net/api/v1/dicservice.json/lookup', {
                params: {
                    key: this.yandexApiKey,
                    lang: 'en-ru',
                    text: word,
                    ui: 'ru'
                },
                timeout: 5000
            });

            const translations = this.extractTranslationsFromYandex(response.data, word);
            
            if (translations.length > 0) {
                console.log(`✅ Yandex translations found: ${translations.join(', ')}`);
                return translations.slice(0, 4);
            } else {
                console.log('❌ No Yandex translations found, using backup translations');
                return await this.getBackupTranslations(word);
            }
            
        } catch (error) {
            console.error('❌ Yandex translation error:', error.message);
            return await this.getBackupTranslations(word);
        }
    }

    extractTranslationsFromYandex(data, originalWord) {
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

    async getBackupTranslations(word) {
        try {
            console.log('🔄 Getting translations from backup dictionary...');
            
            // Используем любой из доступных API endpoints для получения переводов
            for (const apiUrl of this.backupApis) {
                try {
                    const fullUrl = `${apiUrl}/${encodeURIComponent(word.toLowerCase())}`;
                    const response = await axios.get(fullUrl, { timeout: 5000 });

                    if (response.data && response.data[0]) {
                        const translations = this.extractTranslationsFromFreeDictionary(response.data, word);
                        if (translations.length > 0) {
                            console.log(`✅ Backup translations found: ${translations.join(', ')}`);
                            return translations.slice(0, 4);
                        }
                    }
                } catch (error) {
                    console.log(`❌ ${apiUrl} for translations failed:`, error.message);
                    continue;
                }
            }
            
            console.log('❌ No backup translations found');
            return [];
            
        } catch (error) {
            console.error('❌ Backup translations error:', error.message);
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
                    // Добавляем partOfSpeech как возможный перевод
                    if (meaning.partOfSpeech) {
                        translations.add(meaning.partOfSpeech);
                    }
                    
                    if (meaning.definitions && Array.isArray(meaning.definitions)) {
                        meaning.definitions.forEach(definition => {
                            if (definition.definition && definition.definition.trim()) {
                                // Берем короткое определение (первые 3-4 слова)
                                const words = definition.definition.split(' ').slice(0, 4);
                                const shortDef = words.join(' ');
                                if (shortDef.length < 40 && words.length > 1) {
                                    translations.add(shortDef);
                                }
                            }
                        });
                    }
                    
                    if (meaning.synonyms && Array.isArray(meaning.synonyms)) {
                        meaning.synonyms.forEach(synonym => {
                            if (synonym && synonym.trim() && synonym.length < 30) {
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
