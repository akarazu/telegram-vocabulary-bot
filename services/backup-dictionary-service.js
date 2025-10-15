import axios from 'axios';

export class BackupDictionaryService {
    async getTranscription(word) {
        try {
            console.log(`🔍 Backup: Searching for "${word}"`);
            
            const response = await axios.get(
                `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`,
                { timeout: 3000 }
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
                
                console.log(`✅ Backup transcription: ${transcription}`);
                return { transcription, audioUrl };
            }
            
            return { transcription: '', audioUrl: '' };
            
        } catch (error) {
            console.error('Backup API error:', error.message);
            return { transcription: '', audioUrl: '' };
        }
    }
}
