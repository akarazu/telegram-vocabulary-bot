import TelegramBot from 'node-telegram-bot-api';
import { GoogleSheetsService } from './services/google-sheets.js';
import { YandexDictionaryService } from './services/yandex-dictionary-service.js';
import { CambridgeDictionaryService } from './services/cambridge-dictionary-service.js';
import { FSRSService } from './services/fsrs-service.js';
import { BatchSheetsService } from './services/batch-sheets-service.js';

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// Оптимизация: ленивая инициализация сервисов
let sheetsService, yandexService, cambridgeService, fsrsService, batchSheetsService;
let servicesInitialized = false;

// Оптимизация: кеширование данных
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 минут

// Оптимизация: уменьшение логов в продакшене
const isProduction = process.env.NODE_ENV === 'production';

function optimizedLog(message, data = null) {
    if (!isProduction) {
        if (data) {
            console.log(message, data);
        } else {
            console.log(message);
        }
    } else {
        const importantMessages = ['❌', '✅', '🔔', '🎯', '💰', '⏰'];
        if (importantMessages.some(emoji => message.includes(emoji))) {
            console.log(message);
        }
    }
}

async function initializeServices() {
    if (servicesInitialized) return;
    
    try {
        sheetsService = new GoogleSheetsService();
        batchSheetsService = new BatchSheetsService(sheetsService);
        yandexService = new YandexDictionaryService();
        cambridgeService = new CambridgeDictionaryService();
        fsrsService = new FSRSService();
        
        servicesInitialized = true;
        optimizedLog('✅ Все сервисы успешно инициализированы');
    } catch (error) {
        optimizedLog('❌ Ошибка инициализации сервисов:', error);
        // Создаем заглушки чтобы бот не падал
        sheetsService = { 
            initialized: false,
            hasWordsForReview: () => false,
            getReviewWordsCount: () => 0,
            getUserWords: () => []
        };
        yandexService = { getTranscriptionAndAudio: () => ({ transcription: '', audioUrl: '' }) };
        cambridgeService = { getWordData: () => ({ meanings: [] }) };
        fsrsService = new FSRSService();
        batchSheetsService = {
            updateWordReviewBatch: async () => true,
            flushAll: async () => {}
        };
    }
}

// Хранилище состояний пользователей
const userStates = new Map();

// Хранилище для планировщика нотификаций
const notificationScheduler = new Map();

// Хранилище для отслеживания дневного лимита изученных слов
const dailyLearnedWords = new Map();

// Хранилище для слов, которые УЖЕ ИЗУЧЕНЫ (перешли в повторение)
const learnedWords = new Map();

// Оптимизация: кеширование пользовательских слов
async function getCachedUserWords(chatId) {
    const cacheKey = `words_${chatId}`;
    const cached = cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
    }
    
    await initializeServices();
    const words = await sheetsService.getUserWords(chatId);
    cache.set(cacheKey, {
        data: words,
        timestamp: Date.now()
    });
    
    return words;
}

// Оптимизация: периодическая очистка кеша
setInterval(() => {
    const now = Date.now();
    for (const [key, value] of cache.entries()) {
        if (now - value.timestamp > CACHE_TTL) {
            cache.delete(key);
        }
    }
    // Очищаем неактивные состояния пользователей
    const inactiveTime = 30 * 60 * 1000; // 30 минут
    for (const [chatId, state] of userStates.entries()) {
        if (now - (state.lastActivity || 0) > inactiveTime) {
            userStates.delete(chatId);
            optimizedLog(`🧹 Очищен неактивный пользователь: ${chatId}`);
        }
    }
}, 10 * 60 * 1000);

function updateUserActivity(chatId) {
    const state = userStates.get(chatId);
    if (state) {
        state.lastActivity = Date.now();
    }
}

// ✅ ФУНКЦИЯ: Отметка слова как изученного
function markWordAsLearned(chatId, englishWord) {
    if (!learnedWords.has(chatId)) {
        learnedWords.set(chatId, new Set());
    }
    
    const userLearnedWords = learnedWords.get(chatId);
    userLearnedWords.add(englishWord.toLowerCase());
    optimizedLog(`🎓 Слово "${englishWord}" отмечено как ИЗУЧЕННОЕ для ${chatId}, всего: ${userLearnedWords.size}`);
}

// ✅ ФУНКЦИЯ: Проверка изучено ли слово
function isWordLearned(chatId, englishWord) {
    if (!learnedWords.has(chatId)) {
        learnedWords.set(chatId, new Set());
        return false;
    }
    const userLearnedWords = learnedWords.get(chatId);
    return userLearnedWords.has(englishWord.toLowerCase());
}

// ✅ ФУНКЦИЯ: Сброс дневного лимита
function resetDailyLimit() {
    const now = new Date();
    const currentHour = now.getHours();
    
    if (currentHour === 4) {
        dailyLearnedWords.clear();
        optimizedLog('🔄 Сброшен дневной лимит изучения слов');
    }
}

// Оптимизация: один интервал вместо нескольких
let lastLimitReset = 0;
let lastCacheCleanup = 0;
setInterval(() => {
    const now = Date.now();
    if (now - lastLimitReset >= 60 * 60 * 1000) {
        resetDailyLimit();
        lastLimitReset = now;
    }
}, 60 * 1000);

// ✅ ОБНОВЛЕННАЯ ФУНКЦИЯ: Получение количества изученных слов сегодня
async function getLearnedToday(chatId) {
    try {
        const userWords = await getCachedUserWords(chatId);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const learnedToday = userWords.filter(word => {
            if (word.interval <= 1) return false;
            
            try {
                let reviewDate;
                if (word.lastReview && word.lastReview.trim() !== '') {
                    reviewDate = new Date(word.lastReview);
                } else {
                    const nextReview = new Date(word.nextReview);
                    reviewDate = new Date(nextReview);
                    reviewDate.setDate(reviewDate.getDate() - (word.interval || 1));
                }
                
                const reviewDay = new Date(reviewDate.getFullYear(), reviewDate.getMonth(), reviewDate.getDate());
                const isLearnedToday = reviewDay.getTime() === today.getTime();
                
                if (isLearnedToday) {
                    optimizedLog(`✅ Слово "${word.english}" изучено сегодня: интервал=${word.interval}, LastReview=${word.lastReview || 'нет'}, расчетная дата=${reviewDate}`);
                }
                
                return isLearnedToday;
            } catch (error) {
                optimizedLog(`❌ Ошибка проверки слова "${word.english}":`, error);
                return false;
            }
        }).length;

        optimizedLog(`📊 Слов изучено сегодня для ${chatId}: ${learnedToday}`);
        return learnedToday;
        
    } catch (error) {
        optimizedLog('❌ Error getting learned today:', error);
        return 0;
    }
}

// Оптимизация: кеширование данных словарей
const dictionaryCache = new Map();

async function getCachedWordData(englishWord) {
    const cacheKey = `dict_${englishWord.toLowerCase()}`;
    const cached = dictionaryCache.get(cacheKey);
    
    if (cached) {
        return cached;
    }
    
    await initializeServices();
    
    try {
        const result = await Promise.race([
            cambridgeService.getWordData(englishWord),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Timeout')), 10000)
            )
        ]);
        
        dictionaryCache.set(cacheKey, result);
        
        if (dictionaryCache.size > 1000) {
            const firstKey = dictionaryCache.keys().next().value;
            dictionaryCache.delete(firstKey);
        }
        
        return result;
    } catch (error) {
        optimizedLog(`❌ Dictionary error for "${englishWord}":`, error.message);
        return { meanings: [] };
    }
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

// ✅ ОБНОВЛЕННАЯ КЛАВИАТУРА: Заменяем "Следующее слово" на "Пропустить слово"
function getNewWordsKeyboard() {
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: '✅ Выучил', callback_data: 'learned_word' }],
                [{ text: '🔄 Нужно повторить', callback_data: 'need_repeat_word' }],
                [{ text: '⏭️ Пропустить слово', callback_data: 'skip_new_word' }],
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
        optimizedLog('❌ Error showing main menu:', error);
        try {
            await bot.sendMessage(chatId, text || 'Выберите действие из меню:');
        } catch (e) {
            optimizedLog('❌ Critical error sending message:', e);
        }
    }
}

// ✅ ФУНКЦИЯ: Сохранение с JSON структурой
async function saveWordWithMeanings(chatId, userState, selectedTranslations) {
    optimizedLog('💾 Saving word with meanings:', { 
        word: userState.tempWord, 
        selectedTranslations: selectedTranslations 
    });
    
    let success = true;
    
    if (servicesInitialized && sheetsService.initialized) {
        try {
            const existingWords = await getCachedUserWords(chatId);
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
            optimizedLog('❌ Error checking duplicates:', error);
        }

        const meaningsData = [];
        selectedTranslations.forEach(translation => {
            const cambridgeMeanings = userState.meanings.filter(
                meaning => meaning.translation === translation
            );
            
            if (cambridgeMeanings.length === 0) {
                meaningsData.push({
                    translation: translation,
                    example: '',
                    partOfSpeech: '',
                    definition: ''
                });
            } else {
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

        optimizedLog('📝 Meanings data for JSON:', meaningsData);

        success = await sheetsService.addWordWithMeanings(
            chatId,
            userState.tempWord,
            userState.tempTranscription,
            userState.tempAudioUrl,
            meaningsData
        );
    }

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
    successMessage += '🎯 Теперь выберите переводы которые хотите сохранить:\n' +
        '✅ Ваш перевод отмечен как выбранный';
    
    await bot.sendMessage(chatId, successMessage, 
        getTranslationSelectionKeyboard(newTranslations, newMeanings, [0])
    );
    await showMainMenu(chatId);
}

// ✅ ИСПРАВЛЕННАЯ ФУНКЦИЯ: Проверка есть ли слова для повторения
async function hasWordsForReview(userId) {
    if (!servicesInitialized || !sheetsService.initialized) {
        return false;
    }
    
    try {
        const userWords = await getCachedUserWords(userId);
        const now = new Date();
        
        const hasReviewWords = userWords.some(word => {
            if (!word.nextReview || word.status !== 'active') return false;
            
            try {
                const nextReviewDate = new Date(word.nextReview);
                return nextReviewDate <= now;
            } catch (error) {
                optimizedLog(`❌ Error checking word "${word.english}"`);
                return false;
            }
        });

        return hasReviewWords;
        
    } catch (error) {
        optimizedLog('❌ Error checking words for review:', error.message);
        return false;
    }
}

// Оптимизация: батчинг нотификаций
async function sendBatchNotifications(userIds) {
    const BATCH_SIZE = 10;
    const DELAY_BETWEEN_BATCHES = 2000;
    
    for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
        const batch = userIds.slice(i, i + BATCH_SIZE);
        
        await Promise.allSettled(
            batch.map(chatId => sendReviewNotification(chatId))
        );
        
        if (i + BATCH_SIZE < userIds.length) {
            await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
        }
    }
}

// ✅ ИСПРАВЛЕННАЯ ФУНКЦИЯ: Проверка и отправка нотификаций
async function checkAndSendNotifications() {
    optimizedLog('🔔 Checking notifications for all users...');
    
    if (!servicesInitialized || !sheetsService.initialized) {
        optimizedLog('❌ Sheets service not initialized, skipping notifications');
        return;
    }
    
    try {
        const activeUsers = await sheetsService.getAllActiveUsers();
        optimizedLog(`📋 Found ${activeUsers.length} active users`);
        
        // Оптимизация: батчинг пользователей
        const userWordsMap = await sheetsService.getMultipleUsersWords(activeUsers);
        
        let sentCount = 0;
        const notificationPromises = [];
        
        for (const userId of activeUsers) {
            try {
                const userScheduler = notificationScheduler.get(userId);
                if (userScheduler?.disabled) {
                    optimizedLog(`⏸️ Notifications disabled for today for user ${userId}`);
                    continue;
                }
                
                const today = new Date().toDateString();
                if (userScheduler?.date === today && userScheduler?.sent) {
                    optimizedLog(`✅ Notification already sent today for user ${userId}`);
                    continue;
                }
                
                const userWords = userWordsMap.get(userId) || [];
                const hasReviewWords = userWords.some(word => {
                    if (!word.nextReview || word.status !== 'active') return false;
                    try {
                        const nextReviewDate = new Date(word.nextReview);
                        return nextReviewDate <= new Date();
                    } catch (error) {
                        return false;
                    }
                });
                
                if (hasReviewWords) {
                    notificationPromises.push(sendReviewNotification(userId));
                }
                
            } catch (userError) {
                optimizedLog(`❌ Error processing user ${userId}:`, userError);
            }
        }
        
        // Отправляем нотификации батчами
        const results = await Promise.allSettled(notificationPromises);
        sentCount = results.filter(r => r.status === 'fulfilled' && r.value).length;
        
        optimizedLog(`📢 Notification check completed: ${sentCount} sent`);
        
    } catch (error) {
        optimizedLog('❌ Error in notification check:', error);
    }
}

// Оптимизация: улучшенная система нотификаций
let lastNotificationCheck = 0;
function startOptimizedNotifications() {
    optimizedLog('💰 Запуск оптимизированных нотификаций...');
    
    // Основная проверка каждые 2 часа вместо 30 минут
    setInterval(async () => {
        const now = Date.now();
        if (now - lastNotificationCheck >= 2 * 60 * 60 * 1000) {
            await checkAndSendNotifications().catch(console.error);
            lastNotificationCheck = now;
        }
    }, 60 * 1000);
    
    scheduleMorningNotification();
    scheduleActiveHoursNotifications();
}

function scheduleActiveHoursNotifications() {
    const now = new Date();
    const nextCheck = new Date();
    
    nextCheck.setHours(9, 0, 0, 0);
    if (now >= nextCheck) {
        nextCheck.setDate(nextCheck.getDate() + 1);
    }
    
    const timeUntilCheck = nextCheck.getTime() - now.getTime();
    
    setTimeout(() => {
        let checkCount = 0;
        const dayInterval = setInterval(() => {
            const currentHour = new Date().getHours();
            if (currentHour >= 9 && currentHour <= 21) {
                checkAndSendNotifications().catch(console.error);
                checkCount++;
                
                if (checkCount >= 4 || currentHour >= 21) {
                    clearInterval(dayInterval);
                    scheduleActiveHoursNotifications();
                }
            }
        }, 4 * 60 * 60 * 1000);
        
    }, timeUntilCheck);
}

// ✅ ИСПРАВЛЕННАЯ ФУНКЦИЯ: Отправка нотификаций о повторении
async function sendReviewNotification(chatId) {
    try {
        const hasWords = await hasWordsForReview(chatId);
        
        if (hasWords) {
            const wordsCount = await sheetsService.getReviewWordsCount(chatId);
            const userWords = await getCachedUserWords(chatId);
            
            const newWords = userWords.filter(word => word.interval === 1).length;
            const reviewWords = userWords.filter(word => word.interval > 1).length;
            
            let message = '🔔 **Время учить английский!**\n\n';
            
            if (wordsCount > 0) {
                message += `📚 **Готово к повторению:** ${wordsCount} слов\n`;
            }
            
            if (newWords > 0) {
                message += `🆕 **Новых слов доступно:** ${newWords}\n`;
            }
            
            message += `\n💪 **Потратьте всего 5-10 минут:**\n`;
            message += `• Повторите изученные слова\n`;
            message += `• Изучите новые слова\n`;
            message += `• Укрепите память\n\n`;
            
            message += 'Выберите действие:';
            
            const keyboard = {
                reply_markup: {
                    inline_keyboard: []
                }
            };
            
            if (wordsCount > 0) {
                keyboard.reply_markup.inline_keyboard.push([
                    { text: `📚 Повторить слова (${wordsCount})`, callback_data: 'start_review_from_notification' }
                ]);
            }
            
            if (newWords > 0) {
                keyboard.reply_markup.inline_keyboard.push([
                    { text: `🆕 Изучить новые слова (${newWords})`, callback_data: 'start_learning_from_notification' }
                ]);
            }
            
            keyboard.reply_markup.inline_keyboard.push([
                { text: '⏰ Напомнить позже', callback_data: 'snooze_notification' },
                { text: '🚫 Отключить на сегодня', callback_data: 'disable_today' }
            ]);
            
            await bot.sendMessage(chatId, message, keyboard);
            
            // Обновляем статус отправки
            const today = new Date().toDateString();
            notificationScheduler.set(chatId, {
                date: today,
                sent: true,
                disabled: false
            });
            
            optimizedLog(`✅ Sent notification to ${chatId}: ${wordsCount} words for review, ${newWords} new words`);
            return true;
        } else {
            optimizedLog(`ℹ️ No words for review for ${chatId}, skipping notification`);
            return false;
        }
    } catch (error) {
        optimizedLog('❌ Error sending review notification:', error);
        return false;
    }
}

// ✅ УЛУЧШЕННАЯ ФУНКЦИЯ: Утренняя нотификация
function scheduleMorningNotification() {
    const now = new Date();
    const nextMorning = new Date();
    
    nextMorning.setHours(9, 0, 0, 0);
    
    if (now >= nextMorning) {
        nextMorning.setDate(nextMorning.getDate() + 1);
    }
    
    const timeUntilMorning = nextMorning.getTime() - now.getTime();
    
    optimizedLog(`⏰ Morning notification scheduled for ${nextMorning.toLocaleString()}`);
    
    setTimeout(() => {
        optimizedLog('🌅 Sending morning notifications...');
        checkAndSendNotifications();
        scheduleMorningNotification();
    }, timeUntilMorning);
}

// ✅ ФУНКЦИЯ: Начало сессии повторения
async function startReviewSession(chatId) {
    await initializeServices();
    
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

        userStates.set(chatId, {
            state: 'review_session',
            reviewWords: wordsToReview,
            currentReviewIndex: 0,
            reviewedCount: 0,
            lastActivity: Date.now()
        });

        await showNextReviewWord(chatId);
        
    } catch (error) {
        optimizedLog('❌ Error starting review session:', error);
        await bot.sendMessage(chatId, '❌ Ошибка при загрузке слов для повторения.');
    }
}

// ✅ ОБНОВЛЕННАЯ ФУНКЦИЯ: Показ следующего слова для повторения
async function showNextReviewWord(chatId) {
    const userState = userStates.get(chatId);
    if (!userState || userState.state !== 'review_session') return;

    const { reviewWords, currentReviewIndex, reviewedCount } = userState;
    
    if (currentReviewIndex >= reviewWords.length) {
        userState.currentReviewIndex = 0;
    }

    const word = reviewWords[userState.currentReviewIndex];
    const progress = `${userState.currentReviewIndex + 1}/${reviewWords.length} (${userState.reviewedCount} оценено)`;
    
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

// ✅ ФУНКЦИЯ: Показать ответ для повторения
async function showReviewAnswer(chatId) {
    const userState = userStates.get(chatId);
    if (!userState || userState.state !== 'review_session') return;

    const word = userState.reviewWords[userState.currentReviewIndex];
    
    let message = `📚 **Ответ:**\n\n`;
    message += `🇬🇧 **${word.english}**\n`;
    
    if (word.transcription) {
        message += `🔤 ${word.transcription}\n`;
    }
    
    message += `\n🇷🇺 **Переводы:**\n`;
    word.meanings.forEach((meaning, index) => {
        message += `\n${index + 1}. ${meaning.translation}`;
        if (meaning.definition) {
            message += ` - ${meaning.definition}`;
        }
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
            optimizedLog('❌ Audio not available for review word');
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

        const fsrsData = fsrsService.reviewCard(cardData, rating);

        // Оптимизация: используем батчинг для сохранения
        const success = await batchSheetsService.updateWordReviewBatch(
            chatId,
            word.english,
            fsrsData.card.interval || word.interval,
            fsrsData.card.due || word.nextReview,
            new Date()
        );

        if (success) {
            userState.reviewedCount++;
            userState.currentReviewIndex++;
            userState.lastActivity = Date.now();
            
            if (userState.currentReviewIndex >= userState.reviewWords.length) {
                userState.currentReviewIndex = 0;
            }
            
            await showNextReviewWord(chatId);
        } else {
            await bot.sendMessage(chatId, '❌ Ошибка при сохранении результата.');
        }

    } catch (error) {
        optimizedLog('❌ Error processing review rating:', error);
        await bot.sendMessage(chatId, '❌ Ошибка при обработке оценки.');
    }
}

// ✅ ОБНОВЛЕННАЯ ФУНКЦИЯ: Завершение сессии повторения
async function completeReviewSession(chatId, userState) {
    const totalWords = userState.reviewWords.length;
    const reviewedCount = userState.reviewedCount;
    
    userStates.delete(chatId);

    let message = '🎉 **Сессия повторения завершена!**\n\n';
    message += `📊 Результаты:\n`;
    message += `• Всего слов для повторения: ${totalWords}\n`;
    message += `• Повторено: ${reviewedCount}\n`;
    
    if (reviewedCount > 0) {
        const progressPercentage = Math.round((reviewedCount / totalWords) * 100);
        message += `• Прогресс: ${progressPercentage}%\n\n`;
    } else {
        message += `\n`;
    }
    
    message += `💡 Вы можете:\n`;
    message += `• Начать новую сессию повторения\n`;
    message += `• Изучить новые слова\n`;
    message += `• Посмотреть статистику\n`;
    
    await bot.sendMessage(chatId, message, getMainMenu());
}

// ✅ ИСПРАВЛЕННАЯ ФУНКЦИЯ: Начало сессии изучения новых слов
async function startNewWordsSession(chatId) {
    await initializeServices();
    
    if (!sheetsService.initialized) {
        await bot.sendMessage(chatId, '❌ Google Sheets не инициализирован.');
        return;
    }

    try {
        const learnedToday = await getLearnedToday(chatId);
        const DAILY_LIMIT = 5;
        
        optimizedLog(`🔍 Старт сессии изучения для ${chatId}, изучено сегодня: ${learnedToday}/${DAILY_LIMIT}`);

        if (learnedToday >= DAILY_LIMIT) {
            await bot.sendMessage(chatId, 
                `🎉 Вы достигли дневного лимита!\n\n` +
                `📊 Изучено слов сегодня: ${learnedToday}/${DAILY_LIMIT}\n\n` +
                '💡 Возвращайтесь завтра для изучения новых слов!\n' +
                '📚 Можете повторить уже изученные слова\n\n' +
                '🔄 Или используйте /reset_progress чтобы сбросить лимит'
            );
            return;
        }

        const availableNewWords = await getAvailableNewWordsForToday(chatId, learnedToday);
        
        if (availableNewWords.length === 0) {
            await bot.sendMessage(chatId, 
                `🎉 На сегодня новых слов для изучения нет!\n\n` +
                `📊 Изучено слов сегодня: ${learnedToday}/${DAILY_LIMIT}\n\n` +
                '💡 Вы можете:\n' +
                '• Добавить новые слова через меню "➕ Добавить новое слово"\n' +
                '• Повторить уже изученные слова\n' +
                '• Использовать /reset_progress чтобы сбросить лимит'
            );
            return;
        }

        userStates.set(chatId, {
            state: 'learning_new_words',
            newWords: availableNewWords,
            currentWordIndex: 0,
            learnedCount: 0,
            originalWordsCount: availableNewWords.length,
            lastActivity: Date.now()
        });

        optimizedLog(`🎯 Начата сессия изучения для ${chatId}, доступно слов: ${availableNewWords.length}`);
        await showNextNewWord(chatId);
        
    } catch (error) {
        optimizedLog('❌ Error starting new words session:', error);
        await bot.sendMessage(chatId, '❌ Ошибка при загрузке новых слов.');
    }
}

// ✅ НОВАЯ ФУНКЦИЯ: Получение доступных новых слов на сегодня
async function getAvailableNewWordsForToday(chatId, alreadyLearnedToday) {
    if (!servicesInitialized || !sheetsService.initialized) {
        return [];
    }
    
    try {
        const userWords = await getCachedUserWords(chatId);
        const DAILY_LIMIT = 5;
        
        optimizedLog(`🔍 Поиск доступных новых слов для ${chatId}, уже изучено: ${alreadyLearnedToday}`);

        const unlearnedWords = userWords.filter(word => {
            if (!word.nextReview || word.status !== 'active') return false;
            
            try {
                const isNewWord = word.interval === 1;
                const isNotLearned = !isWordLearned(chatId, word.english);
                return isNewWord && isNotLearned;
            } catch (error) {
                optimizedLog(`❌ Ошибка проверки слова "${word.english}"`);
                return false;
            }
        });

        optimizedLog(`📊 Найдено не изученных слов: ${unlearnedWords.length}`);

        unlearnedWords.sort((a, b) => new Date(b.createdDate) - new Date(a.createdDate));

        const remainingSlots = Math.max(0, DAILY_LIMIT - alreadyLearnedToday);
        const result = unlearnedWords.slice(0, remainingSlots);
        
        optimizedLog(`🎯 Будет показано: ${result.length} слов (осталось слотов: ${remainingSlots})`);
        return result;
        
    } catch (error) {
        optimizedLog('❌ Error getting available new words:', error);
        return [];
    }
}

// ✅ ИСПРАВЛЕННАЯ ФУНКЦИЯ: Показ следующего нового слова
async function showNextNewWord(chatId) {
    const userState = userStates.get(chatId);
    if (!userState || userState.state !== 'learning_new_words') return;

    const { newWords, currentWordIndex } = userState;
    
    if (newWords.length === 0) {
        await completeNewWordsSession(chatId, userState);
        return;
    }

    if (currentWordIndex >= newWords.length) {
        userState.currentWordIndex = 0;
    }

    const word = newWords[userState.currentWordIndex];
    
    const currentLearnedToday = await getLearnedToday(chatId);
    const remainingSlots = Math.max(0, 5 - currentLearnedToday);
    
    const currentPosition = userState.currentWordIndex + 1;
    const totalWords = newWords.length;
    const progress = `${currentPosition}/${totalWords}`;
    
    let message = `🆕 Изучение новых слов ${progress}\n\n`;
    message += `📊 Изучено сегодня: ${currentLearnedToday}/5\n\n`;
    message += `🇬🇧 **${word.english}**\n`;
    
    if (word.transcription) {
        message += `🔤 ${word.transcription}\n`;
    }
    
    message += `\n🇷🇺 **Переводы:**\n`;
    
    word.meanings.forEach((meaning, index) => {
        message += `\n${index + 1}. ${meaning.translation}`;
        if (meaning.definition) {
            message += ` - ${meaning.definition}`;
        }
        
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
            optimizedLog('❌ Audio not available for new word');
        }
    }

    await bot.sendMessage(chatId, message, getNewWordsKeyboard());
}

// ✅ ИСПРАВЛЕННАЯ ФУНКЦИЯ: Обработка изучения нового слова
async function processNewWordLearning(chatId, action) {
    const userState = userStates.get(chatId);
    if (!userState || userState.state !== 'learning_new_words') return;

    const word = userState.newWords[userState.currentWordIndex];
    
    try {
        if (action === 'learned') {
            const newInterval = 2;
            const nextReview = new Date(Date.now() + newInterval * 24 * 60 * 60 * 1000);
            const today = new Date();
            
            optimizedLog(`💾 Сохранение слова "${word.english}" как изученного сегодня: ${today}`);
            
            // Оптимизация: используем батчинг для сохранения
            const success = await batchSheetsService.updateWordReviewBatch(
                chatId,
                word.english,
                newInterval,
                nextReview,
                today
            );

            if (success) {
                userState.learnedCount++;
                markWordAsLearned(chatId, word.english);
                optimizedLog(`📚 Слово "${word.english}" изучено сегодня: ${today}`);
                
                userState.newWords.splice(userState.currentWordIndex, 1);
                
                optimizedLog(`✅ Слово "${word.english}" удалено из списка. Осталось слов: ${userState.newWords.length}`);
                
                const currentLearnedToday = await getLearnedToday(chatId);
                optimizedLog(`📈 После изучения "${word.english}": ${currentLearnedToday}/5 изучено сегодня`);
                
                if (currentLearnedToday >= 5) {
                    await bot.sendMessage(chatId, 
                        `🎉 Вы достигли дневного лимита в 5 слов!\n\n` +
                        `📊 Изучено сегодня: ${currentLearnedToday}/5\n\n` +
                        '💡 Возвращайтесь завтра для изучения новых слов.'
                    );
                    await completeNewWordsSession(chatId, userState);
                    return;
                }
                
            } else {
                optimizedLog(`❌ Не удалось обновить интервал для слова "${word.english}"`);
                await bot.sendMessage(chatId, '❌ Ошибка при сохранении прогресса слова.');
                return;
            }
            
        } else if (action === 'repeat') {
            optimizedLog(`🔄 Слово "${word.english}" осталось в новых словах для повторения`);
            userState.currentWordIndex++;
            userState.lastActivity = Date.now();
            
        } else if (action === 'skip') {
            const skippedWord = userState.newWords.splice(userState.currentWordIndex, 1)[0];
            userState.newWords.push(skippedWord);
            optimizedLog(`⏭️ Слово "${skippedWord.english}" пропущено и перемещено в конец списка`);
            userState.lastActivity = Date.now();
        }
        
        if (userState.currentWordIndex >= userState.newWords.length) {
            userState.currentWordIndex = 0;
            optimizedLog(`🔄 Индекс сброшен в 0 (достигнут конец массива)`);
        }
        
        if (userState.newWords.length === 0) {
            optimizedLog(`🎯 Все слова обработаны, завершение сессии`);
            await completeNewWordsSession(chatId, userState);
            return;
        }
        
        optimizedLog(`🔄 Переход к следующему слову. Текущий индекс: ${userState.currentWordIndex}, всего слов: ${userState.newWords.length}`);
        await showNextNewWord(chatId);

    } catch (error) {
        optimizedLog('❌ Error processing new word learning:', error);
        await bot.sendMessage(chatId, 
            '❌ Ошибка при сохранении прогресса.\n' +
            'Попробуйте еще раз или используйте /debug_stats для диагностики.'
        );
    }
}

// ✅ ОБНОВЛЯЕМ ФУНКЦИЮ: Завершение сессии изучения новых слов
async function completeNewWordsSession(chatId, userState) {
    const currentLearnedToday = await getLearnedToday(chatId);
    const originalWordsCount = userState.originalWordsCount || (userState.newWords ? userState.newWords.length + userState.learnedCount : userState.learnedCount);
    const learnedCount = userState.learnedCount;
    
    userStates.delete(chatId);

    let message = '🎉 **Сессия изучения завершена!**\n\n';
    message += `📊 Результаты:\n`;
    message += `• Всего новых слов: ${originalWordsCount}\n`;
    message += `• Изучено в этой сессии: ${learnedCount}\n`;
    message += `• Всего изучено сегодня: ${currentLearnedToday}/5\n`;
    message += `• Отложено: ${originalWordsCount - learnedCount}\n\n`;
    
    if (currentLearnedToday >= 5) {
        message += `✅ Дневной лимит достигнут!\n`;
        message += `💡 Возвращайтесь завтра для изучения новых слов.\n\n`;
    } else if (learnedCount === originalWordsCount && originalWordsCount > 0) {
        message += `💪 Отличная работа! Вы изучили все новые слова!\n\n`;
        message += `🔄 Эти слова появятся для повторения завтра.`;
    } else if (originalWordsCount > 0) {
        message += `💡 Оставшиеся слова будут доступны для изучения в следующий раз.\n\n`;
    }
    
    const reviewWordsCount = await sheetsService.getReviewWordsCount(chatId);
    if (reviewWordsCount > 0) {
        message += `\n📚 Слов для повторения: ${reviewWordsCount}\n`;
        message += `Можете начать повторение через меню!`;
    }
    
    await bot.sendMessage(chatId, message, getMainMenu());
}

// ✅ ОБНОВЛЯЕМ ФУНКЦИЮ: Показ статистики с временем
async function showUserStats(chatId) {
    await initializeServices();
    
    if (!sheetsService.initialized) {
        await bot.sendMessage(chatId, '❌ Google Sheets не инициализирован.');
        return;
    }

    try {
        const userWords = await getCachedUserWords(chatId);
        const activeWords = userWords.filter(word => word.status === 'active');
        const reviewWordsCount = await sheetsService.getReviewWordsCount(chatId);
        
        const unlearnedWords = await getAllUnlearnedWords(chatId);
        const newWordsCount = unlearnedWords.length;
        
        const learnedToday = await getLearnedToday(chatId);
        const DAILY_LIMIT = 5;
        const remainingToday = Math.max(0, DAILY_LIMIT - learnedToday);
        
        let message = '📊 **Ваша статистика:**\n\n';
        message += `📚 Всего слов в словаре: ${activeWords.length}\n`;
        message += `🔄 Слов для повторения: ${reviewWordsCount}\n`;
        message += `🆕 Новых слов доступно: ${newWordsCount}\n`;
        message += `📅 Изучено сегодня: ${learnedToday}/${DAILY_LIMIT}\n`;
        
        if (remainingToday > 0) {
            message += `🎯 Осталось изучить сегодня: ${remainingToday} слов\n`;
        } else {
            message += `✅ Дневной лимит достигнут!\n`;
        }
        
        if (activeWords.length > 0) {
            const now = new Date();
            
            const wordsWithFutureReview = activeWords
                .filter(word => word.interval > 1 && word.nextReview)
                .map(word => {
                    try {
                        const nextReview = new Date(word.nextReview);
                        const daysUntil = Math.ceil((nextReview - now) / (1000 * 60 * 60 * 24));
                        return { word: word.english, daysUntil, nextReview };
                    } catch (error) {
                        return null;
                    }
                })
                .filter(item => item !== null && item.daysUntil >= 0)
                .sort((a, b) => a.daysUntil - b.daysUntil);

            if (wordsWithFutureReview.length > 0) {
                const nearestReview = wordsWithFutureReview[0];
                const formattedDate = formatConcreteDate(nearestReview.nextReview);
                message += `\n⏰ **Ближайшее повторение:** ${formattedDate}\n`;
                
                const reviewSchedule = {};
                wordsWithFutureReview.forEach(item => {
                    const dateKey = formatConcreteDate(item.nextReview);
                    reviewSchedule[dateKey] = (reviewSchedule[dateKey] || 0) + 1;
                });

                if (Object.keys(reviewSchedule).length > 0) {
                    message += `\n📅 **Расписание повторений:**\n`;
                    
                    const sortedDates = Object.keys(reviewSchedule).sort((a, b) => {
                        const dateA = new Date(a.split(' ')[0].split('.').reverse().join('-'));
                        const dateB = new Date(b.split(' ')[0].split('.').reverse().join('-'));
                        return dateA - dateB;
                    });
                    
                    sortedDates.slice(0, 5).forEach(date => {
                        message += `• ${date}: ${reviewSchedule[date]} слов\n`;
                    });
                    
                    if (sortedDates.length > 5) {
                        const remainingWords = Object.values(reviewSchedule).slice(5).reduce((a, b) => a + b, 0);
                        message += `• И еще ${remainingWords} слов в следующие дни\n`;
                    }
                }
            } else {
                message += `\n⏰ **Ближайшее повторение:** пока нет запланированных\n`;
            }
            
            const intervals = {
                'Новые': 0,
                'Короткие (2-3д)': 0,
                'Средние (4-7д)': 0,
                'Долгие (8+д)': 0
            };
            
            activeWords.forEach(word => {
                const interval = word.interval || 1;
                if (interval === 1) intervals['Новые']++;
                else if (interval <= 3) intervals['Короткие (2-3д)']++;
                else if (interval <= 7) intervals['Средние (4-7д)']++;
                else intervals['Долгие (8+д)']++;
            });
            
            message += `\n📈 **Интервалы повторения:**\n`;
            message += `• Новые: ${intervals['Новые']} слов\n`;
            message += `• Короткие: ${intervals['Короткие (2-3д)']} слов\n`;
            message += `• Средние: ${intervals['Средние (4-7д)']} слов\n`;
            message += `• Долгие: ${intervals['Долгие (8+д)']} слов\n`;
            
            const learnedWordsCount = activeWords.filter(word => word.interval > 1).length;
            const progressPercentage = activeWords.length > 0 
                ? Math.round((learnedWordsCount / activeWords.length) * 100) 
                : 0;
                
            message += `\n🎓 **Общий прогресс:** ${learnedWordsCount}/${activeWords.length} (${progressPercentage}%)\n`;
        }
        
        message += `\n💡 **Рекомендации:**\n`;
        
        if (reviewWordsCount > 0) {
            message += `• Начните с повторения слов (${reviewWordsCount} слов ждут)\n`;
        }
        
        if (newWordsCount > 0 && remainingToday > 0) {
            message += `• Изучите новые слова (доступно ${Math.min(newWordsCount, remainingToday)} из ${newWordsCount})\n`;
        } else if (newWordsCount > 0) {
            message += `• Новые слова доступны завтра (${newWordsCount} слов)\n`;
        }
        
        if (reviewWordsCount === 0 && newWordsCount === 0) {
            message += `🎉 Отличная работа! Все слова изучены!\n`;
            message += `• Добавьте новые слова через меню\n`;
        }

        await bot.sendMessage(chatId, message, getMainMenu());
        
    } catch (error) {
        optimizedLog('❌ Error showing stats:', error);
        await bot.sendMessage(chatId, 
            '❌ Ошибка при загрузке статистики.\n' +
            'Попробуйте позже или используйте /debug_progress для диагностики.'
        );
    }
}

// ✅ ИСПРАВЛЕННАЯ ФУНКЦИЯ: Форматирование конкретной даты с временем
function formatConcreteDate(date) {
    const now = new Date();
    const targetDate = new Date(date);
    
    const diffTime = targetDate - now;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const diffHours = Math.ceil(diffTime / (1000 * 60 * 60));
    
    const day = targetDate.getDate().toString().padStart(2, '0');
    const month = (targetDate.getMonth() + 1).toString().padStart(2, '0');
    const year = targetDate.getFullYear();
    
    const hours = targetDate.getHours().toString().padStart(2, '0');
    const minutes = targetDate.getMinutes().toString().padStart(2, '0');
    
    const daysOfWeek = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
    const dayOfWeek = daysOfWeek[targetDate.getDay()];
    
    if (diffDays === 0) {
        if (diffHours <= 1) {
            return `${hours}:${minutes} (через ${diffHours} час)`;
        } else if (diffHours <= 24) {
            return `${hours}:${minutes} (через ${diffHours} часов)`;
        } else {
            return `${day}.${month}.${year} ${hours}:${minutes}`;
        }
    } else if (diffDays === 1) {
        return `${day}.${month}.${year} ${hours}:${minutes}`;
    } else if (diffDays === 2) {
        return `${day}.${month}.${year} ${hours}:${minutes}`;
    } else if (diffDays <= 7) {
        return `${day}.${month}.${year} ${hours}:${minutes} (${dayOfWeek}, через ${diffDays} дн.)`;
    } else {
        return `${day}.${month}.${year} ${hours}:${minutes} (${dayOfWeek})`;
    }
}

// ✅ ДОБАВЛЯЕМ ФУНКЦИЮ: Получение ВСЕХ не изученных слов (без учета лимита)
async function getAllUnlearnedWords(chatId) {
    if (!servicesInitialized || !sheetsService.initialized) {
        return [];
    }
    
    try {
        const userWords = await getCachedUserWords(chatId);
        
        optimizedLog(`🔍 Поиск ВСЕХ не изученных слов для ${chatId}`);

        const unlearnedWords = userWords.filter(word => {
            if (!word.nextReview || word.status !== 'active') return false;
            
            try {
                const isNewWord = word.interval === 1;
                const isNotLearned = !isWordLearned(chatId, word.english);
                return isNewWord && isNotLearned;
            } catch (error) {
                optimizedLog(`❌ Ошибка проверки слова "${word.english}"`);
                return false;
            }
        });

        optimizedLog(`📊 Найдено всех не изученных слов: ${unlearnedWords.length}`);
        
        unlearnedWords.sort((a, b) => new Date(b.createdDate) - new Date(a.createdDate));

        return unlearnedWords;
        
    } catch (error) {
        optimizedLog('❌ Error getting all unlearned words:', error);
        return [];
    }
}

// ✅ ФУНКЦИЯ: Получение НЕ ИЗУЧЕННЫХ слов
async function getUnlearnedNewWords(chatId) {
    if (!servicesInitialized || !sheetsService.initialized) {
        return [];
    }
    
    try {
        const userWords = await getCachedUserWords(chatId);
        const learnedToday = await getLearnedToday(chatId);
        const DAILY_LIMIT = 5;
        
        optimizedLog(`🔍 Поиск новых слов для ${chatId}, изучено сегодня: ${learnedToday}/${DAILY_LIMIT}`);

        const newWords = userWords.filter(word => {
            if (!word.nextReview || word.status !== 'active') return false;
            
            try {
                const isFirstInterval = word.interval === 1;
                const isNotLearned = !isWordLearned(chatId, word.english);
                
                if (isFirstInterval && isNotLearned) {
                    optimizedLog(`✅ Слово "${word.english}" - новое и не изучено`);
                }
                
                return isFirstInterval && isNotLearned;
            } catch (error) {
                optimizedLog(`❌ Ошибка проверки слова "${word.english}"`);
                return false;
            }
        });

        optimizedLog(`📊 Найдено не изученных слов: ${newWords.length}`);

        newWords.sort((a, b) => new Date(b.createdDate) - new Date(a.createdDate));

        const remainingSlots = Math.max(0, DAILY_LIMIT - learnedToday);
        const result = newWords.slice(0, remainingSlots);
        
        optimizedLog(`🎯 Будет показано: ${result.length} слов (осталось слотов: ${remainingSlots})`);
        return result;
        
    } catch (error) {
        optimizedLog('❌ Error getting unlearned new words:', error);
        return [];
    }
}

// Команды бота (сокращены для экономии места)
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    await initializeServices();
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

bot.onText(/\/review/, async (msg) => {
    const chatId = msg.chat.id;
    await startReviewSession(chatId);
});

bot.onText(/\/stats/, async (msg) => {
    const chatId = msg.chat.id;
    await showUserStats(chatId);
});

bot.onText(/\/new/, async (msg) => {
    const chatId = msg.chat.id;
    await startNewWordsSession(chatId);
});

// Обработка сообщений
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text || text.startsWith('/')) {
        return;
    }

    await initializeServices();
    updateUserActivity(chatId);

    const userState = userStates.get(chatId);

    if (text === '➕ Добавить новое слово') {
        userStates.set(chatId, { state: 'waiting_english', lastActivity: Date.now() });
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
        const englishWord = text.trim().toLowerCase();
        optimizedLog(`🔍 Обработка слова: "${englishWord}"`);

        if (!cambridgeService || !yandexService) {
            optimizedLog('❌ Сервисы не инициализированы');
            await showMainMenu(chatId, '❌ Сервисы временно недоступны. Попробуйте позже.');
            userStates.delete(chatId);
            return;
        }

        if (!/^[a-zA-Z\s\-'\.]+$/.test(englishWord)) {
            await showMainMenu(chatId, 
                '❌ Это не похоже на английское слово.\n' +
                'Пожалуйста, введите слово на английском:'
            );
            return;
        }

        await showMainMenu(chatId, '🔍 Ищу перевод, транскрипцию, произношение и примеры...');

        try {
            optimizedLog(`🎯 Начинаем поиск для: "${englishWord}"`);
            let audioId = null;
            let transcription = '';
            let audioUrl = '';
            let meanings = [];
            let translations = [];

            // Используем кешированные данные
            const cambridgeData = await getCachedWordData(englishWord);
            if (cambridgeData.meanings && cambridgeData.meanings.length > 0) {
                optimizedLog(`✅ Cambridge успешно: ${cambridgeData.meanings.length} значений`);
                meanings = cambridgeData.meanings;
                translations = meanings.map(m => m.translation).filter((t, i, arr) => arr.indexOf(t) === i);
                optimizedLog('📝 Найдены переводы:', translations);
            } else {
                optimizedLog('❌ Cambridge не вернул переводы');
                meanings = [];
                translations = [];
            }

            // Яндекс транскрипция
            optimizedLog('🔤 Запрашиваем транскрипцию у Яндекс...');
            try {
                const yandexData = await yandexService.getTranscriptionAndAudio(englishWord);
                transcription = yandexData.transcription || '';
                audioUrl = yandexData.audioUrl || '';
                if (audioUrl) {
                    audioId = Date.now().toString();
                }
                optimizedLog(`✅ Яндекс транскрипция: ${transcription}`);
            } catch (yandexError) {
                optimizedLog(`❌ Яндекс не сработал: ${yandexError.message}`);
                audioUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(englishWord)}&tl=en-gb&client=tw-ob`;
                audioId = Date.now().toString();
            }

            userStates.set(chatId, {
                state: 'showing_transcription',
                tempWord: englishWord,
                tempTranscription: transcription,
                tempAudioUrl: audioUrl,
                tempAudioId: audioId,
                tempTranslations: translations,
                meanings: meanings,
                selectedTranslationIndices: [],
                lastActivity: Date.now()
            });

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
            optimizedLog('Error getting word data:', error);
            await showMainMenu(chatId, 
                '❌ Ошибка при поиске слова\n\n' +
                'Попробуйте другое слово или повторите позже.'
            );
            userStates.delete(chatId);
        }
    }
    // Остальная логика обработки сообщений...
    else {
        await showMainMenu(chatId, 'Выберите действие из меню:');
    }
});

// Обработка callback_query (сокращена)
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;
    
    await initializeServices();
    updateUserActivity(chatId);

    await bot.answerCallbackQuery(callbackQuery.id);

    // Обработка различных callback_data...
    if (data === 'show_answer') {
        await showReviewAnswer(chatId);
    }
    else if (data.startsWith('review_')) {
        const rating = data.replace('review_', '');
        await processReviewRating(chatId, rating);
    }
    else if (data === 'skip_review') {
        const userState = userStates.get(chatId);
        if (userState?.state === 'review_session') {
            userState.currentReviewIndex++;
            userState.lastActivity = Date.now();
            
            if (userState.currentReviewIndex >= userState.reviewWords.length) {
                userState.currentReviewIndex = 0;
            }
            
            await showNextReviewWord(chatId);
        }
    }
    else if (data === 'learned_word') {
        await processNewWordLearning(chatId, 'learned');
    }
    else if (data === 'need_repeat_word') {
        await processNewWordLearning(chatId, 'repeat');
    }
    else if (data === 'skip_new_word') {
        const userState = userStates.get(chatId);
        if (userState?.state === 'learning_new_words') {
            const skippedWord = userState.newWords.splice(userState.currentWordIndex, 1)[0];
            userState.newWords.push(skippedWord);
            userState.lastActivity = Date.now();
            await showNextNewWord(chatId);
        }
    }
    // ... остальные обработчики callback_data
});

// Graceful shutdown
async function gracefulShutdown() {
    optimizedLog('💾 Сохраняем все батчи перед выходом...');
    
    if (batchSheetsService) {
        await batchSheetsService.flushAll();
    }
    
    bot.stopPolling();
    optimizedLog('✅ Все данные сохранены, выход');
    process.exit(0);
}

process.on('SIGINT', async () => {
    optimizedLog('🔄 Получен SIGINT, завершаем работу...');
    await gracefulShutdown();
});

process.on('SIGTERM', async () => {
    optimizedLog('🔄 Получен SIGTERM, завершаем работу...');
    await gracefulShutdown();
});

// Запускаем оптимизированные нотификации
setTimeout(() => {
    startOptimizedNotifications();
}, 5000);

optimizedLog('🤖 Бот запущен: Версия с оптимизациями для Railways!');

