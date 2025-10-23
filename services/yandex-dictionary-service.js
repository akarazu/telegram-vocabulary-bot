async function getTranscriptionAndAudio(word) {
    if (!word || word.trim() === '') {
        return this.getFallbackData('');
    }
    
    const lowerWord = word.toLowerCase().trim();
    const cacheKey = `yandex_${lowerWord}`;
    
    try {
        const cached = this.cache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
            return cached.data;
        }
        
        if (!this.useYandex) {
            return this.getFallbackData(word);
        }

        const response = await axios.get('https://dictionary.yandex.net/api/v1/dicservice.json/lookup', {
            params: {
                key: process.env.YANDEX_DICTIONARY_API_KEY,
                lang: 'en-ru',
                text: word
            },
            timeout: 5000
        });

        const result = {
            transcription: '',
            audioUrl: this.generateFallbackAudioUrl(word)
        };

        if (response.data && response.data.def && response.data.def[0] && response.data.def[0].ts) {
            result.transcription = `/${response.data.def[0].ts}/`;
        }

        this.cache.set(cacheKey, { data: result, timestamp: Date.now() });
        return result;
        
    } catch (error) {
        console.error('Yandex service error:', error.message);
        return this.getFallbackData(word);
    }
}
