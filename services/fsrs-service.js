import pkg from 'ts-fsrs';
const { fsrs, generatorParameters, createEmptyCard } = pkg;

export class FSRSService {
    constructor() {
        // ОПТИМИЗАЦИЯ ПАМЯТИ: Ограниченный кеш для активных пользователей
        this.userParameters = new Map();
        this.userSchedulers = new Map();
        this.MAX_USERS_CACHE = 100;
        
        // ВОССТАНОВЛЕН параметр w для точных вычислений
        this.defaultParams = generatorParameters({
            request_retention: 0.9,
            maximum_interval: 36500,
            enable_fuzz: true,
            w: [0.4, 0.6, 2.4, 5.8, 4.93, 0.94, 0.86, 0.01, 1.49, 0.14, 0.94, 2.18, 0.05, 0.34, 1.26, 0.29, 2.61]
        });
        
        this.defaultScheduler = fsrs(this.defaultParams);
        
        this.accessTimes = new Map();
        this.setupSmartCleanup();
        
        console.log('✅ FSRS Service optimized with w-parameters');
    }

    setupSmartCleanup() {
        setInterval(() => {
            const now = Date.now();
            const INACTIVE_LIMIT = 60 * 60 * 1000; // 1 час неактивности
            
            for (const [userId, lastAccess] of this.accessTimes.entries()) {
                if (now - lastAccess > INACTIVE_LIMIT && this.userParameters.size > this.MAX_USERS_CACHE) {
                    this.userParameters.delete(userId);
                    this.userSchedulers.delete(userId);
                    this.accessTimes.delete(userId);
                }
            }
        }, 30 * 60 * 1000);
    }

    getUserParameters(userId) {
        // Обновляем время доступа
        this.accessTimes.set(userId, Date.now());
        
        if (this.userParameters.has(userId)) {
            return {
                parameters: this.userParameters.get(userId),
                scheduler: this.userSchedulers.get(userId)
            };
        }
        
        // Создаем индивидуальные параметры с ВОССТАНОВЛЕННЫМ w
        const params = generatorParameters({
            request_retention: 0.9,
            maximum_interval: 36500,
            enable_fuzz: true,
            w: [0.4, 0.6, 2.4, 5.8, 4.93, 0.94, 0.86, 0.01, 1.49, 0.14, 0.94, 2.18, 0.05, 0.34, 1.26, 0.29, 2.61]
        });
        
        this.userParameters.set(userId, params);
        this.userSchedulers.set(userId, fsrs(params));
        
        return {
            parameters: params,
            scheduler: this.userSchedulers.get(userId)
        };
    }

    // ОПТИМИЗАЦИЯ: Упрощенная адаптация (только retention)
    adaptUserParameters(userId, successRate) {
        if (!this.userParameters.has(userId)) return;
        
        const params = this.userParameters.get(userId);
        
        // Сохраняем ВСЕ параметры включая w, адаптируем только retention
        if (successRate < 0.7) {
            params.request_retention = Math.min(0.95, params.request_retention + 0.05);
        } else if (successRate > 0.9) {
            params.request_retention = Math.max(0.8, params.request_retention - 0.03);
        }
        
        // Пересоздаем scheduler с обновленными параметрами
        this.userSchedulers.set(userId, fsrs(params));
    }

    // ОПТИМИЗАЦИЯ: Быстрое создание карточки
    createNewCard() {
        const now = new Date();
        return {
            due: new Date(now.getTime() + 24 * 60 * 60 * 1000),
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

    // ОПТИМИЗАЦИЯ: Быстрое создание карты
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

    // ОПТИМИЗАЦИЯ: Минимальные логи в продакшене
    async reviewCard(userId, word, cardData, rating) {
        try {
            const { scheduler } = this.getUserParameters(userId);
            const card = this.createCard(cardData);
            const grade = this.safeConvertRating(rating);
            const now = new Date();

            const schedulingCards = scheduler.repeat(card, now);
            
            if (!schedulingCards) {
                return this.simpleFallback(cardData, rating);
            }

            const fsrsCard = schedulingCards[grade];

            if (!fsrsCard) {
                return this.simpleFallback(cardData, rating);
            }

            const fsrsCardData = fsrsCard.card || fsrsCard;
            let scheduled_days = fsrsCardData.scheduled_days;
            let interval = Math.max(1, Math.round(scheduled_days));
            
            if (scheduled_days === 0 || isNaN(scheduled_days)) {
                scheduled_days = 1;
                interval = 1;
            }

            let dueDate;
            if (fsrsCardData.due && fsrsCardData.due instanceof Date && !isNaN(fsrsCardData.due.getTime())) {
                dueDate = fsrsCardData.due;
            } else {
                dueDate = new Date(now.getTime() + interval * 24 * 60 * 60 * 1000);
            }

            return {
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

        } catch (error) {
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

    // ОПТИМИЗАЦИЯ: Быстрый расчет успеваемости
    calculateUserSuccessRate(userWords) {
        const reviewedWords = userWords.filter(word => 
            word.repetitions > 0 && word.lastReview
        );
        
        if (reviewedWords.length === 0) return 0.8;
        
        let successfulReviews = 0;
        
        // ОПТИМИЗАЦИЯ: Быстрый цикл без промежуточных переменных
        for (const word of reviewedWords) {
            if (word.rating >= 3) {
                successfulReviews++;
            }
        }
        
        return successfulReviews / reviewedWords.length;
    }
}
