import pkg from 'ts-fsrs';

const { fsrs, generatorParameters, createEmptyCard } = pkg;

export class FSRSService {
    constructor() {
        try {
            this.parameters = generatorParameters({
                request_retention: 0.9,
                maximum_interval: 36500,
                enable_fuzz: false
            });

            this.scheduler = fsrs(this.parameters);
            this.isInitialized = true;
            console.log('✅ FSRS initialized successfully');
        } catch (error) {
            console.error('❌ FSRS initialization failed:', error);
            this.scheduler = null;
            this.isInitialized = false;
        }
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
            'again': 1,
            'review_again': 1,
            'hard': 2,
            'review_hard': 2,
            'good': 3,
            'review_good': 3,
            'easy': 4,
            'review_easy': 4
        };
        return ratingMap[rating] || 3;
    }

    simpleFallback(cardData, rating) {
        const now = new Date();
        let interval;
        switch (rating) {
            case 'again':
            case 'review_again':
                interval = 1;
                break;
            case 'hard':
            case 'review_hard':
                interval = 2;
                break;
            case 'good':
            case 'review_good':
                interval = 4;
                break;
            case 'easy':
            case 'review_easy':
                interval = 7;
                break;
            default:
                interval = 3;
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
        if (!this.isInitialized || !this.scheduler) {
            const fallback = this.simpleFallback(cardData, rating);
            return fallback;
        }

        try {
            const card = this.createCard(cardData);
            const grade = this.safeConvertRating(rating);
            const now = new Date();

            const result = this.scheduler.repeat(card, now, grade);

            if (!result || !result.card) throw new Error('FSRS returned empty result');

            const fsrsCard = result.card;
            const interval = Math.max(1, Math.round(fsrsCard.scheduled_days));

            const updatedCard = {
                card: {
                    due: fsrsCard.due instanceof Date ? fsrsCard.due : new Date(now.getTime() + interval * 24 * 60 * 60 * 1000),
                    stability: fsrsCard.stability || 0.1,
                    difficulty: fsrsCard.difficulty || 5.0,
                    elapsed_days: fsrsCard.elapsed_days || 0,
                    scheduled_days: interval,
                    reps: fsrsCard.reps || 0,
                    lapses: fsrsCard.lapses || 0,
                    state: fsrsCard.state || 1,
                    last_review: now
                },
                interval: interval,
                ease: fsrsCard.stability || 0.1,
                repetitions: fsrsCard.reps || 0,
                rating: rating
            };

            return updatedCard;

        } catch (error) {
            console.error('❌ FSRS review failed, fallback used:', error);
            const fallback = this.simpleFallback(cardData, rating);
            return fallback;
        }
    }
}
