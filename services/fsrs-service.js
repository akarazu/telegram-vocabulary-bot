import pkg from 'fsrs.js';
const { FSRS, createEmptyCard, Rating } = pkg;

export class FSRSService {
    constructor() {
        try {
            // Используем стандартные параметры FSRS
            // Если нужно кастомизировать, можно передать параметры вручную
            this.fsrs = new FSRS();
            console.log('✅ FSRS service initialized with default parameters');
        } catch (error) {
            console.error('❌ Error initializing FSRS:', error);
            // Fallback: создаем базовый экземпляр
            this.fsrs = { 
                repeat: (card, date) => this.fallbackRepeat(card, date)
            };
        }
    }

    // Fallback метод если FSRS не инициализирован
    fallbackRepeat(card, date) {
        const now = new Date();
        const defaultIntervals = {
            [Rating.Again]: { card: { due: new Date(now.getTime() + 24 * 60 * 60 * 1000), interval: 1 } },
            [Rating.Hard]: { card: { due: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000), interval: 3 } },
            [Rating.Good]: { card: { due: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000), interval: 7 } },
            [Rating.Easy]: { card: { due: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000), interval: 14 } }
        };
        return defaultIntervals;
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
            // Fallback: создаем новую карточку при ошибке
            const fallbackCard = createEmptyCard();
            const nextReview = new Date();
            
            // Fallback интервалы для быстрого запоминания
            switch(rating.toLowerCase()) {
                case 'again':
                    nextReview.setDate(nextReview.getDate() + 1);
                    fallbackCard.interval = 1;
                    break;
                case 'hard':
                    nextReview.setDate(nextReview.getDate() + 2);
                    fallbackCard.interval = 2;
                    break;
                case 'good':
                    nextReview.setDate(nextReview.getDate() + 4);
                    fallbackCard.interval = 4;
                    break;
                case 'easy':
                    nextReview.setDate(nextReview.getDate() + 7);
                    fallbackCard.interval = 7;
                    break;
                default:
                    nextReview.setDate(nextReview.getDate() + 4);
                    fallbackCard.interval = 4;
            }
            
            fallbackCard.due = nextReview;
            
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
