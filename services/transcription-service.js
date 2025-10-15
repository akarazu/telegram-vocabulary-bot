// services/transcription-service.js
import axios from 'axios';

export class TranscriptionService {
    async getUKTranscription(word) {
        try {
            // ... существующий код для транскрипции и аудио ...
            
            // ✅ ДОБАВЛЯЕМ ПОЛУЧЕНИЕ ВАРИАНТОВ ПЕРЕВОДА
            const translations = await this.getTranslations(word);
            
            return {
                transcription: transcription,
                audioUrl: audioUrl,
                translations: translations // массив вариантов перевода
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

    async getTranslations(word) {
        try {
            // Используем LibreTranslate (бесплатный)
            const response = await axios.post('https://libretranslate.com/translate', {
                q: word,
                source: 'en',
                target: 'ru',
                format: 'text',
                alternatives: 3 // запрашиваем несколько вариантов
            }, {
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            const alternatives = response.data.alternatives || [];
            const mainTranslation = response.data.translatedText;
            
            // Собираем все варианты перевода
            const allTranslations = [mainTranslation];
            alternatives.forEach(alt => {
                if (alt && !allTranslations.includes(alt)) {
                    allTranslations.push(alt);
                }
            });

            return allTranslations.slice(0, 3); // максимум 3 варианта
        } catch (error) {
            console.error('Translation error:', error);
            // Fallback: возвращаем пустой массив
            return [];
        }
    }
}
