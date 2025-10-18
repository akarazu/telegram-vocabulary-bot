import TelegramBot from 'node-telegram-bot-api';
import { GoogleSheetsService } from './services/google-sheets.js';
import { YandexDictionaryService } from './services/yandex-dictionary-service.js';
import { CambridgeDictionaryService } from './services/cambridge-dictionary-service.js';
import { FSRSService } from './services/fsrs-service.js';

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// Инициализация сервисов с обработкой ошибок
let sheetsService, yandexService, cambridgeService, fsrsService;

try {
    sheetsService = new GoogleSheetsService();
    yandexService = new YandexDictionaryService();
    cambridgeService = new CambridgeDictionaryService();
    fsrsService = new FSRSService();
    console.log('✅ Все сервисы успешно инициализированы');
} catch (error) {
    console.error('❌ Ошибка инициализации сервисов:', error);
    // Создаем заглушки чтобы бот не падал
    sheetsService = { initialized: false };
    yandexService = { getTranscriptionAndAudio: () => ({ transcription: '', audioUrl: '' }) };
    cambridgeService = { getWordData: () => ({ meanings: [] }) };
    fsrsService = new FSRSService(); // FSRS всегда работает
}

// Хранилище состояний пользователей
const userStates = new Map();

// Хранилище для планировщика нотификаций
const notificationScheduler = new Map();

// ✅ ДОБАВЬТЕ ЗДЕСЬ: Хранилище для отслеживания показанных сегодня слов
const shownNewWordsToday = new Map();

// ✅ ФУНКЦИЯ: Сброс показанных слов в начале дня
function resetShownWordsDaily() {
    const now = new Date();
    const currentHour = now.getHours();
    
    // Сбрасываем в 4 утра каждый день
    if (currentHour === 4) {
        shownNewWordsToday.clear();
        console.log('🔄 Сброшены показанные слова на новый день');
    }
}

// Запускаем ежечасную проверку
setInterval(resetShownWordsDaily, 60 * 60 * 1000);

// ✅ ФУНКЦИЯ: Получение НЕ показанных сегодня слов с учетом лимита
async function getUnshownNewWords(chatId) {
    if (!sheetsService.initialized) {
        return [];
    }
    
    try {
        const userWords = await sheetsService.getUserWords(chatId);
        
        // Получаем слова, показанные сегодня этому пользователю
        const shownToday = shownNewWordsToday.get(chatId) || new Set();
        const learnedToday = getLearnedToday(chatId);
        const DAILY_LIMIT = 5;
        
        console.log(`🔍 Поиск новых слов для ${chatId}, показано: ${shownToday.size}, изучено: ${learnedToday}/${DAILY_LIMIT}`);

        // Если достигнут лимит - возвращаем пустой массив
        if (learnedToday >= DAILY_LIMIT) {
            console.log(`🚫 Достигнут дневной лимит: ${learnedToday}/${DAILY_LIMIT}`);
            return [];
        }

        // ✅ ИЗМЕНЕНИЕ: Ищем слова которые НИКОГДА не изучались (интервал = 1 день)
        // и еще не показывались сегодня
        const newWords = userWords.filter(word => {
            if (!word.nextReview || word.status !== 'active') return false;
            
            try {
                // Слово считается новым если:
                // 1. Интервал = 1 день (первое повторение)
                // 2. Еще не показывалось сегодня
                const isFirstInterval = word.interval === 1;
                const isNotShownToday = !shownToday.has(word.english.toLowerCase());
                
                if (isFirstInterval && isNotShownToday) {
                    console.log(`✅ Слово "${word.english}" - новое (интервал: ${word.interval}, не показано сегодня)`);
                }
                
                return isFirstInterval && isNotShownToday;
            } catch (error) {
                console.error(`❌ Ошибка проверки слова "${word.english}"`);
                return false;
            }
        });

        console.log(`📊 Найдено потенциально новых слов: ${newWords.length}`);

        // Сортируем по дате создания (сначала новые)
        newWords.sort((a, b) => new Date(b.createdDate) - new Date(a.createdDate));

        // Ограничиваем количеством оставшихся слов до лимита
        const remainingSlots = DAILY_LIMIT - learnedToday;
        const result = newWords.slice(0, remainingSlots);
        
        console.log(`🎯 Доступно для изучения: ${result.length} слов`);
        return result;
        
    } catch (error) {
        console.error('❌ Error getting unshown new words:', error);
        return [];
    }
}

// ✅ ФУНКЦИЯ: Отметка слова как показанного
function markWordAsShown(chatId, englishWord) {
    if (!shownNewWordsToday.has(chatId)) {
        shownNewWordsToday.set(chatId, new Set());
    }
    
    const userShownWords = shownNewWordsToday.get(chatId);
    userShownWords.add(englishWord.toLowerCase());
    console.log(`📝 Слово "${englishWord}" отмечено как показанное для ${chatId}`);
}

// ✅ ФУНКЦИЯ: Получение количества новых слов для изучения
async function getNewWordsCount(chatId) {
    if (!sheetsService.initialized) {
        return 0;
    }
    
    try {
        const newWords = await getUnshownNewWords(chatId);
        return newWords.length;
    } catch (error) {
        console.error('❌ Error getting new words count:', error);
        return 0;
    }
}

// Хранилище для отслеживания дневного лимита изученных слов
const dailyLearnedWords = new Map();

// ✅ ФУНКЦИЯ: Сброс дневного лимита
function resetDailyLimit() {
    const now = new Date();
    const currentHour = now.getHours();
    
    // Сбрасываем в 4 утра каждый день
    if (currentHour === 4) {
        dailyLearnedWords.clear();
        console.log('🔄 Сброшен дневной лимит изучения слов');
    }
}

// Запускаем ежечасную проверку
setInterval(resetDailyLimit, 60 * 60 * 1000);

// ✅ ФУНКЦИЯ: Получение количества изученных слов сегодня
function getLearnedToday(chatId) {
    if (!dailyLearnedWords.has(chatId)) {
        dailyLearnedWords.set(chatId, new Set());
    }
    return dailyLearnedWords.get(chatId).size;
}

// ✅ ФУНКЦИЯ: Отметка слова как изученного сегодня
function markWordAsLearnedToday(chatId, englishWord) {
    if (!dailyLearnedWords.has(chatId)) {
        dailyLearnedWords.set(chatId, new Set());
    }
    
    const userLearnedWords = dailyLearnedWords.get(chatId);
    userLearnedWords.add(englishWord.toLowerCase());
    console.log(`📝 Слово "${englishWord}" отмечено как изученное сегодня для ${chatId}`);
}

// ✅ ФУНКЦИЯ: Проверка достигнут ли лимит
function isDailyLimitReached(chatId) {
    const learnedToday = getLearnedToday(chatId);
    const DAILY_LIMIT = 5;
    return learnedToday >= DAILY_LIMIT;
}

// Главное меню
function getMainMenu() {
    return {
        reply_markup: {
            keyboard: [
                ['➕ Добавить новое слово', '📚 Повторить слова'],
                ['🆕 Новые слова', '📊 Статистика']
            ],
            resize_keyboard: true
        }
    };
}

// Клавиатура с кнопкой прослушивания
function getListeningKeyboard(audioId) {
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: '🔊 Прослушать произношение', callback_data: `audio_${audioId}` }],
                [{ text: '➡️ Выбрать перевод', callback_data: 'enter_translation' }]
            ]
        }
    };
}

// Клавиатура действий после прослушивания
function getAfterAudioKeyboard() {
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: '✏️ Выбрать перевод', callback_data: 'enter_translation' }]
            ]
        }
    };
}

// Клавиатура для ввода примера с кнопкой "Пропустить"
function getExampleInputKeyboard() {
    return {
        reply_markup: {
            keyboard: [
                ['⏭️ Пропустить'],
                ['➕ Добавить новое слово']
            ],
            resize_keyboard: true
        }
    };
}

// Клавиатура для выбора переводов с кнопкой "Подробнее" для всех переводов
function getTranslationSelectionKeyboard(translations, meanings, selectedIndices = []) {
    const translationButtons = [];
    translations.forEach((translation, index) => {
        const isSelected = selectedIndices.includes(index);
        let numberEmoji;
        if (index < 9) {
            numberEmoji = `${index + 1}️⃣`;
        } else {
            const number = index + 1;
            const digits = number.toString().split('');
            numberEmoji = digits.map(digit => {
                const digitEmojis = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];
                return digitEmojis[parseInt(digit)];
            }).join('');
        }
        const emoji = isSelected ? '✅' : numberEmoji;
        
        // Находим английское значение для этого перевода
        const meaningForTranslation = meanings.find(meaning => meaning.translation === translation);
        const englishDefinition = meaningForTranslation?.englishDefinition || '';
        
        // Основная кнопка с переводом
        const mainButtonText = `${emoji} ${translation}`;
        
        // Всегда создаем две кнопки: основную и "Подробнее"
        const row = [
            { text: mainButtonText, callback_data: `toggle_translation_${index}` },
            { text: '🔍 Подробнее', callback_data: `details_${index}` }
        ];
        translationButtons.push(row);
    });

    const actionButtons = [];
    if (selectedIndices.length > 0) {
        actionButtons.push([
            { text: `💾 Сохранить (${selectedIndices.length})`, callback_data: 'save_selected_translations' }
        ]);
    }
    actionButtons.push([
        { text: '✏️ Добавить свой перевод', callback_data: 'custom_translation' },
        { text: '🔙 Отменить', callback_data: 'cancel_translation' }
    ]);

    return {
        reply_markup: {
            inline_keyboard: [
                ...translationButtons,
                ...actionButtons
            ]
        }
    };
}

// Клавиатура для повторения слов
function getReviewKeyboard() {
    return {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '😣 Забыл', callback_data: 'review_again' },
                    { text: '😓 Трудно', callback_data: 'review_hard' }
                ],
                [
                    { text: '😊 Хорошо', callback_data: 'review_good' },
                    { text: '🎉 Легко', callback_data: 'review_easy' }
                ],
                [
                    { text: '⏭️ Следующее слово', callback_data: 'skip_review' }
                ]
            ]
        }
    };
}

// Клавиатура для изучения новых слов
function getNewWordsKeyboard() {
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: '✅ Выучил', callback_data: 'learned_word' }],
                [{ text: '🔄 Нужно повторить', callback_data: 'need_repeat_word' }],
                [{ text: '⏭️ Следующее слово', callback_data: 'skip_new_word' }],
                [{ text: '❌ Завершить изучение', callback_data: 'end_learning' }]
            ]
        }
    };
}

// Функция для принудительного показа меню
async function showMainMenu(chatId, text = '') {
    try {
        if (text && text.trim() !== '') {
            return await bot.sendMessage(chatId, text, getMainMenu());
        } else {
            return await bot.sendMessage(chatId, 'Выберите действие:', getMainMenu());
        }
    } catch (error) {
        console.error('❌ Error showing main menu:', error);
        // Пытаемся отправить простой текст если клавиатура не работает
        try {
            await bot.sendMessage(chatId, text || 'Выберите действие из меню:');
        } catch (e) {
            console.error('❌ Critical error sending message:', e);
        }
    }
}

// ✅ ФУНКЦИЯ: Сохранение с JSON структурой
async function saveWordWithMeanings(chatId, userState, selectedTranslations) {
    console.log('💾 Saving word with meanings:', { 
        word: userState.tempWord, 
        selectedTranslations: selectedTranslations 
    });
    
    let success = true;
    
    if (sheetsService.initialized) {
        // Проверяем дубликаты - теперь по английскому слову
        try {
            const existingWords = await sheetsService.getUserWords(chatId);
            const isDuplicate = existingWords.some(word => 
                word.english.toLowerCase() === userState.tempWord.toLowerCase()
            );
            
            if (isDuplicate) {
                await showMainMenu(chatId, 
                    `❌ Слово "${userState.tempWord}" уже есть в вашем словаре!\n\n` +
                    'Каждое английское слово может быть добавлено только один раз.'
                );
                userStates.delete(chatId);
                return;
            }
        } catch (error) {
            console.error('❌ Error checking duplicates:', error);
            // Продолжаем сохранение даже если проверка дубликатов не удалась
        }

        // ✅ СОЗДАЕМ МАССИВ ЗНАЧЕНИЙ ДЛЯ JSON
        const meaningsData = [];
        selectedTranslations.forEach(translation => {
            // Находим соответствующие значения из Cambridge Dictionary
            const cambridgeMeanings = userState.meanings.filter(
                meaning => meaning.translation === translation
            );
            
            // Для пользовательских переводов создаем пустые значения
            if (cambridgeMeanings.length === 0) {
                meaningsData.push({
                    translation: translation,
                    example: '', // Пользователь может добавить позже
                    partOfSpeech: '',
                    definition: ''
                });
            } else {
                // Для переводов из Cambridge добавляем все данные
                cambridgeMeanings.forEach(meaning => {
                    meaningsData.push({
                        translation: translation,
                        example: meaning.examples && meaning.examples.length > 0 ? meaning.examples[0].english : '',
                        partOfSpeech: meaning.partOfSpeech || '',
                        definition: meaning.englishDefinition || ''
                    });
                });
            }
        });

        console.log('📝 Meanings data for JSON:', meaningsData);

        // ✅ СОХРАНЯЕМ В НОВОМ ФОРМАТЕ
        success = await sheetsService.addWordWithMeanings(
            chatId,
            userState.tempWord,
            userState.tempTranscription,
            userState.tempAudioUrl,
            meaningsData // Передаем массив значений
        );
    }

    // Очищаем состояние пользователя
    userStates.delete(chatId);

    if (success) {
        const transcriptionText = userState.tempTranscription ? ` [${userState.tempTranscription}]` : '';
        let successMessage = '✅ Слово добавлено в словарь!\n\n' +
            `💬 **${userState.tempWord}**${transcriptionText}\n\n` +
            '**Добавленные значения:**\n';
        
        selectedTranslations.forEach((translation, index) => {
            successMessage += `\n${index + 1}. ${translation}`;
        });
        
        successMessage += '\n\n📚 Теперь вы можете изучать слово в разделе "🆕 Новые слова"!';
        await showMainMenu(chatId, successMessage);
    } else {
        await showMainMenu(chatId, 
            '❌ Ошибка сохранения\n\n' +
            'Не удалось сохранить слово в словарь. Попробуйте еще раз.'
        );
    }
}

// Вспомогательная функция для обработки пользовательского перевода без примера
async function processCustomTranslationWithoutExample(chatId, userState) {
    const newTranslations = [userState.customTranslation, ...userState.tempTranslations];
    const newMeaning = {
        translation: userState.customTranslation,
        englishDefinition: '',
        examples: []
    };
    const newMeanings = [newMeaning, ...userState.meanings];
    
    userStates.set(chatId, {
        ...userState,
        state: 'choosing_translation',
        tempTranslations: newTranslations,
        meanings: newMeanings,
        selectedTranslationIndices: [0]
    });

    const successMessage = `✅ Ваш перевод "${userState.customTranslation}" добавлен!\n\n` +
        '🎯 Теперь выберите переводы которые хотите сохранить:\n' +
        '✅ Ваш перевод отмечен как выбранный';
    
    await bot.sendMessage(chatId, successMessage, 
        getTranslationSelectionKeyboard(newTranslations, newMeanings, [0])
    );
    await showMainMenu(chatId);
}

// Вспомогательная функция для обработки пользовательского перевода с примером
async function processCustomTranslationWithExample(chatId, userState, example) {
    const newTranslations = [userState.customTranslation, ...userState.tempTranslations];
    const newMeaning = {
        translation: userState.customTranslation,
        englishDefinition: '',
        examples: example ? [{ english: example, russian: '' }] : []
    };
    const newMeanings = [newMeaning, ...userState.meanings];
    
    userStates.set(chatId, {
        ...userState,
        state: 'choosing_translation',
        tempTranslations: newTranslations,
        meanings: newMeanings,
        selectedTranslationIndices: [0]
    });

    let successMessage = `✅ Ваш перевод "${userState.customTranslation}" добавлен!\n\n`;
    if (example) {
        successMessage += `📝 Пример: ${example}\n\n`;
    }
    successMessage += '🎯 Теперь выберите переводы которые хотите сохрадеть:\n' +
        '✅ Ваш перевод отмечен как выбранный';
    
    await bot.sendMessage(chatId, successMessage, 
        getTranslationSelectionKeyboard(newTranslations, newMeanings, [0])
    );
    await showMainMenu(chatId);
}

// ✅ ФУНКЦИЯ: Отправка нотификаций о повторении
async function sendReviewNotification(chatId) {
    try {
        const hasWords = await sheetsService.hasWordsForReview(chatId);
        
        if (hasWords) {
            const wordsCount = await sheetsService.getReviewWordsCount(chatId);
            
            let message = '🔔 **Время повторять слова!**\n\n';
            message += `📚 Сегодня готово к повторению: ${wordsCount} слов\n\n`;
            message += '💪 Потратьте всего 5 минут чтобы укрепить память!\n\n';
            message += 'Нажмите кнопку ниже чтобы начать:';
            
            await bot.sendMessage(chatId, message, {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📚 Начать повторение', callback_data: 'start_review_from_notification' }],
                        [{ text: '⏰ Напомнить позже', callback_data: 'snooze_notification' }]
                    ]
                }
            });
            
            console.log(`✅ Sent review notification to ${chatId}`);
            return true;
        }
        return false;
    } catch (error) {
        console.error('❌ Error sending review notification:', error);
        return false;
    }
}

// ✅ ФУНКЦИЯ: Запуск ежедневных нотификаций
function startDailyNotifications() {
    console.log('🕒 Starting daily notification scheduler...');
    
    // Проверяем каждые 30 минут есть ли слова для повторения
    setInterval(async () => {
        try {
            const now = new Date();
            const currentHour = now.getHours();
            
            // Отправляем нотификации только в рабочее время (9-21)
            if (currentHour >= 9 && currentHour <= 21) {
                console.log('🔍 Checking for review notifications...');
                
                // Получаем всех активных пользователей
                if (sheetsService.initialized) {
                    const activeUsers = await sheetsService.getAllActiveUsers();
                    console.log(`📊 Active users found: ${activeUsers.length}`);
                    
                    for (const userId of activeUsers) {
                        const chatId = userId; // В нашем случае userId = chatId
                        
                        // Проверяем, не отправляли ли уже нотификацию сегодня
                        const lastNotification = notificationScheduler.get(chatId);
                        const today = new Date().toDateString();
                        
                        if (!lastNotification || lastNotification.date !== today) {
                            const sent = await sendReviewNotification(chatId);
                            if (sent) {
                                notificationScheduler.set(chatId, {
                                    date: today,
                                    sent: true
                                });
                            }
                        }
                    }
                }
            }
        } catch (error) {
            console.error('❌ Error in notification scheduler:', error);
        }
    }, 30 * 60 * 1000); // Проверяем каждые 30 минут
    
    // Также проверяем при старте бота
    setTimeout(async () => {
        console.log('🚀 Initial notification check...');
    }, 10000);
}

// ✅ ФУНКЦИЯ: Начало сессии повторения
async function startReviewSession(chatId) {
    if (!sheetsService.initialized) {
        await bot.sendMessage(chatId, '❌ Google Sheets не инициализирован.');
        return;
    }

    try {
        const wordsToReview = await sheetsService.getWordsForReview(chatId);
        
        if (wordsToReview.length === 0) {
            await bot.sendMessage(chatId, 
                '🎉 Отлично! На сегодня слов для повторения нет.\n\n' +
                'Возвращайтесь завтра для следующей сессии повторения.'
            );
            return;
        }

        // Сохраняем сессию повторения
        userStates.set(chatId, {
            state: 'review_session',
            reviewWords: wordsToReview,
            currentReviewIndex: 0,
            reviewedCount: 0
        });

        await showNextReviewWord(chatId);
        
    } catch (error) {
        console.error('❌ Error starting review session:', error);
        await bot.sendMessage(chatId, '❌ Ошибка при загрузке слов для повторения.');
    }
}

// ✅ ФУНКЦИЯ: Показ следующего слова для повторения с примерами
async function showNextReviewWord(chatId) {
    const userState = userStates.get(chatId);
    if (!userState || userState.state !== 'review_session') return;

    const { reviewWords, currentReviewIndex } = userState;
    
    if (currentReviewIndex >= reviewWords.length) {
        // Сессия завершена
        await completeReviewSession(chatId, userState);
        return;
    }

    const word = reviewWords[currentReviewIndex];
    const progress = `${currentReviewIndex + 1}/${reviewWords.length}`;
    
    let message = `📚 Повторение слов ${progress}\n\n`;
    message += `🇬🇧 **${word.english}**\n`;
    
    if (word.transcription) {
        message += `🔤 ${word.transcription}\n`;
    }
    
    message += `\n💡 Вспомните перевод и нажмите "Показать ответ"`;

    await bot.sendMessage(chatId, message, {
        reply_markup: {
            inline_keyboard: [
                [{ text: '👀 Показать ответ', callback_data: 'show_answer' }],
                [{ text: '⏭️ Пропустить', callback_data: 'skip_review' }],
                [{ text: '❌ Завершить повторение', callback_data: 'end_review' }]
            ]
        }
    });
}

// ✅ ФУНКЦИЯ: Показ ответа с кнопками оценки и примерами
async function showReviewAnswer(chatId) {
    const userState = userStates.get(chatId);
    if (!userState || userState.state !== 'review_session') return;

    const word = userState.reviewWords[userState.currentReviewIndex];
    
    let message = `📖 **Ответ:**\n\n`;
    message += `🇬🇧 ${word.english}\n`;
    
    if (word.transcription) {
        message += `🔤 ${word.transcription}\n`;
    }
    
    message += `\n🇷🇺 **Переводы:**\n`;
    
    // Показываем переводы и примеры
    word.meanings.forEach((meaning, index) => {
        message += `\n${index + 1}. ${meaning.translation}`;
        if (meaning.definition) {
            message += ` - ${meaning.definition}`;
        }
        
        // ✅ ДОБАВЛЯЕМ ПРИМЕРЫ ЕСЛИ ЕСТЬ
        if (meaning.example && meaning.example.trim() !== '') {
            message += `\n   📝 *Пример:* ${meaning.example}`;
        }
    });

    if (word.audioUrl) {
        // Отправляем аудио отдельным сообщением
        try {
            await bot.sendAudio(chatId, word.audioUrl, {
                caption: '🔊 Произношение'
            });
        } catch (error) {
            console.log('❌ Audio not available for review');
        }
    }

    await bot.sendMessage(chatId, message, getReviewKeyboard());
}

// ✅ ФУНКЦИЯ: Обработка оценки повторения
async function processReviewRating(chatId, rating) {
    const userState = userStates.get(chatId);
    if (!userState || userState.state !== 'review_session') return;

    const word = userState.reviewWords[userState.currentReviewIndex];
    
    try {
        // Создаем объект карточки для FSRS
        const cardData = {
            due: new Date(word.nextReview),
            stability: word.stability || 0,
            difficulty: word.difficulty || 0,
            elapsed_days: word.elapsed_days || 0,
            scheduled_days: word.scheduled_days || 0,
            reps: word.reps || 0,
            lapses: word.lapses || 0,
            state: word.state || 0,
            last_review: word.last_review ? new Date(word.last_review) : undefined
        };

        // Обновляем данные FSRS
        const fsrsData = fsrsService.reviewCard(cardData, rating);

        // Сохраняем в Google Sheets
        const success = await sheetsService.updateCardAfterReview(
            chatId, 
            word.english, 
            fsrsData, 
            rating
        );

        if (success) {
            // Обновляем состояние
            userState.reviewedCount++;
            userState.currentReviewIndex++;
            
            // Показываем следующий вопрос или завершаем сессию
            if (userState.currentReviewIndex < userState.reviewWords.length) {
                await showNextReviewWord(chatId);
            } else {
                await completeReviewSession(chatId, userState);
            }
        } else {
            await bot.sendMessage(chatId, '❌ Ошибка при сохранении результата.');
        }

    } catch (error) {
        console.error('❌ Error processing review rating:', error);
        await bot.sendMessage(chatId, '❌ Ошибка при обработке оценки.');
    }
}

// ✅ ФУНКЦИЯ: Завершение сессии повторения
async function completeReviewSession(chatId, userState) {
    const totalWords = userState.reviewWords.length;
    const reviewedCount = userState.reviewedCount;
    
    userStates.delete(chatId);

    let message = '🎉 **Сессия повторения завершена!**\n\n';
    message += `📊 Результаты:\n`;
    message += `• Всего слов для повторения: ${totalWords}\n`;
    message += `• Повторено: ${reviewedCount}\n`;
    message += `• Осталось: ${totalWords - reviewedCount}\n\n`;
    
    if (reviewedCount === totalWords && totalWords > 0) {
        message += `💪 Отличная работа! Вы повторили все слова!\n\n`;
    } else if (totalWords > 0) {
        message += `💡 Вы можете продолжить повторение позже.\n\n`;
    }
    
    // Проверяем новые слова для изучения
    const newWordsCount = await getNewWordsCount(chatId);
    if (newWordsCount > 0) {
        message += `🆕 Доступно новых слов для изучения: ${newWordsCount}\n`;
        message += `Можете изучить их через меню "🆕 Новые слова"!`;
    }
    
    await bot.sendMessage(chatId, message, getMainMenu());
}

// ✅ ФУНКЦИЯ: Начало сессии изучения новых слов
async function startNewWordsSession(chatId) {
    if (!sheetsService.initialized) {
        await bot.sendMessage(chatId, '❌ Google Sheets не инициализирован.');
        return;
    }

    try {
        const learnedToday = getLearnedToday(chatId);
        const DAILY_LIMIT = 5;
        
        // Проверяем достигнут ли дневной лимит
        if (learnedToday >= DAILY_LIMIT) {
            await bot.sendMessage(chatId, 
                `🎉 Вы достигли дневного лимита!\n\n` +
                `📊 Изучено слов сегодня: ${learnedToday}/${DAILY_LIMIT}\n\n` +
                '💡 Возвращайтесь завтра для изучения новых слов!\n' +
                '📚 Можете повторить уже изученные слова'
            );
            return;
        }

        const newWords = await getUnshownNewWords(chatId);
        
        if (newWords.length === 0) {
            await bot.sendMessage(chatId, 
                `🎉 На сегодня новых слов для изучения нет!\n\n` +
                `📊 Изучено слов сегодня: ${learnedToday}/${DAILY_LIMIT}\n\n` +
                '💡 Вы можете добавить новые слова через меню "➕ Добавить новое слово"\n' +
                '📚 Или повторить уже изученные слова'
            );
            return;
        }

        // Сохраняем сессию изучения новых слов
        userStates.set(chatId, {
            state: 'learning_new_words',
            newWords: newWords,
            currentWordIndex: 0,
            learnedCount: 0
        });

        console.log(`🎯 Начата сессия изучения для ${chatId}, доступно слов: ${newWords.length}`);
        await showNextNewWord(chatId);
        
    } catch (error) {
        console.error('❌ Error starting new words session:', error);
        await bot.sendMessage(chatId, '❌ Ошибка при загрузке новых слов.');
    }
}

// ✅ ФУНКЦИЯ: Показ следующего нового слова с примерами
async function showNextNewWord(chatId) {
    const userState = userStates.get(chatId);
    if (!userState || userState.state !== 'learning_new_words') return;

    const { newWords, currentWordIndex } = userState;
    
    if (currentWordIndex >= newWords.length) {
        // Сессия изучения завершена
        await completeNewWordsSession(chatId, userState);
        return;
    }

    const word = newWords[currentWordIndex];
    const progress = `${currentWordIndex + 1}/${newWords.length}`;
    
    // ✅ ОТМЕЧАЕМ СЛОВО КАК ПОКАЗАННОЕ
    markWordAsShown(chatId, word.english);
    
    let message = `🆕 Изучение новых слов ${progress}\n\n`;
    message += `🇬🇧 **${word.english}**\n`;
    
    if (word.transcription) {
        message += `🔤 ${word.transcription}\n`;
    }
    
    // Показываем переводы сразу для изучения
    message += `\n🇷🇺 **Переводы:**\n`;
    
    // Показываем переводы и примеры
    word.meanings.forEach((meaning, index) => {
        message += `\n${index + 1}. ${meaning.translation}`;
        if (meaning.definition) {
            message += ` - ${meaning.definition}`;
        }
        
        // ✅ ДОБАВЛЯЕМ ПРИМЕРЫ ЕСЛИ ЕСТЬ
        if (meaning.example && meaning.example.trim() !== '') {
            message += `\n   📝 *Пример:* ${meaning.example}`;
        }
    });

    if (word.audioUrl) {
        try {
            await bot.sendAudio(chatId, word.audioUrl, {
                caption: '🔊 Произношение'
            });
        } catch (error) {
            console.log('❌ Audio not available for new word');
        }
    }

    await bot.sendMessage(chatId, message, getNewWordsKeyboard());
}

// ✅ ФУНКЦИЯ: Обработка изучения нового слова
async function processNewWordLearning(chatId, action) {
    const userState = userStates.get(chatId);
    if (!userState || userState.state !== 'learning_new_words') return;

    const word = userState.newWords[userState.currentWordIndex];
    
    try {
        if (action === 'learned') {
            // ✅ ОТМЕЧАЕМ СЛОВО КАК ИЗУЧЕННОЕ СЕГОДНЯ
            markWordAsLearnedToday(chatId, word.english);
            
            // Создаем карточку для FSRS и обновляем данные
            const cardData = {
                due: new Date(word.nextReview),
                stability: 0,
                difficulty: 0,
                elapsed_days: 0,
                scheduled_days: 0,
                reps: 0,
                lapses: 0,
                state: 0
            };

            // Используем рейтинг "Good" для нового изученного слова
            const fsrsData = fsrsService.reviewCard(cardData, 'good');

            // Сохраняем в Google Sheets
            const success = await sheetsService.updateCardAfterReview(
                chatId, 
                word.english, 
                fsrsData, 
                'good'
            );

            if (success) {
                userState.learnedCount++;
            }
        } else if (action === 'repeat') {
            // Для слова "Нужно повторить" - не отмечаем как изученное,
            // но отмечаем как показанное чтобы оно не появлялось снова сегодня
            markWordAsShown(chatId, word.english);
        }
        
        // Переходим к следующему слову в любом случае
        userState.currentWordIndex++;
        
        // Показываем следующий вопрос или завершаем сессию
        if (userState.currentWordIndex < userState.newWords.length) {
            await showNextNewWord(chatId);
        } else {
            await completeNewWordsSession(chatId, userState);
        }

    } catch (error) {
        console.error('❌ Error processing new word learning:', error);
        await bot.sendMessage(chatId, '❌ Ошибка при сохранении прогресса.');
    }
}

// ✅ ФУНКЦИЯ: Завершение сессии изучения новых слов
async function completeNewWordsSession(chatId, userState) {
    const totalWords = userState.newWords.length;
    const learnedCount = userState.learnedCount;
    
    userStates.delete(chatId);

    let message = '🎉 **Сессия изучения завершена!**\n\n';
    message += `📊 Результаты:\n`;
    message += `• Всего новых слов: ${totalWords}\n`;
    message += `• Изучено: ${learnedCount}\n`;
    message += `• Отложено: ${totalWords - learnedCount}\n\n`;
    
    if (learnedCount === totalWords && totalWords > 0) {
        message += `💪 Отличная работа! Вы изучили все новые слова!\n\n`;
        message += `🔄 Эти слова появятся для повторения завтра.`;
    } else if (totalWords > 0) {
        message += `💡 Вы можете продолжить изучение позже.\n\n`;
    }
    
    // Проверяем слова для повторения
    const reviewWordsCount = await sheetsService.getReviewWordsCount(chatId);
    if (reviewWordsCount > 0) {
        message += `\n📚 Слов для повторения: ${reviewWordsCount}\n`;
        message += `Можете начать повторение через меню!`;
    }
    
    await bot.sendMessage(chatId, message, getMainMenu());
}

// ✅ ФУНКЦИЯ: Принудительное начало сессии изучения
async function forceStartNewWordsSession(chatId) {
    if (!sheetsService.initialized) {
        await bot.sendMessage(chatId, '❌ Google Sheets не инициализирован.');
        return;
    }

    try {
        const userWords = await sheetsService.getUserWords(chatId);
        const shownToday = shownNewWordsToday.get(chatId) || new Set();
        
        // Находим все слова с интервалом 1 день, которые не показаны сегодня
        const newWords = userWords.filter(word => 
            word.status === 'active' && 
            word.interval === 1 && 
            !shownToday.has(word.english.toLowerCase())
        );

        if (newWords.length === 0) {
            await bot.sendMessage(chatId, 
                '❌ Не найдено непоказанных слов с интервалом 1 день'
            );
            return;
        }

        // Сортируем по дате создания
        newWords.sort((a, b) => new Date(b.createdDate) - new Date(a.createdDate));

        // Сохраняем сессию изучения новых слов
        userStates.set(chatId, {
            state: 'learning_new_words',
            newWords: newWords,
            currentWordIndex: 0,
            learnedCount: 0
        });

        await bot.sendMessage(chatId, 
            `🎯 **Принудительная сессия начата!**\n\n` +
            `📝 Слов для изучения: ${newWords.length}\n` +
            `⚠️ Игнорируется дневной лимит`
        );

        await showNextNewWord(chatId);
        
    } catch (error) {
        console.error('❌ Error force starting new words session:', error);
        await bot.sendMessage(chatId, '❌ Ошибка при принудительном старте.');
    }
}

// ✅ ФУНКЦИЯ: Показ статистики пользователя
async function showUserStats(chatId) {
    if (!sheetsService.initialized) {
        await bot.sendMessage(chatId, '❌ Google Sheets не инициализирован.');
        return;
    }

    try {
        const userWords = await sheetsService.getUserWords(chatId);
        const activeWords = userWords.filter(word => word.status === 'active');
        const reviewWordsCount = await sheetsService.getReviewWordsCount(chatId);
        const newWordsCount = await sheetsService.getNewWordsCount(chatId);
        
        let message = '📊 **Ваша статистика:**\n\n';
        message += `📚 Всего слов: ${activeWords.length}\n`;
        message += `🔄 Слов для повторения: ${reviewWordsCount}\n`;
        message += `🆕 Новых слов для изучения: ${newWordsCount}\n`;
        
        if (activeWords.length > 0) {
            // Считаем слова по интервалам повторения
            const intervals = {
                'Новые (1 день)': 0,
                '2-7 дней': 0,
                '1-4 недели': 0,
                '1+ месяц': 0
            };
            
            activeWords.forEach(word => {
                if (word.interval === 1) intervals['Новые (1 день)']++;
                else if (word.interval <= 7) intervals['2-7 дней']++;
                else if (word.interval <= 30) intervals['1-4 недели']++;
                else intervals['1+ месяц']++;
            });
            
            message += `\n📅 **Интервалы повторения:**\n`;
            message += `• Новые: ${intervals['Новые (1 день)']} слов\n`;
            message += `• 2-7 дней: ${intervals['2-7 дней']} слов\n`;
            message += `• 1-4 недели: ${intervals['1-4 недели']} слов\n`;
            message += `• 1+ месяц: ${intervals['1+ месяц']} слов\n`;
        }
        
        message += `\n💡 **Система настроена на быстрое запоминание:**\n`;
        message += `• Повторение: БЕЗ ЛИМИТА (все готовые слова)\n`;
        message += `• Новые слова: 5 в день\n`;
        message += `• Частые повторения\n`;
        message += `• Оптимальные интервалы\n`;
        
        message += `\n💪 Продолжайте в том же духе!`;

        await bot.sendMessage(chatId, message, getMainMenu());
    } catch (error) {
        console.error('❌ Error showing stats:', error);
        await bot.sendMessage(chatId, '❌ Ошибка при загрузке статистики.');
    }
}

// Команда /start
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    await showMainMenu(chatId, 
        '📚 Англо-русский словарь\n' +
        '🔤 С транскрипцией и произношением\n' +
        '🇬🇧 Британский вариант\n' +
        '📝 Каждое слово хранится с несколькими значениями\n' +
        '🔄 **Умное интервальное повторение**\n' +
        '🔔 **Автоматические напоминания**\n\n' +
        '💡 **Как учить слова:**\n' +
        '1. ➕ Добавить новое слово\n' +
        '2. 🆕 Изучить новые слова (5 в день)\n' +
        '3. 📚 Повторить изученные слова\n\n' +
        'Используйте меню для навигации:'
    );
});

// Команда для сброса состояния (для отладки)
bot.onText(/\/reset/, async (msg) => {
    const chatId = msg.chat.id;
    userStates.delete(chatId);
    await bot.sendMessage(chatId, '✅ Состояние сброшено. Вы можете начать заново.');
    await showMainMenu(chatId);
});

// Команда для проверки состояния
bot.onText(/\/state/, async (msg) => {
    const chatId = msg.chat.id;
    const userState = userStates.get(chatId);
    await bot.sendMessage(chatId, `📊 Текущее состояние: ${userState ? userState.state : 'нет состояния'}`);
});

// Команда для миграции данных
bot.onText(/\/migrate/, async (msg) => {
    const chatId = msg.chat.id;
    if (sheetsService.initialized) {
        await bot.sendMessage(chatId, '🔄 Миграция данных в новый формат...');
        const success = await sheetsService.migrateOldDataToNewFormat(chatId);
        if (success) {
            await bot.sendMessage(chatId, '✅ Миграция завершена! Теперь все слова в новом формате.');
        } else {
            await bot.sendMessage(chatId, '❌ Ошибка при миграции данных.');
        }
    } else {
        await bot.sendMessage(chatId, '❌ Google Sheets не инициализирован.');
    }
});

// Команда для повторения слов
bot.onText(/\/review/, async (msg) => {
    const chatId = msg.chat.id;
    await startReviewSession(chatId);
});

// Команда для статистики
bot.onText(/\/stats/, async (msg) => {
    const chatId = msg.chat.id;
    await showUserStats(chatId);
});

// Команда для проверки нотификации
bot.onText(/\/notify/, async (msg) => {
    const chatId = msg.chat.id;
    await sendReviewNotification(chatId);
});

// Команда для проверки количества слов для повторения
bot.onText(/\/check/, async (msg) => {
    const chatId = msg.chat.id;
    if (sheetsService.initialized) {
        const count = await sheetsService.getReviewWordsCount(chatId);
        await bot.sendMessage(chatId, 
            `📊 Слов для повторения: ${count}\n\n` +
            (count > 0 ? '💪 Начните повторение через меню!' : '🎉 На сегодня слов для повторения нет!')
        );
    } else {
        await bot.sendMessage(chatId, '❌ Google Sheets не инициализирован.');
    }
});

// Команда для проверки новых слов
bot.onText(/\/new/, async (msg) => {
    const chatId = msg.chat.id;
    if (sheetsService.initialized) {
        const learnedToday = getLearnedToday(chatId);
        const DAILY_LIMIT = 5;
        const newWords = await getUnshownNewWords(chatId);
        const count = newWords.length;
        
        if (learnedToday >= DAILY_LIMIT) {
            await bot.sendMessage(chatId, 
                `🎉 Вы достигли дневного лимита!\n\n` +
                `📊 Изучено слов сегодня: ${learnedToday}/${DAILY_LIMIT}\n\n` +
                '💡 Возвращайтесь завтра для изучения новых слов!'
            );
        } else if (count > 0) {
            await bot.sendMessage(chatId, 
                `🆕 Новых слов для изучения: ${count}\n` +
                `📊 Изучено сегодня: ${learnedToday}/${DAILY_LIMIT}\n\n` +
                '💡 Хотите начать изучение?',
                {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🎯 Начать изучение', callback_data: 'start_learning_from_command' }],
                            [{ text: '📊 Только статистика', callback_data: 'show_new_stats_only' }]
                        ]
                    }
                }
            );
        } else {
            await bot.sendMessage(chatId, 
                `🎉 На сегодня новых слов для изучения нет!\n\n` +
                `📊 Изучено сегодня: ${learnedToday}/${DAILY_LIMIT}\n` +
                '💡 Добавляйте новые слова через меню "➕ Добавить новое слово"'
            );
        }
    } else {
        await bot.sendMessage(chatId, '❌ Google Sheets не инициализирован.');
    }
});

// Команда для проверки лимита (отладка)
bot.onText(/\/limit/, async (msg) => {
    const chatId = msg.chat.id;
    const learnedToday = getLearnedToday(chatId);
    const DAILY_LIMIT = 5;
    
    await bot.sendMessage(chatId, 
        `📊 **Статус дневного лимита:**\n\n` +
        `• Изучено сегодня: ${learnedToday}/${DAILY_LIMIT}\n` +
        `• Осталось слов: ${DAILY_LIMIT - learnedToday}\n` +
        `• Лимит достигнут: ${learnedToday >= DAILY_LIMIT ? '✅ Да' : '❌ Нет'}\n\n` +
        `💡 Лимит сбрасывается каждый день в 4:00`
    );
});

// Команда для сброса показанных слов (отладка)
bot.onText(/\/reset_shown/, async (msg) => {
    const chatId = msg.chat.id;
    shownNewWordsToday.delete(chatId);
    await bot.sendMessage(chatId, '✅ Показанные слова сброшены. Теперь все слова будут считаться новыми.');
});

// ✅ КОМАНДА ДЛЯ СБРОСА ПРОГРЕССА (расширенная отладка)
bot.onText(/\/reset_progress/, async (msg) => {
    const chatId = msg.chat.id;
    
    // Сохраняем текущие значения для отчета
    const shownBefore = (shownNewWordsToday.get(chatId) || new Set()).size;
    const learnedBefore = getLearnedToday(chatId);
    
    // Сбрасываем прогресс
    shownNewWordsToday.delete(chatId);
    dailyLearnedWords.delete(chatId);
    
    await bot.sendMessage(chatId, 
        '✅ **Весь прогресс сброшен!**\n\n' +
        `📊 Было до сброса:\n` +
        `• Показано слов: ${shownBefore}\n` +
        `• Изучено слов: ${learnedBefore}\n\n` +
        '🔄 Теперь можно:\n' +
        '• Использовать `/new` для проверки\n' +
        '• Использовать `/force_new` для отладки\n' +
        '• Добавлять новые слова через меню'
    );
    
    console.log(`🔄 Сброшен прогресс для ${chatId}: показано ${shownBefore}, изучено ${learnedBefore}`);
});

// ✅ КОМАНДА ДЛЯ ПРИНУДИТЕЛЬНОГО ПОКАЗА ВСЕХ СЛОВ (отладка)
bot.onText(/\/force_new/, async (msg) => {
    const chatId = msg.chat.id;
    if (!sheetsService.initialized) {
        await bot.sendMessage(chatId, '❌ Google Sheets не инициализирован.');
        return;
    }

    try {
        const userWords = await sheetsService.getUserWords(chatId);
        const shownToday = shownNewWordsToday.get(chatId) || new Set();
        const learnedToday = getLearnedToday(chatId);
        
        // Находим все слова с интервалом 1 день
        const allNewWords = userWords.filter(word => 
            word.status === 'active' && word.interval === 1
        );

        let debugMessage = `🔍 **Отладка: Все слова с интервалом 1 день**\n\n`;
        debugMessage += `📊 Статистика:\n`;
        debugMessage += `• Всего слов: ${userWords.length}\n`;
        debugMessage += `• С интервалом 1: ${allNewWords.length}\n`;
        debugMessage += `• Показано сегодня: ${shownToday.size}\n`;
        debugMessage += `• Изучено сегодня: ${learnedToday}\n\n`;
        
        debugMessage += `**Слова с интервалом 1:**\n`;
        if (allNewWords.length > 0) {
            allNewWords.forEach((word, index) => {
                const isShown = shownToday.has(word.english.toLowerCase());
                debugMessage += `\n${index + 1}. ${word.english} - ${isShown ? '❌ Показано' : '✅ Новое'} (создано: ${new Date(word.createdDate).toLocaleDateString()})`;
            });
        } else {
            debugMessage += `Нет слов с интервалом 1 день`;
        }

        await bot.sendMessage(chatId, debugMessage);

        // Если есть непоказанные слова - предлагаем начать изучение
        const unshownWords = allNewWords.filter(word => 
            !shownToday.has(word.english.toLowerCase())
        );

        if (unshownWords.length > 0) {
            await bot.sendMessage(chatId,
                `🆕 Найдено ${unshownWords.length} непоказанных слов\n` +
                '💡 Хотите начать принудительное изучение?',
                {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🎯 Принудительно начать', callback_data: 'force_start_learning' }]
                        ]
                    }
                }
            );
        }
        
    } catch (error) {
        console.error('❌ Error in /force_new:', error);
        await bot.sendMessage(chatId, '❌ Ошибка при отладке');
    }
});

// Обработка сообщений
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text || text.startsWith('/')) {
        return;
    }

    const userState = userStates.get(chatId);

    if (text === '➕ Добавить новое слово') {
        userStates.set(chatId, { state: 'waiting_english' });
        await showMainMenu(chatId, '🇬🇧 Введите английское слово:');
    }
    else if (text === '📚 Повторить слова') {
        await startReviewSession(chatId);
    }
    else if (text === '🆕 Новые слова') {
        await startNewWordsSession(chatId);
    }
    else if (text === '📊 Статистика') {
        await showUserStats(chatId);
    }
    else if (userState?.state === 'waiting_english') {
        // ... существующий код обработки добавления слов ...
        const englishWord = text.trim().toLowerCase();
        console.log(`🔍 Обработка слова: "${englishWord}"`);

        // Проверяем доступность сервисов
        if (!cambridgeService || !yandexService) {
            console.error('❌ Сервисы не инициализированы');
            await showMainMenu(chatId, '❌ Сервисы временно недоступны. Попробуйте позже.');
            userStates.delete(chatId);
            return;
        }

        // Более гибкая проверка на английское слово
        if (!/^[a-zA-Z\s\-'\.]+$/.test(englishWord)) {
            await showMainMenu(chatId, 
                '❌ Это не похоже на английское слово.\n' +
                'Пожалуйста, введите слово на английском:'
            );
            return;
        }

        await showMainMenu(chatId, '🔍 Ищу перевод, транскрипцию, произношение и примеры...');

        try {
            console.log(`🎯 Начинаем поиск для: "${englishWord}"`);
            let audioId = null;
            let transcription = '';
            let audioUrl = '';
            let meanings = [];
            let translations = [];

            // ✅ 1. ПОЛУЧАЕМ ПЕРЕВОДЫ ИЗ CAMBRIDGE
            console.log('📚 Запрашиваем Cambridge Dictionary...');
            const cambridgeData = await cambridgeService.getWordData(englishWord);
            if (cambridgeData.meanings && cambridgeData.meanings.length > 0) {
                console.log(`✅ Cambridge успешно: ${cambridgeData.meanings.length} значений`);
                meanings = cambridgeData.meanings;
                translations = meanings.map(m => m.translation).filter((t, i, arr) => arr.indexOf(t) === i);
                // Логируем найденные переводы для отладки
                console.log('📝 Найдены переводы:', translations);
            } else {
                console.log('❌ Cambridge не вернул переводы');
                // Создаем пустой массив, чтобы перейти к ручному вводу
                meanings = [];
                translations = [];
            }

            // ✅ 2. ПОЛУЧАЕМ ТРАНСКРИПЦИЮ И АУДИО ОТ ЯНДЕКСА
            console.log('🔤 Запрашиваем транскрипцию у Яндекс...');
            try {
                const yandexData = await yandexService.getTranscriptionAndAudio(englishWord);
                transcription = yandexData.transcription || '';
                audioUrl = yandexData.audioUrl || '';
                if (audioUrl) {
                    audioId = Date.now().toString();
                }
                console.log(`✅ Яндекс транскрипция: ${transcription}`);
            } catch (yandexError) {
                console.log(`❌ Яндекс не сработал: ${yandexError.message}`);
                // Fallback для аудио
                audioUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(englishWord)}&tl=en-gb&client=tw-ob`;
                audioId = Date.now().toString();
            }

            // ✅ 3. СОХРАНЯЕМ РЕЗУЛЬТАТЫ
            userStates.set(chatId, {
                state: 'showing_transcription',
                tempWord: englishWord,
                tempTranscription: transcription,
                tempAudioUrl: audioUrl,
                tempAudioId: audioId,
                tempTranslations: translations,
                meanings: meanings,
                selectedTranslationIndices: []
            });

            // ✅ 4. ФОРМИРУЕМ СООБЩЕНИЕ ДЛЯ ПОЛЬЗОВАТЕЛЯ
            let message = `📝 Слово: ${englishWord}`;
            if (transcription) {
                message += `\n🔤 Транскрипция: ${transcription}`;
            } else {
                message += `\n❌ Транскрипция не найдена`;
            }

            if (audioUrl) {
                message += `\n\n🎵 Доступно аудио произношение`;
            } else {
                message += `\n\n❌ Аудио произношение не найдено`;
            }

            if (translations.length > 0) {
                message += `\n\n🎯 Найдено ${translations.length} вариантов перевода из Cambridge Dictionary`;
                // ✅ ПОКАЗЫВАЕМ НАЙДЕННЫЕ ПРИМЕРЫ
                const totalExamples = meanings.reduce((total, meaning) => 
                    total + (meaning.examples ? meaning.examples.length : 0), 0
                );
                if (totalExamples > 0) {
                    message += `\n📝 Найдено ${totalExamples} примеров использования`;
                }
            } else {
                message += `\n\n❌ Переводы не найдены в Cambridge Dictionary\n✏️ Вы можете добавить свой перевод`;
            }

            message += `\n\nВыберите действие:`;
            await bot.sendMessage(chatId, message, getListeningKeyboard(audioId));
            await showMainMenu(chatId);

        } catch (error) {
            console.error('Error getting word data:', error);
            await showMainMenu(chatId, 
                '❌ Ошибка при поиске слова\n\n' +
                'Попробуйте другое слово или повторите позже.'
            );
            // Очищаем состояние при ошибке
            userStates.delete(chatId);
        }
    }
    // ИЗМЕНЕНО: Новая логика добавления своего перевода
    else if (userState?.state === 'waiting_custom_translation') {
        const customTranslation = text.trim();
        if (!customTranslation) {
            await showMainMenu(chatId, '❌ Перевод не может быть пустым. Введите перевод:');
            return;
        }

        // Сохраняем введенный перевод и переходим к вводу примера
        userStates.set(chatId, {
            ...userState,
            state: 'waiting_custom_example',
            customTranslation: customTranslation
        });

        await bot.sendMessage(chatId,
            `✅ Вы ввели перевод: "${customTranslation}"\n\n` +
            '📝 Теперь вы можете добавить пример использования (необязательно):\n\n' +
            '💡 Просто отправьте пример предложения с этим словом\n' +
            '⏭️ Или нажмите "Пропустить" чтобы перейти к выбору переводов',
            getExampleInputKeyboard()
        );
    }
    else if (userState?.state === 'waiting_custom_example') {
        if (text === '⏭️ Пропустить' || text === '➕ Добавить новое слово') {
            // Пропускаем ввод примера
            await processCustomTranslationWithoutExample(chatId, userState);
            return;
        }

        const example = text.trim();
        await processCustomTranslationWithExample(chatId, userState, example);
    }
    else if (userState?.state === 'waiting_manual_translation') {
        const translation = text.trim();
        if (!translation) {
            await showMainMenu(chatId, '❌ Перевод не может быть пустым. Введите перевод:');
            return;
        }
        await saveWordWithMeanings(chatId, userState, [translation]);
    }
    else if (userState?.state === 'waiting_custom_translation_with_selected') {
        const customTranslation = text.trim();
        if (!customTranslation) {
            await showMainMenu(chatId, '❌ Перевод не может быть пустым. Введите перевод:');
            return;
        }

        // ✅ ИСПРАВЛЕНИЕ: Получаем выбранные переводы из состояния
        const selectedTranslations = userState.selectedTranslationIndices
            .map(index => userState.tempTranslations[index]);

        // ✅ ИСПРАВЛЕНИЕ: Добавляем ручной перевод к выбранным
        const allTranslations = [...selectedTranslations, customTranslation];
        console.log(`📝 Сохраняем переводы: выбранные = ${selectedTranslations.join(', ')}, ручной = ${customTranslation}, все = ${allTranslations.join(', ')}`);
        
        await saveWordWithMeanings(chatId, userState, allTranslations);
    }
    else {
        await showMainMenu(chatId, 'Выберите действие из меню:');
    }
});

// Обработка inline кнопок
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;
    const userState = userStates.get(chatId);

    await bot.answerCallbackQuery(callbackQuery.id);

    if (data.startsWith('audio_')) {
        const audioId = data.replace('audio_', '');
        const audioUrl = userState?.tempAudioUrl;
        const englishWord = userState?.tempWord;

        if (audioUrl && englishWord) {
            try {
                await bot.editMessageReplyMarkup(
                    { inline_keyboard: [] },
                    { chat_id: chatId, message_id: callbackQuery.message.message_id }
                );
                await bot.sendAudio(chatId, audioUrl, {
                    caption: `🔊 Британское произношение: ${englishWord}`
                });
                await bot.sendMessage(chatId, '🎵 Вы прослушали произношение. Хотите выбрать перевод?', getAfterAudioKeyboard());
            } catch (error) {
                console.error('Error sending audio:', error);
                await bot.sendMessage(chatId, '❌ Ошибка при воспроизведении аудио.');
            }
        } else {
            await bot.sendMessage(chatId, '❌ Аудио произношение недоступно для этого слова.');
        }
    }
    else if (data === 'enter_translation') {
        if (userState?.state === 'showing_transcription') {
            try {
                await bot.editMessageReplyMarkup(
                    { inline_keyboard: [] },
                    { chat_id: chatId, message_id: callbackQuery.message.message_id }
                );

                // ✅ ИЗМЕНЕНИЕ: Проверяем есть ли переводы от Cambridge
                if (userState.tempTranslations && userState.tempTranslations.length > 0) {
                    userStates.set(chatId, {
                        ...userState,
                        state: 'choosing_translation',
                        selectedTranslationIndices: []
                    });

                    let translationMessage = '🎯 **Выберите переводы из Cambridge Dictionary:**\n\n' +
                        `🇬🇧 ${userState.tempWord}`;
                    if (userState.tempTranscription) {
                        translationMessage += `\n🔤 Транскрипция: ${userState.tempTranscription}`;
                    }
                    translationMessage += '\n\n💡 Нажмите "🔍 Подробнее" чтобы увидеть английское определение и примеры';

                    await bot.sendMessage(chatId, translationMessage,
                        getTranslationSelectionKeyboard(userState.tempTranslations, userState.meanings, [])
                    );
                } else {
                    // ✅ ИЗМЕНЕНИЕ: Если переводов нет, сразу переходим к добавлению своего перевода
                    userStates.set(chatId, {
                        ...userState,
                        state: 'waiting_custom_translation'
                    });

                    let translationMessage = '✏️ Cambridge Dictionary не нашел переводов\n\n' +
                        'Добавьте свой перевод для слова:\n\n' +
                        `🇬🇧 ${userState.tempWord}`;
                    if (userState.tempTranscription) {
                        translationMessage += `\n🔤 Транскрипция: ${userState.tempTranscription}`;
                    }
                    translationMessage += '\n\n💡 После ввода перевода вы сможете добавить пример использования';

                    await showMainMenu(chatId, translationMessage);
                }
            } catch (error) {
                console.error('Error in enter_translation:', error);
                await bot.sendMessage(chatId, '❌ Ошибка при обработке запроса');
            }
        }
    }
    else if (data.startsWith('toggle_translation_')) {
        const translationIndex = parseInt(data.replace('toggle_translation_', ''));
        if (userState?.state === 'choosing_translation' && userState.tempTranslations[translationIndex]) {
            try {
                let selectedIndices = [...(userState.selectedTranslationIndices || [])];
                if (selectedIndices.includes(translationIndex)) {
                    selectedIndices = selectedIndices.filter(idx => idx !== translationIndex);
                } else {
                    selectedIndices.push(translationIndex);
                }

                userStates.set(chatId, {
                    ...userState,
                    selectedTranslationIndices: selectedIndices
                });

                await bot.editMessageReplyMarkup(
                    getTranslationSelectionKeyboard(userState.tempTranslations, userState.meanings, selectedIndices).reply_markup,
                    { chat_id: chatId, message_id: callbackQuery.message.message_id }
                );
            } catch (error) {
                console.error('Error toggling translation:', error);
            }
        }
    }
    else if (data.startsWith('details_')) {
        const translationIndex = parseInt(data.replace('details_', ''));
        if (userState?.state === 'choosing_translation' && userState.tempTranslations[translationIndex]) {
            try {
                const translation = userState.tempTranslations[translationIndex];
                const meaning = userState.meanings.find(m => m.translation === translation);

                if (meaning) {
                    let detailsMessage = `🔍 **Подробности перевода:**\n\n`;
                    detailsMessage += `🇬🇧 **Слово:** ${userState.tempWord}\n`;
                    detailsMessage += `🇷🇺 **Перевод:** ${translation}\n\n`;

                    if (meaning.englishDefinition) {
                        detailsMessage += `📖 **Английское определение:**\n${meaning.englishDefinition}\n\n`;
                    }

                    if (meaning.examples && meaning.examples.length > 0) {
                        detailsMessage += `📝 **Примеры использования:**\n`;
                        meaning.examples.forEach((example, index) => {
                            if (index < 3) { // Показываем максимум 3 примера
                                detailsMessage += `\n${index + 1}. ${example.english}`;
                                if (example.russian) {
                                    detailsMessage += `\n   ${example.russian}`;
                                }
                            }
                        });
                    }

                    await bot.sendMessage(chatId, detailsMessage, {
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '🔙 Назад к выбору переводов', callback_data: 'back_to_translations' }]
                            ]
                        }
                    });
                } else {
                    await bot.sendMessage(chatId, '❌ Информация о переводе не найдена');
                }
            } catch (error) {
                console.error('Error showing details:', error);
                await bot.sendMessage(chatId, '❌ Ошибка при показе подробностей');
            }
        }
    }
    else if (data === 'back_to_translations') {
        if (userState?.state === 'choosing_translation') {
            try {
                // Показываем сообщение с выбором переводов
                let translationMessage = '🎯 **Выберите переводы из Cambridge Dictionary:**\n\n' +
                    `🇬🇧 ${userState.tempWord}`;
                if (userState.tempTranscription) {
                    translationMessage += `\n🔤 Транскрипция: ${userState.tempTranscription}`;
                }
                translationMessage += '\n\n💡 Нажмите "🔍 Подробнее" чтобы увидеть английское определение и примеры';

                // Отправляем новое сообщение с выбором переводов
                await bot.sendMessage(chatId, translationMessage,
                    getTranslationSelectionKeyboard(userState.tempTranslations, userState.meanings, userState.selectedTranslationIndices)
                );

                // Удаляем сообщение с деталями (если возможно)
                try {
                    await bot.deleteMessage(chatId, callbackQuery.message.message_id);
                } catch (deleteError) {
                    console.log('Не удалось удалить сообщение с деталями, продолжаем...');
                }
            } catch (error) {
                console.error('Error going back:', error);
            }
        }
    }
    else if (data === 'save_selected_translations') {
        if (userState?.state === 'choosing_translation' && userState.selectedTranslationIndices.length > 0) {
            try {
                const selectedTranslations = userState.selectedTranslationIndices
                    .map(index => userState.tempTranslations[index]);

                // ✅ ИЗМЕНЕНИЕ: Используем новую функцию сохранения
                await saveWordWithMeanings(chatId, userState, selectedTranslations);
                await bot.deleteMessage(chatId, callbackQuery.message.message_id);
            } catch (error) {
                console.error('Error saving translations:', error);
                await bot.sendMessage(chatId, '❌ Ошибка при сохранении слова');
            }
        }
    }
    else if (data === 'custom_translation') {
        if (userState?.state === 'choosing_translation') {
            try {
                // ИЗМЕНЕНО: Новая логика - переходим к вводу перевода
                userStates.set(chatId, {
                    ...userState,
                    state: 'waiting_custom_translation'
                });

                let translationMessage = '✏️ Введите свой вариант перевода:\n\n' +
                    `🇬🇧 ${userState.tempWord}`;
                if (userState.tempTranscription) {
                    translationMessage += `\n🔤 Транскрипция: ${userState.tempTranscription}`;
                }
                translationMessage += '\n\n💡 После ввода перевода вы сможете добавить пример использования';

                await bot.deleteMessage(chatId, callbackQuery.message.message_id);
                await showMainMenu(chatId, translationMessage);
            } catch (error) {
                console.error('Error in custom_translation:', error);
                await bot.sendMessage(chatId, '❌ Ошибка при обработке запроса');
            }
        }
    }
    else if (data === 'cancel_translation') {
        if (userState) {
            try {
                await bot.editMessageReplyMarkup(
                    { inline_keyboard: [] },
                    { chat_id: chatId, message_id: callbackQuery.message.message_id }
                );

                userStates.set(chatId, {
                    ...userState,
                    state: 'showing_transcription'
                });

                let message = `📝 Слово: ${userState.tempWord}`;
                if (userState.tempTranscription) {
                    message += `\n🔤 Транскрипция: ${userState.tempTranscription}`;
                }
                message += '\n\n🎵 Доступно аудио произношение\n\nВыберите действие:';

                await bot.sendMessage(chatId, message, getListeningKeyboard(userState.tempAudioId));
                await showMainMenu(chatId);
            } catch (error) {
                console.error('Error canceling translation:', error);
                await bot.sendMessage(chatId, '❌ Ошибка при отмене');
            }
        }
    }
    // ✅ НОВЫЕ ОБРАБОТЧИКИ ДЛЯ ПОВТОРЕНИЯ
    else if (data === 'show_answer') {
        await showReviewAnswer(chatId);
    }
    else if (data.startsWith('review_')) {
        const rating = data.replace('review_', '');
        await processReviewRating(chatId, rating);
    }
    else if (data === 'skip_review') {
        if (userState?.state === 'review_session') {
            userState.currentReviewIndex++;
            await showNextReviewWord(chatId);
        }
    }
    else if (data === 'end_review') {
        if (userState?.state === 'review_session') {
            await completeReviewSession(chatId, userState);
        }
    }
    // ✅ НОВЫЕ ОБРАБОТЧИКИ ДЛЯ ИЗУЧЕНИЯ НОВЫХ СЛОВ
    else if (data === 'learned_word') {
        await processNewWordLearning(chatId, 'learned');
    }
    else if (data === 'need_repeat_word') {
        await processNewWordLearning(chatId, 'repeat');
    }
    else if (data === 'skip_new_word') {
        const userState = userStates.get(chatId);
        if (userState?.state === 'learning_new_words') {
            userState.currentWordIndex++;
            await showNextNewWord(chatId);
        }
    }
    else if (data === 'end_learning') {
        const userState = userStates.get(chatId);
        if (userState?.state === 'learning_new_words') {
            await completeNewWordsSession(chatId, userState);
        }
    }
    // ✅ НОВЫЕ ОБРАБОТЧИКИ ДЛЯ НОТИФИКАЦИЙ
    else if (data === 'start_review_from_notification') {
        await bot.deleteMessage(chatId, callbackQuery.message.message_id);
        await startReviewSession(chatId);
    }
            else if (data === 'force_start_learning') {
        await bot.deleteMessage(chatId, callbackQuery.message.message_id);
        await forceStartNewWordsSession(chatId);
    }
    else if (data === 'snooze_notification') {
        await bot.editMessageText(
            '⏰ Хорошо, напомню через 2 часа!',
            {
                chat_id: chatId,
                message_id: callbackQuery.message.message_id
            }
        );
        
        // Устанавливаем таймер на 2 часа
        setTimeout(async () => {
            await sendReviewNotification(chatId);
        }, 2 * 60 * 60 * 1000);
    }
    // ✅ ОБРАБОТЧИКИ ДЛЯ КОМАНДЫ /NEW
    else if (data === 'start_learning_from_command') {
        await bot.deleteMessage(chatId, callbackQuery.message.message_id);
        await startNewWordsSession(chatId);
    }
    else if (data === 'show_new_stats_only') {
        const count = await sheetsService.getNewWordsCount(chatId);
        await bot.editMessageText(
            `🆕 Новых слов для изучения: ${count}\n\n` +
            '💡 Используйте кнопку "🆕 Новые слова" в меню чтобы начать изучение',
            {
                chat_id: chatId,
                message_id: callbackQuery.message.message_id
            }
        );
    }
});

// Обработка ошибок
bot.on('error', (error) => {
    console.error('Bot error:', error);
});

bot.on('polling_error', (error) => {
    console.error('Polling error:', error);
});

// Обработка необработанных исключений
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
});

// Запускаем нотификации после инициализации бота
setTimeout(() => {
    startDailyNotifications();
}, 5000);

console.log('🤖 Бот запущен: Версия с примерами в карточках, изучением новых слов и умными нотификациями!');




