import { FSRS, Rating, generatorParameters } from 'fsrs.js';

// ✅ РЕАЛЬНЫЙ FSRS Service с настоящей адаптацией
export class FSRSService {
    constructor() {
        try {
            // Используем оптимизированные параметры для быстрого обучения
            this.parameters = generatorParameters({
                request_retention: 0.85, // Немного ниже для более частых повторений
                maximum_interval: 365,
                easy_bonus: 1.5,        // Бонус для "легко"
                hard_factor: 0.8,       // Фактор для "трудно"
                w: [0.4, 0.9, 2.3, 4.2, 3.8, 0.8, 0.7, 0.02, 1.3, 0.18, 1.1, 1.9, 0.08, 0.28, 1.2, 0.25, 2.3]
            });
            
            this.fsrs = new FSRS(this.parameters);
            console.log('✅ REAL FSRS service initialized with adaptive learning');
        } catch (error) {
            console.error('❌ Error initializing REAL FSRS:', error);
            this.fsrs = null;
        }
    }

    // Основной метод для повторения карточки с реальной адаптацией
    reviewCard(cardData, rating) {
        if (!this.fsrs) {
            return this.fallbackRepeat(cardData, rating);
        }

        try {
            // Создаем карточку в формате FSRS
            const card = {
                due: new Date(cardData.due),
                stability: cardData.stability || 0.1,
                difficulty: cardData.difficulty || 5.0,
                elapsed_days: cardData.elapsed_days || 0,
                scheduled_days: cardData.scheduled_days || 0,
                reps: cardData.reps || 0,
                lapses: cardData.lapses || 0,
                state: cardData.state || 0,
                last_review: cardData.last_review ? new Date(cardData.last_review) : new Date()
            };

            // Конвертируем наш рейтинг в FSRS Rating
            const fsrsRating = this.convertRatingToFSRS(rating);
            
            // ✅ РЕАЛЬНАЯ АДАПТАЦИЯ: FSRS сам рассчитывает оптимальный интервал
            const schedule = this.fsrs.repeat(card, new Date());
            const result = schedule[fsrsRating];

            console.log(`🎯 FSRS адаптация: рейтинг=${rating}, интервал=${result.card.scheduled_days}д, стабильность=${result.card.stability.toFixed(2)}`);

            return {
                due: result.card.due,
                stability: result.card.stability,
                difficulty: result.card.difficulty,
                elapsed_days: result.card.elapsed_days,
                scheduled_days: result.card.scheduled_days,
                reps: result.card.reps,
                lapses: result.card.lapses,
                state: result.card.state,
                last_review: new Date(),
                interval: result.card.scheduled_days
            };

        } catch (error) {
            console.error('❌ Error in REAL FSRS review:', error);
            return this.fallbackRepeat(cardData, rating);
        }
    }

    // Конвертация наших рейтингов в FSRS Rating
    convertRatingToFSRS(rating) {
        const ratingMap = {
            'again': Rating.Again,
            'review_again': Rating.Again,
            'hard': Rating.Hard,
            'review_hard': Rating.Hard,
            'good': Rating.Good,
            'review_good': Rating.Good,
            'easy': Rating.Easy,
            'review_easy': Rating.Easy
        };
        return ratingMap[rating] || Rating.Good;
    }

    // Метод для создания новой карточки
    createNewCard() {
        const now = new Date();
        
        if (this.fsrs) {
            // Используем FSRS для создания новой карточки
            const card = this.fsrs.getEmptyCard();
            card.due = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 1 день
            return {
                due: card.due,
                stability: card.stability,
                difficulty: card.difficulty,
                elapsed_days: card.elapsed_days,
                scheduled_days: 1,
                reps: card.reps,
                lapses: card.lapses,
                state: card.state,
                last_review: now,
                interval: 1
            };
        } else {
            // Fallback
            return {
                due: new Date(now.getTime() + 24 * 60 * 60 * 1000),
                stability: 0.1,
                difficulty: 5.0,
                elapsed_days: 0,
                scheduled_days: 1,
                reps: 0,
                lapses: 0,
                state: 1,
                last_review: now,
                interval: 1
            };
        }
    }

    // Fallback метод
    fallbackRepeat(cardData, rating) {
        const now = new Date();
        let interval;

        switch (rating) {
            case 'again': case 'review_again': interval = 0.014; break; // 20 мин
            case 'hard': case 'review_hard': interval = 0.33; break;    // 8 часов
            case 'good': case 'review_good': interval = 1; break;       // 1 день
            case 'easy': case 'review_easy': interval = 3; break;       // 3 дня
            default: interval = 1;
        }

        return {
            due: new Date(now.getTime() + interval * 24 * 60 * 60 * 1000),
            stability: interval,
            difficulty: 5.0,
            elapsed_days: interval,
            scheduled_days: interval,
            reps: (cardData.reps || 0) + 1,
            lapses: rating.includes('again') ? (cardData.lapses || 0) + 1 : (cardData.lapses || 0),
            state: 1,
            last_review: now,
            interval: interval
        };
    }
}
