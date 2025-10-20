import pkg from 'ts-fsrs';
const { fsrs, generatorParameters, createEmptyCard } = pkg;

export class FSRSService {
    constructor() {
        try {
            // ✅ ПРОСТЫЕ И ЧЕТКИЕ ПАРАМЕТРЫ
            this.parameters = generatorParameters({
                request_retention: 0.9,
                maximum_interval: 36500,
                enable_fuzz: false
            });
            
            this.scheduler = fsrs(this.parameters);
            this.isInitialized = true;
            console.log('✅ REAL FSRS service initialized successfully');
        } catch (error) {
            console.error('❌ CRITICAL: FSRS initialization failed:', error);
            this.isInitialized = false;
            this.scheduler = null;
        }
    }

    // ✅ УПРОЩЕННЫЙ И НАДЕЖНЫЙ МЕТОД ДЛЯ ПОВТОРЕНИЯ
    reviewCard(cardData, rating) {
        // ЕСЛИ FSRS НЕ РАБОТАЕТ - СРАЗУ FALLBACK
        if (!this.isInitialized || !this.scheduler) {
            console.log('🔄 FSRS not available, using immediate fallback');
            return this.simpleFallback(cardData, rating);
        }

        try {
            console.log(`🎯 Starting FSRS review for rating: ${rating}`);
            
            // 1. СОЗДАЕМ КАРТОЧКУ ИЗ ДАННЫХ
            const card = this.createSimpleCard(cardData);
            console.log('📊 Card created:', {
                due: card.due,
                stability: card.stability,
                difficulty: card.difficulty,
                reps: card.reps
            });

            // 2. КОНВЕРТИРУЕМ РЕЙТИНГ (ИСПОЛЬЗУЕМ ЧИСЛА ВМЕСТО Grade)
            const grade = this.safeConvertRating(rating);
            console.log(`📈 Rating: ${rating} -> Grade: ${grade}`);

            // 3. ВЫЗЫВАЕМ FSRS
            const now = new Date();
            const result = this.scheduler.repeat(card, now, grade);
            
            console.log('🔍 FSRS raw result:', result);

            // 4. ПРОВЕРЯЕМ РЕЗУЛЬТАТ
            if (!result || !result.card) {
                throw new Error('FSRS returned empty result');
            }

            const fsrsCard = result.card;
            
            // 5. ПРОВЕРЯЕМ КРИТИЧЕСКИЕ ПОЛЯ
            if (!fsrsCard.scheduled_days || fsrsCard.scheduled_days <= 0) {
                throw new Error('Invalid scheduled_days from FSRS');
            }

            const interval = Math.max(1, Math.round(fsrsCard.scheduled_days));
            const due = fsrsCard.due instanceof Date ? fsrsCard.due : new Date(now.getTime() + interval * 24 * 60 * 60 * 1000);

            console.log(`✅ FSRS SUCCESS: interval=${interval} days`);

            return {
                card: {
                    due: due,
                    stability: fsrsCard.stability || 0.1,
                    difficulty: fsrsCard.difficulty || 5.0,
                    elapsed_days: fsrsCard.elapsed_days || 0,
                    scheduled_days: interval,
                    reps: fsrsCard.reps || 0,
                    lapses: fsrsCard.lapses || 0,
                    state: fsrsCard.state || 1,
                    last_review: now
                },
                interval: interval
            };

        } catch (error) {
            console.error('❌ FSRS error:', error.message);
            console.log('🔄 Falling back to simple algorithm');
            return this.simpleFallback(cardData, rating);
        }
    }

    // ✅ ПРОСТОЙ И НАДЕЖНЫЙ МЕТОД СОЗДАНИЯ КАРТОЧКИ
    createSimpleCard(cardData) {
        const card = createEmptyCard();
        const now = new Date();
        
        // БАЗОВЫЕ ЗНАЧЕНИЯ
        card.due = cardData.due ? new Date(cardData.due) : now;
        card.stability = cardData.stability || 0.1;
        card.difficulty = cardData.difficulty || 5.0;
        card.elapsed_days = cardData.elapsed_days || 0;
        card.scheduled_days = cardData.scheduled_days || 1;
        card.reps = cardData.reps || 0;
        card.lapses = cardData.lapses || 0;
        card.state = cardData.state || 1;
        card.last_review = cardData.last_review ? new Date(cardData.last_review) : now;
        
        return card;
    }

    // ✅ ПРОСТАЯ И БЕЗОПАСНАЯ КОНВЕРТАЦИЯ РЕЙТИНГА (ИСПОЛЬЗУЕМ ЧИСЛА)
    safeConvertRating(rating) {
        // FSRS Grades: 1=Again, 2=Hard, 3=Good, 4=Easy
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
        
        return ratingMap[rating] || 3; // По умолчанию Good (3)
    }

    // ✅ ПРОСТОЙ И ЭФФЕКТИВНЫЙ FALLBACK
    simpleFallback(cardData, rating) {
        const now = new Date();
        let interval;
        
        switch(rating) {
            case 'again':
            case 'review_again':
                interval = 1; // 1 день
                break;
            case 'hard':
            case 'review_hard':
                interval = 2; // 2 дня
                break;
            case 'good':
            case 'review_good':
                interval = 4; // 4 дня
                break;
            case 'easy':
            case 'review_easy':
                interval = 7; // 7 дней
                break;
            default:
                interval = 3; // 3 дня по умолчанию
        }

        console.log(`🔄 Simple fallback: ${rating} -> ${interval} days`);

        const result = {
            card: {
                due: new Date(now.getTime() + interval * 24 * 60 * 60 * 1000),
                stability: interval * 0.5,
                difficulty: 5.0,
                elapsed_days: interval,
                scheduled_days: interval,
                reps: (cardData.reps || 0) + 1,
                lapses: rating.includes('again') ? (cardData.lapses || 0) + 1 : (cardData.lapses || 0),
                state: 1,
                last_review: now
            },
            interval: interval
        };

        console.log('📊 Fallback result:', result);
        return result;
    }

    // ✅ ПРОСТОЙ МЕТОД ДЛЯ НОВЫХ КАРТОЧЕК
    createNewCard() {
        const now = new Date();
        const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        
        return {
            due: tomorrow,
            stability: 0.1,
            difficulty: 5.0,
            elapsed_days: 0,
            scheduled_days: 1,
            reps: 0,
            lapses: 0,
            state: 1,
            last_review: now
        };
    }
}
