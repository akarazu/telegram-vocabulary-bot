// ✅ УПРОЩЕННЫЙ FSRS Service для Railway деплоя
// Используем собственную реализацию алгоритма повторений

export class FSRSService {
    constructor() {
        try {
            // Параметры для быстрого запоминания
            this.parameters = {
                request_retention: 0.9, // Высокий процент удержания
                easyBonus: 1.3,
                hardFactor: 1.2
            };
            console.log('✅ FSRS service initialized with custom learning algorithm');
        } catch (error) {
            console.error('❌ Error initializing FSRS:', error);
        }
    }

    // Основной метод для повторения карточки
    reviewCard(cardData, rating) {
        try {
            return this.customRepeat(cardData, rating);
        } catch (error) {
            console.error('❌ Error in reviewCard, using fallback:', error);
            return this.fallbackRepeat(cardData, rating);
        }
    }

    // Кастомная реализация алгоритма повторений
    customRepeat(cardData, rating) {
        const now = new Date();
        let due, interval, stability, difficulty;
        
        const currentInterval = cardData.interval || 1;
        const currentStability = cardData.stability || 0.1;
        const currentDifficulty = cardData.difficulty || 5.0;
        const reps = (cardData.reps || 0) + 1;
        const lapses = cardData.lapses || 0;

        switch (rating) {
            case 'again':
            case 'review_again':
                // При "Забыл" - повторяем через короткий интервал
                interval = 0.1; // ~2.4 часа
                stability = Math.max(0.1, currentStability * 0.5);
                difficulty = Math.min(10, currentDifficulty + 1.0);
                due = new Date(now.getTime() + 2.4 * 60 * 60 * 1000);
                break;

            case 'hard':
            case 'review_hard':
                // При "Трудно" - небольшой интервал
                interval = Math.max(0.5, currentInterval * 0.8);
                stability = currentStability * 1.2;
                difficulty = Math.min(10, currentDifficulty + 0.2);
                due = new Date(now.getTime() + interval * 24 * 60 * 60 * 1000);
                break;

            case 'good':
            case 'review_good':
                // При "Хорошо" - стандартный прогресс
                interval = Math.max(1, currentInterval * 2.5);
                stability = currentStability * 2.0;
                difficulty = currentDifficulty;
                due = new Date(now.getTime() + interval * 24 * 60 * 60 * 1000);
                break;

            case 'easy':
            case 'review_easy':
                // При "Легко" - большой интервал
                interval = Math.max(2, currentInterval * 4.0);
                stability = currentStability * 3.0;
                difficulty = Math.max(1, currentDifficulty - 0.3);
                due = new Date(now.getTime() + interval * 24 * 60 * 60 * 1000);
                break;

            default:
                // По умолчанию - как "Хорошо"
                interval = 1;
                stability = 1.0;
                difficulty = 5.0;
                due = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);
        }

        // Ограничиваем интервал разумными пределами
        interval = Math.max(0.1, Math.min(interval, 365)); // от 2.4 часов до 1 года

        return {
            due: due,
            stability: stability,
            difficulty: difficulty,
            elapsed_days: interval,
            scheduled_days: interval,
            reps: reps,
            lapses: rating === 'again' || rating === 'review_again' ? lapses + 1 : lapses,
            state: 1, // active
            last_review: now,
            interval: interval
        };
    }

    // Fallback метод на случай ошибок
    fallbackRepeat(cardData, rating) {
        const now = new Date();
        let interval, due;

        switch (rating) {
            case 'again':
            case 'review_again':
                interval = 0.1; // 2.4 часа
                due = new Date(now.getTime() + 2.4 * 60 * 60 * 1000);
                break;
            case 'hard':
            case 'review_hard':
                interval = 1; // 1 день
                due = new Date(now.getTime() + 24 * 60 * 60 * 1000);
                break;
            case 'good':
            case 'review_good':
                interval = 3; // 3 дня
                due = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
                break;
            case 'easy':
            case 'review_easy':
                interval = 7; // 7 дней
                due = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
                break;
            default:
                interval = 1;
                due = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        }

        return {
            due: due,
            stability: interval,
            difficulty: 5.0,
            elapsed_days: interval,
            scheduled_days: interval,
            reps: (cardData.reps || 0) + 1,
            lapses: rating === 'again' || rating === 'review_again' ? (cardData.lapses || 0) + 1 : (cardData.lapses || 0),
            state: 1,
            last_review: now,
            interval: interval
        };
    }

    // Метод для создания новой карточки (при первом изучении слова)
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
            last_review: now,
            interval: 1
        };
    }
}
