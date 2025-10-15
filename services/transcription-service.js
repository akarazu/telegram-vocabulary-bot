import axios from 'axios';

export class TranscriptionService {
    constructor() {
        this.yandexApiKey = process.env.YANDEX_DICTIONARY_API_KEY;
    }

    async getUKTranscription(word) {
        try {
            // ... существующий код для транскрипции и аудио ...
            
            // ✅ ИСПОЛЬЗУЕМ YANDEX DICTIONARY API
            const translations = await this.getYandexTranslations(word);
            
            return {
                transcription: transcription,
                audioUrl: audioUrl,
                translations: translations
            };
        } catch (error) {
            console.error('Error getting transcription:', error);
            return {
                transcription: null,
                audioUrl: null,
                translations: []
            };
        }
    }

    async getYandexTranslations(word) {
        try {
            if (!this.yandexApiKey) {
                console.log('Yandex API key not found, using Free Dictionary API');
                return await this.getFreeDictionaryTranslations(word);
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
                console.log('No Yandex translations found, using Free Dictionary API');
                return await this.getFreeDictionaryTranslations(word);
            }
            
        } catch (error) {
            console.error('Yandex translation error:', error.message);
            return await this.getFreeDictionaryTranslations(word);
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

    // ✅ FREE DICTIONARY API FALLBACK
    async getFreeDictionaryTranslations(word) {
        try {
            const response = await axios.get(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`, {
                timeout: 5000
            });

            const translations = this.extractTranslationsFromFreeDictionary(response.data, word);
            
            if (translations.length > 0) {
                console.log(`✅ Free Dictionary translations found: ${translations.join(', ')}`);
                return translations.slice(0, 4);
            } else {
                return [];
            }
            
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
