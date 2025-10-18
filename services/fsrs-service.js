import pkg from 'ts-fsrs';
const { fsrs, generatorParameters, createEmptyCard, Grade } = pkg;

// ✅ РЕАЛЬНЫЙ FSRS Service с ts-fsrs
export class FSRSService {
    constructor() {
        try {
            // Параметры для быстрого обучения
            this.parameters = generatorParameters({
                request_retention: 0.85, // Немного ниже для более частых повторений
                maximum_interval: 365,
                enable_fuzz: true
            });
            
            this.scheduler = fsrs(this.parameters);
            console.log('✅ REAL FSRS service initialized with ts-fsrs');
        } catch (error) {
            console.error('❌ Error initializing REAL FSRS:', error);
            this.scheduler = null;
        }
    }

    // Основной метод для повторения карточки с реальной адаптацией
    reviewCard(cardData, rating) {
        if (!this.scheduler) {
            return this.fallbackRepeat(cardData, rating);
        }

        try {
            // Создаем карточку в формате ts-fsrs
            const card = this.createCardFromData(cardData);

            // Конвертируем наш рейтинг в FSRS Grade
            const grade = this.convertRatingToGrade(rating);
            
            // ✅ РЕАЛЬНАЯ АДАПТАЦИЯ: ts-fsrs рассчитывает оптимальный интервал
            const result = this.scheduler.repeat(card, new Date(), grade);

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

    // Создание карточки из данных
    createCardFromData(cardData) {
        const card = createEmptyCard();
        
        if (cardData.due) card.due = new Date(cardData.due);
        if (cardData.stability) card.stability = cardData.stability;
        if (cardData.difficulty) card.difficulty = cardData.difficulty;
        if (cardData.elapsed_days) card.elapsed_days = cardData.elapsed_days;
        if (cardData.scheduled_days) card.scheduled_days = cardData.scheduled_days;
        if (cardData.reps) card.reps = cardData.reps;
        if (cardData.lapses) card.lapses = cardData.lapses;
        if (cardData.state) card.state = cardData.state;
        if (cardData.last_review) card.last_review = new Date(cardData.last_review);
        
        return card;
    }

    // Конвертация наших рейтингов в FSRS Grade
    convertRatingToGrade(rating) {
        const ratingMap = {
            'again': Grade.Again,
            'review_again': Grade.Again,
            'hard': Grade.Hard,
            'review_hard': Grade.Hard,
            'good': Grade.Good,
            'review_good': Grade.Good,
            'easy': Grade.Easy,
            'review_easy': Grade.Easy
        };
        return ratingMap[rating] || Grade.Good;
    }

    // Метод для создания новой карточки
    createNewCard() {
        const now = new Date();
        
        if (this.scheduler) {
            // Используем ts-fsrs для создания новой карточки
            const card = createEmptyCard();
            // Новая карточка становится доступной через короткий интервал
            const result = this.scheduler.repeat(card, now, Grade.Good);
            
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
