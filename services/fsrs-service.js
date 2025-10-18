import { FSRS, createEmptyCard, Rating } from 'fsrs';

// ✅ РЕАЛЬНЫЙ FSRS Service с настоящей адаптацией
export class FSRSService {
    constructor() {
        try {
            // Параметры для быстрого обучения
            this.parameters = {
                request_retention: 0.85, // Немного ниже для более частых повторений
                maximum_interval: 365,
                w: [
                    0.5701, 1.4436, 4.4146, 10.9355, 5.0963, 1.2006, 0.8627, 0.0365, 
                    1.6012, 0.1512, 0.995, 2.0663, 0.0372, 0.2136, 1.7858, 0.0828, 
                    0.4661, 0.0231, 1.798, 0.2121
                ]
            };
            
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
                due: cardData.due ? new Date(cardData.due) : new Date(),
                stability: cardData.stability || 0,
                difficulty: cardData.difficulty || 0,
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
            const scheduling_cards = this.fsrs.repeat(card, new Date());
            const result = scheduling_cards[fsrsRating];

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
            const card = createEmptyCard();
            // Новая карточка становится доступной через 1 день
            const scheduling_cards = this.fsrs.repeat(card, now);
            const result = scheduling_cards[Rating.Good]; // Используем Good для нового слова
            
            return {
                due: result.card.due,
                stability: result.card.stability,
                difficulty: result.card.difficulty,
                elapsed_days: result.card.elapsed_days,
                scheduled_days: result.card.scheduled_days,
                reps: result.card.reps,
                lapses: result.card.lapses,
                state: result.card.state,
                last_review: now,
                interval: result.card.scheduled_days
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

    // Fallback метод на случай ошибок
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
