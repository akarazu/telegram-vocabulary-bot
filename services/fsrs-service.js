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
            console.log('✅ REAL FSRS service initialized with ts-fsrs');
        } catch (error) {
            console.error('❌ Error initializing REAL FSRS:', error);
            this.scheduler = null;
        }
    }

    // Основной метод для повторения карточки
    reviewCard(cardData, rating) {
        // ✅ СНАЧАЛА ПРОВЕРЯЕМ FSRS
        if (!this.scheduler) {
            console.log('🔄 FSRS not available, using fallback');
            return this.fallbackRepeat(cardData, rating);
        }

        try {
            const card = this.createCardFromData(cardData);
            const grade = this.convertRatingToGrade(rating);
            
            console.log(`🎯 FSRS review: rating=${rating}, grade=${grade}`);
            
            const result = this.scheduler.repeat(card, new Date(), grade);

            // ✅ ВАЖНО: ПРОВЕРЯЕМ РЕЗУЛЬТАТ
            if (!result || !result.card) {
                console.error('❌ FSRS returned empty result, using fallback');
                return this.fallbackRepeat(cardData, rating);
            }

            const fsrsCard = result.card;

            // ✅ ВАЖНО: ПРОВЕРЯЕМ ВСЕ КРИТИЧЕСКИЕ ПОЛЯ
            const interval = Math.max(1, Math.round(fsrsCard.scheduled_days || 1));
            const due = fsrsCard.due || new Date(Date.now() + interval * 24 * 60 * 60 * 1000);

            console.log(`✅ FSRS success: interval=${interval} days`);

            return {
                due: due,
                stability: fsrsCard.stability || 0.1,
                difficulty: fsrsCard.difficulty || 5.0,
                elapsed_days: fsrsCard.elapsed_days || 0,
                scheduled_days: fsrsCard.scheduled_days || interval,
                reps: fsrsCard.reps || 0,
                lapses: fsrsCard.lapses || 0,
                state: fsrsCard.state || 1,
                last_review: new Date(),
                interval: interval
            };

        } catch (error) {
            console.error('❌ Error in REAL FSRS review:', error);
            return this.fallbackRepeat(cardData, rating);
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
        
        return ratingMap[rating] || 3; // По умолчанию Good
    }

    // Создание карточки из данных
    createCardFromData(cardData) {
        const card = createEmptyCard();
        
        // ✅ БЕЗОПАСНОЕ ЗАПОЛНЕНИЕ ПОЛЕЙ
        if (cardData.due) {
            try {
                card.due = new Date(cardData.due);
            } catch (e) {
                card.due = new Date();
            }
        }
        
        if (cardData.stability) card.stability = cardData.stability;
        if (cardData.difficulty) card.difficulty = cardData.difficulty;
        if (cardData.elapsed_days) card.elapsed_days = cardData.elapsed_days;
        if (cardData.scheduled_days) card.scheduled_days = cardData.scheduled_days;
        if (cardData.reps) card.reps = cardData.reps;
        if (cardData.lapses) card.lapses = cardData.lapses;
        if (cardData.state) card.state = cardData.state;
        
        if (cardData.last_review) {
            try {
                card.last_review = new Date(cardData.last_review);
            } catch (e) {
                card.last_review = new Date();
            }
        }
        
        return card;
    }

    // ✅ НАДЕЖНЫЙ Fallback метод
    fallbackRepeat(cardData, rating) {
        const now = new Date();
        let interval;

        switch (rating) {
            case 'again': 
            case 'review_again': 
                interval = 0.1; // 2.4 часа
                break;
            case 'hard': 
            case 'review_hard': 
                interval = 1; // 1 день
                break;
            case 'good': 
            case 'review_good': 
                interval = 3; // 3 дня
                break;
            case 'easy': 
            case 'review_easy': 
                interval = 7; // 7 дней
                break;
            default: 
                interval = 1;
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
        
        // ✅ ПРОСТО ВСЕГДА ИСПОЛЬЗУЕМ FALLBACK ДЛЯ НОВЫХ КАРТОЧЕК
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
