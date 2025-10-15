import { YandexDictionaryService } from './yandex-dictionary-service.js';
import axios from 'axios';

export class TranscriptionService {
    constructor() {
        this.yandexService = new YandexDictionaryService();
        this.useYandex = !!process.env.YANDEX_DICTIONARY_API_KEY;
        
        if (this.useYandex) {
            console.log('🎯 Using Yandex Dictionary API');
        } else {
            console.log('🎯 Yandex API key not found, using Free Dictionary API');
        }
    }

    async getUKTranscription(word) {
        console.log(`🔍 Searching transcription for: "${word}"`);
        
        // Если есть Yandex ключ, пробуем его первым
        if (this.useYandex) {
            try {
                const yandexResult = await this.yandexService.getTranscription(word);
                if (yandexResult.transcription) {
                    console.log('✅ Using Yandex result');
                    return yandexResult;
                }
            } catch (error) {
                console.log('🔄 Yandex failed, trying backup...');
            }
        }

        // Всегда пробуем Free Dictionary API как резерв
        console.log('🔄 Trying Free Dictionary API...');
        return await this.tryFreeDictionary(word);
    }

    async tryFreeDictionary(word) {
        try {
            const response = await axios.get(
                `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`,
                { timeout: 5000 }
            );

            if (response.data && response.data[0]) {
                const wordData = response.data[0];
                
                let transcription = '';
                let audioUrl = '';
                
                if (wordData.phonetics) {
                    const ukPhonetic = wordData.phonetics.find(p => 
                        p.audio && p.audio.includes('/uk/')
                    );
                    
                    if (ukPhonetic) {
                        transcription = ukPhonetic.text || '';
                        audioUrl = ukPhonetic.audio || '';
                    } else {
                        const anyPhonetic = wordData.phonetics.find(p => p.text);
                        if (anyPhonetic) {
                            transcription = anyPhonetic.text;
                            audioUrl = anyPhonetic.audio || '';
                        }
                    }
                }
                
                if (!transcription && wordData.phonetic) {
                    transcription = wordData.phonetic;
                }
                
                console.log(`✅ Free Dictionary transcription: ${transcription}`);
                return {
                    transcription: transcription,
                    audioUrl: audioUrl
                };
            }
            
            return { transcription: '', audioUrl: '' };
            
        } catch (error) {
            console.error('Free Dictionary API error:', error.message);
            return { transcription: '', audioUrl: '' };
        }
    }
}
