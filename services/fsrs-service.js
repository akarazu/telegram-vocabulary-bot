// ✅ ОБНОВЛЯЕМ FSRS Service для более агрессивного запоминания
export class FSRSService {
    constructor() {
        try {
            // Используем кастомизированные параметры для быстрого запоминания
            const parameters = {
                request_retention: 0.9, // Высокий процент удержания
                maximum_interval: 36500,
                w: [
                    0.4, 0.6, 2.4, 5.8, 4.93, 0.94, 0.86, 0.01, 
                    1.49, 0.14, 0.94, 2.18, 0.05, 0.34, 1.26, 0.29, 
                    2.61, 0.0, 0.0, 0.0
                ]
            };
            this.fsrs = new FSRS(parameters);
            console.log('✅ FSRS service initialized with fast learning parameters');
        } catch (error) {
            console.error('❌ Error initializing FSRS:', error);
            this.fsrs = { 
                repeat: (card, date) => this.fallbackRepeat(card, date)
            };
        }
    }

    // Fallback метод с оптимизированными интервалами для быстрого запоминания
    fallbackRepeat(card, date) {
        const now = new Date();
        // Более агрессивные интервалы для быстрого запоминания
        const defaultIntervals = {
            [Rating.Again]: { 
                card: { 
                    due: new Date(now.getTime() + 1 * 60 * 60 * 1000), // 1 час
                    interval: 0.04 
                } 
            },
            [Rating.Hard]: { 
                card: { 
                    due: new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000), // 1 день
                    interval: 1 
                } 
            },
            [Rating.Good]: { 
                card: { 
                    due: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000), // 3 дня
                    interval: 3 
                } 
            },
            [Rating.Easy]: { 
                card: { 
                    due: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000), // 7 дней
                    interval: 7 
                } 
            }
        };
        return defaultIntervals;
    }
}
