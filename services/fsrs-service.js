import { FSRS, createEmptyCard, generatorParameters, Rating } from 'fsrs.js';

export class FSRSService {
    constructor() {
        // Используем дефолтные параметры для простоты
        this.fsrs = new FSRS();
        console.log('✅ FSRS service initialized');
    }

    // Создает новую карточку для слова
    createNewCard() {
        return createEmptyCard();
    }

    // Обновляет карточку после повторения и возвращает новые данные
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
            nextReview.setDate(nextReview.getDate() + 1);
            fallbackCard.due = nextReview;
            fallbackCard.interval = 1;
            
            return {
                card: fallbackCard,
                reviewLog: null
            };
        }
    }

    // Вспомогательный метод для получения интервала в днях
    getIntervalDays(dueDate) {
        const now = new Date();
        const due = new Date(dueDate);
        return Math.ceil((due - now) / (1000 * 60 * 60 * 24));
    }
}
