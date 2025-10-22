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
        } catch (error) {
            this.scheduler = null;
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
        if (!this.scheduler) {
            return this.simpleFallback(cardData, rating);
        }

        try {
            const card = this.createCard(cardData);
            const grade = this.safeConvertRating(rating);
            const now = new Date();

            const schedulingCards = this.scheduler.repeat(card, now);
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
}
