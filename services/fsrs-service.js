import pkg from 'ts-fsrs';
const { fsrs, generatorParameters, createEmptyCard, Grade } = pkg;

export class FSRSService {
    constructor() {
        try {
            this.parameters = generatorParameters({
                request_retention: 0.85,
                maximum_interval: 365,
                enable_fuzz: true
            });
            
            this.scheduler = fsrs(this.parameters);
            this.Grade = Grade; // ✅ Сохраняем Grade в свойство класса
            console.log('✅ REAL FSRS service initialized with ts-fsrs');
        } catch (error) {
            console.error('❌ Error initializing REAL FSRS:', error);
            this.scheduler = null;
            this.Grade = null;
        }
    }

    // Конвертация наших рейтингов в FSRS Grade
    convertRatingToGrade(rating) {
        // ✅ ПРОСТАЯ И НАДЕЖНАЯ КОНВЕРТАЦИЯ
        const ratingMap = {
            'again': 1,
            'review_again': 1,
            'hard': 2,
            'review_hard': 2,
            'good': 3,
            'review_good': 3,
            'easy': 4,
            'review_easy': 4
        };
        
        const gradeValue = ratingMap[rating] || 3; // По умолчанию Good
        
        console.log(`🔧 Rating conversion: ${rating} -> ${gradeValue}`);
        return gradeValue;
    }

    // Основной метод для повторения карточки
    reviewCard(cardData, rating) {
        if (!this.scheduler) {
            console.log('🔄 Using fallback FSRS');
            return this.fallbackRepeat(cardData, rating);
        }

        try {
            const card = this.createCardFromData(cardData);
            const grade = this.convertRatingToGrade(rating);
            
            console.log(`🎯 FSRS review: rating=${rating}, grade=${grade}`);
            
            const result = this.scheduler.repeat(card, new Date(), grade);

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
                interval: Math.max(1, Math.round(result.card.scheduled_days || 1))
            };

        } catch (error) {
            console.error('❌ Error in REAL FSRS review:', error);
            return this.fallbackRepeat(cardData, rating);
        }
    }

    // Остальные методы без изменений
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

    // Fallback метод на случай ошибок
    fallbackRepeat(cardData, rating) {
        const now = new Date();
        let interval;

        switch (rating) {
            case 'again': case 'review_again': interval = 0.1; break;   // 2.4 часа
            case 'hard': case 'review_hard': interval = 1; break;       // 1 день
            case 'good': case 'review_good': interval = 3; break;       // 3 дня
            case 'easy': case 'review_easy': interval = 7; break;       // 7 дней
            default: interval = 1;
        }

        console.log(`🔄 Fallback FSRS: ${rating} -> ${interval} days`);

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

    createNewCard() {
        const now = new Date();
        
        if (this.scheduler) {
            const card = createEmptyCard();
            const result = this.scheduler.repeat(card, now, 3); // Grade.Good = 3
            
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
                interval: Math.max(1, Math.round(result.card.scheduled_days || 1))
            };
        } else {
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
}
