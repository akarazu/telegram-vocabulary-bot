import pkg from 'fsrs.js';
const { FSRS, createEmptyCard, generatorParameters, Rating } = pkg;

export class FSRSService {
    constructor() {
        // Настройки для быстрого запоминания
        const fastLearningParams = generatorParameters({
            request_retention: 0.8,    // 80% - чаще повторения
            maximum_interval: 365,     // Макс 1 год
            enable_short_term: true,   // Включить краткосрочные повторения
            w: [0.4, 0.9, 2.0, 0.2, 0.6, 0.3, 1.5, 0.1, 1.0, 0.5, 2.0, 0.3, 1.2, 0.6]
        });
        
        this.fsrs = new FSRS(fastLearningParams);
        console.log('✅ FSRS service initialized with FAST LEARNING parameters');
    }

    createNewCard() {
        return createEmptyCard();
    }

    reviewCard(card, rating) {
        try {
            const schedule = this.fsrs.repeat(card, new Date());
            
            let scheduledCard;
            switch(rating.toLowerCase()) {
                case 'again':
                    scheduledCard = schedule[Rating.Again];
                    break;
                case 'hard':
                    scheduledCard = schedule[Rating.Hard];
                    break;
                case 'good':
                    scheduledCard = schedule[Rating.Good];
                    break;
                case 'easy':
                    scheduledCard = schedule[Rating.Easy];
                    break;
                default:
                    scheduledCard = schedule[Rating.Good];
            }

            return {
                card: scheduledCard.card,
                reviewLog: scheduledCard.reviewLog
            };
        } catch (error) {
            console.error('❌ FSRS review error:', error);
            const fallbackCard = createEmptyCard();
            const nextReview = new Date();
            nextReview.setDate(nextReview.getDate() + 1);
            fallbackCard.due = nextReview;
            fallbackCard.interval = 1;
            
            return {
                card: fallbackCard,
                reviewLog: null
            };
        }
    }

    getIntervalDays(dueDate) {
        const now = new Date();
        const due = new Date(dueDate);
        return Math.ceil((due - now) / (1000 * 60 * 60 * 24));
    }
}
