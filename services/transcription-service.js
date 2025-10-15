export class BackupDictionaryService {
    async getTranscription(word) {
        try {
            console.log(`🔍 Backup: Searching for "${word}"`);
            
            const encodedWord = encodeURIComponent(word);
            
            const response = await axios.get(
                `https://api.dictionaryapi.dev/api/v2/entries/en/${encodedWord}`,
                { timeout: 5000 }
            );

            const result = this.extractTranscriptionAndAudio(response.data, word);
            
            // Если не нашли через основной API, пробуем альтернативный источник
            if (!result.audioUrl) {
                console.log('🔄 Backup: Trying alternative audio source...');
                const alternativeAudio = await this.getAlternativeAudio(word);
                if (alternativeAudio) {
                    result.audioUrl = alternativeAudio;
                }
            }
            
            return result;
            
        } catch (error) {
            console.error('Backup API error:', error.message);
            
            // Fallback: пробуем альтернативный источник при ошибке
            try {
                console.log('🔄 Backup: Fallback to alternative audio source...');
                const alternativeAudio = await this.getAlternativeAudio(word);
                return {
                    transcription: '',
                    audioUrl: alternativeAudio || ''
                };
            } catch (fallbackError) {
                return { transcription: '', audioUrl: '' };
            }
        }
    }

    extractTranscriptionAndAudio(data, originalWord) {
        if (!Array.isArray(data) || data.length === 0) {
            console.log('❌ Backup: No data found');
            return { transcription: '', audioUrl: '' };
        }

        console.log(`🔍 Backup: Found ${data.length} entry/entries`);

        let transcription = '';
        let audioUrl = '';

        for (const entry of data) {
            // Логируем структуру для отладки
            console.log('🔍 Backup entry structure:', {
                word: entry.word,
                phonetic: entry.phonetic,
                phonetics: entry.phonetics ? entry.phonetics.length : 0
            });

            // Пробуем получить транскрипцию из основного поля
            if (entry.phonetic) {
                transcription = entry.phonetic;
                console.log(`✅ Backup: Found transcription from phonetic: ${transcription}`);
            }

            // Ищем аудио в phonetics
            if (entry.phonetics && Array.isArray(entry.phonetics)) {
                for (const phonetic of entry.phonetics) {
                    console.log('🔍 Backup phonetic:', phonetic);
                    
                    if (phonetic.audio && phonetic.audio.trim()) {
                        // Приоритет для UK произношения
                        if (phonetic.audio.includes('-uk.') || phonetic.text) {
                            audioUrl = phonetic.audio;
                            // Если есть текстовая транскрипция, используем её
                            if (phonetic.text && !transcription) {
                                transcription = phonetic.text;
                            }
                            console.log(`✅ Backup: Found audio: ${audioUrl}`);
                            break;
                        }
                    }
                }
            }

            // Если нашли и транскрипцию и аудио, выходим
            if (transcription && audioUrl) break;
        }

        console.log(`📊 Backup final results: transcription="${transcription}", audioUrl="${audioUrl ? 'found' : 'not found'}"`);
        
        return {
            transcription: transcription || '',
            audioUrl: audioUrl || ''
        };
    }

    // Альтернативный источник аудио через Google TTS
    async getAlternativeAudio(word) {
        try {
            // Простой fallback через Google Text-to-Speech
            const encodedWord = encodeURIComponent(word);
            const audioUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodedWord}&tl=en-gb&client=tw-ob`;
            
            // Проверяем что URL валидный
            const response = await axios.head(audioUrl, { timeout: 3000 });
            if (response.status === 200) {
                console.log(`✅ Alternative audio found for: ${word}`);
                return audioUrl;
            }
        } catch (error) {
            console.log('❌ Alternative audio not available');
        }
        return '';
    }
}
