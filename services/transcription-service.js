import axios from 'axios';

export class TranscriptionService {
    async getUKTranscription(word) {
        try {
            console.log(`🔍 Searching UK transcription for: "${word}"`);
            
            const response = await axios.get(
                `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`,
                { timeout: 5000 }
            );

            if (response.data && response.data[0]) {
                const wordData = response.data[0];
                
                // Ищем UK транскрипцию и аудио
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
                        // Любая транскрипция если UK нет
                        const anyPhonetic = wordData.phonetics.find(p => p.text);
                        if (anyPhonetic) {
                            transcription = anyPhonetic.text;
                            audioUrl = anyPhonetic.audio || '';
                        }
                    }
                }
                
                // Если не нашли в phonetics, используем phonetic
                if (!transcription && wordData.phonetic) {
                    transcription = wordData.phonetic;
                }
                
                console.log(`✅ Transcription: ${transcription}`);
                console.log(`🎵 Audio URL: ${audioUrl}`);
                
                return {
                    transcription: transcription,
                    audioUrl: audioUrl
                };
            }
            
            console.log('❌ No transcription found');
            return { transcription: '', audioUrl: '' };
            
        } catch (error) {
            if (error.response?.status === 404) {
                console.log('❌ Word not found in dictionary');
            } else {
                console.error('❌ Dictionary API error:', error.message);
            }
            return { transcription: '', audioUrl: '' };
        }
    }
}
