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
        } catch (error) {
            this.isInitialized = false;
            this.scheduler = null;
        }
    }

    reviewCard(cardData, rating) {
        if (!this.isInitialized || !this.scheduler) {
            return this.simpleFallback(cardData, rating);
        }

        try {
            const card = this.createSimpleCard(cardData);
            const grade = this.safeConvertRating(rating);
            const now = new Date();
            const result = this.scheduler.repeat(card, now, grade);
            
            if (!result || !result.card) {
                throw new Error('FSRS returned empty result');
            }

            const fsrsCard = result.card;
            
            if (!fsrsCard.scheduled_days || fsrsCard.scheduled_days <= 0) {
                throw new Error('Invalid scheduled_days from FSRS');
            }

            const interval = Math.max(1, Math.round(fsrsCard.scheduled_days));
            const due = fsrsCard.due instanceof Date ? fsrsCard.due : new Date(now.getTime() + interval * 24 * 60 * 60 * 1000);

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
            return this.simpleFallback(cardData, rating);
        }
    }

    createSimpleCard(cardData) {
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
        
        switch(rating) {
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
            interval: interval
        };
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
}
