import pkg from 'ts-fsrs';
const { fsrs, generatorParameters, createEmptyCard } = pkg;

export class FSRSService {
    constructor() {
        // Храним параметры для каждого пользователя
        this.userParameters = new Map();
        this.userSchedulers = new Map();
        
        console.log('✅ FSRS Service initialized with user-specific adaptation');
    }

    // Получаем или создаем параметры для пользователя
    getUserParameters(userId) {
        if (!this.userParameters.has(userId)) {
            // Параметры по умолчанию, но они будут адаптироваться
            const params = generatorParameters({
                request_retention: 0.9,
                maximum_interval: 36500,
                enable_fuzz: true, // Включим фузз для разнообразия
                w: [0.4, 0.6, 2.4, 5.8, 4.93, 0.94, 0.86, 0.01, 1.49, 0.14, 0.94, 2.18, 0.05, 0.34, 1.26, 0.29, 2.61]
            });
            
            this.userParameters.set(userId, params);
            this.userSchedulers.set(userId, fsrs(params));
        }
        
        return {
            parameters: this.userParameters.get(userId),
            scheduler: this.userSchedulers.get(userId)
        };
    }

    // Адаптируем параметры на основе успехов пользователя
    adaptUserParameters(userId, successRate) {
        if (!this.userParameters.has(userId)) return;
        
        const params = this.userParameters.get(userId);
        
        // Адаптируем retention rate на основе успехов
        if (successRate < 0.7) {
            // Низкий успех - увеличиваем retention для более частых повторений
            params.request_retention = Math.min(0.95, params.request_retention + 0.05);
        } else if (successRate > 0.9) {
            // Высокий успех - уменьшаем retention для более редких повторений
            params.request_retention = Math.max(0.8, params.request_retention - 0.03);
        }
        
        console.log(`🔄 Adapted parameters for user ${userId}: retention=${params.request_retention.toFixed(2)}, successRate=${successRate.toFixed(2)}`);
        
        // Обновляем scheduler с новыми параметрами
        this.userSchedulers.set(userId, fsrs(params));
    }

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

    safeConvertRating(rating) {
        const ratingMap = {
            'again': 1, 'review_again': 1,
            'hard': 2, 'review_hard': 2,
            'good': 3, 'review_good': 3,
            'easy': 4, 'review_easy': 4
        };
        return ratingMap[rating] || 3;
    }

    createCard(cardData) {
        const card = createEmptyCard();
        const now = new Date();

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

    async reviewCard(userId, word, cardData, rating) {
        try {
            const { scheduler } = this.getUserParameters(userId);
            const card = this.createCard(cardData);
            const grade = this.safeConvertRating(rating);
            const now = new Date();

            console.log(`🎯 FSRS review for user ${userId}, word: ${word.english}, rating: ${rating}, grade: ${grade}`);
            console.log('📝 Card before FSRS:', {
                due: card.due,
                stability: card.stability,
                difficulty: card.difficulty,
                reps: card.reps,
                lapses: card.lapses
            });

            const schedulingCards = scheduler.repeat(card, now);
            
            if (!schedulingCards) {
                console.log('❌ schedulingCards is undefined');
                return this.simpleFallback(cardData, rating);
            }

            const fsrsCard = schedulingCards[grade];
            console.log('🔑 Available keys in schedulingCards:', Object.keys(schedulingCards));
            console.log('🎯 Selected FSRS card:', fsrsCard);

            if (!fsrsCard) {
                console.log('❌ No FSRS card for grade:', grade);
                return this.simpleFallback(cardData, rating);
            }

            const fsrsCardData = fsrsCard.card || fsrsCard;
            console.log('🎯 Extracted FSRS card data:', fsrsCardData);

            let scheduled_days = fsrsCardData.scheduled_days;
            let interval = Math.max(1, Math.round(scheduled_days));
            
            if (scheduled_days === 0 || isNaN(scheduled_days)) {
                console.log('⚠️ scheduled_days is 0 or NaN, setting to 1');
                scheduled_days = 1;
                interval = 1;
            }

            let dueDate;
            if (fsrsCardData.due && fsrsCardData.due instanceof Date && !isNaN(fsrsCardData.due.getTime())) {
                dueDate = fsrsCardData.due;
                console.log('✅ Using FSRS due date:', dueDate);
            } else {
                dueDate = new Date(now.getTime() + interval * 24 * 60 * 60 * 1000);
                console.log('⚠️ Using calculated due date:', dueDate);
            }

            const updatedCard = {
                due: dueDate,
                stability: fsrsCardData.stability || 0.1,
                difficulty: fsrsCardData.difficulty || 5.0,
                elapsed_days: fsrsCardData.elapsed_days || 0,
                scheduled_days: scheduled_days,
                reps: fsrsCardData.reps || 0,
                lapses: fsrsCardData.lapses || 0,
                state: fsrsCardData.state || 1,
                last_review: now,
                interval: interval,
                ease: fsrsCardData.stability || 0.1,
                repetitions: fsrsCardData.reps || 0
            };

            console.log('✅ Final updated card:', updatedCard);
            return updatedCard;

        } catch (error) {
            console.error('❌ FSRS review failed:', error);
            return this.simpleFallback(cardData, rating);
        }
    }

    simpleFallback(cardData, rating) {
        const now = new Date();
        let interval;
        switch (rating) {
            case 'again': case 'review_again': interval = 1; break;
            case 'hard': case 'review_hard': interval = 2; break;
            case 'good': case 'review_good': interval = 4; break;
            case 'easy': case 'review_easy': interval = 7; break;
            default: interval = 3;
        }

        return {
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
            interval: interval,
            ease: interval * 0.5,
            repetitions: (cardData.reps || 0) + 1,
            rating: rating
        };
    }

    // Анализ успеваемости пользователя
    calculateUserSuccessRate(userWords) {
        const reviewedWords = userWords.filter(word => 
            word.repetitions > 0 && word.lastReview
        );
        
        if (reviewedWords.length === 0) return 0.8; // По умолчанию
        
        let totalReviews = 0;
        let successfulReviews = 0;
        
        reviewedWords.forEach(word => {
            // Считаем рейтинг выше 2 как успешный повтор
            if (word.rating >= 3) {
                successfulReviews++;
            }
            totalReviews++;
        });
        
        const successRate = totalReviews > 0 ? successfulReviews / totalReviews : 0.8;
        console.log(`📊 User success rate: ${successRate.toFixed(2)} (${successfulReviews}/${totalReviews})`);
        
        return successRate;
    }
}
