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

// ✅ УЛУЧШЕННАЯ ФУНКЦИЯ: Показа деталей перевода
async function showTranslationDetails(chatId, translationIndex, userState) {
    try {
        const translation = userState.tempTranslations[translationIndex];
        
        // Ищем соответствующий перевод в meanings
        const meaning = userState.meanings.find(m => 
            m.translation && m.translation.trim() === translation.trim()
        );

        if (meaning) {
            let detailsMessage = `🔍 **Подробности перевода:**\n\n`;
            detailsMessage += `🇬🇧 **Слово:** ${userState.tempWord}\n`;
            detailsMessage += `🇷🇺 **Перевод:** ${translation}\n\n`;

            if (meaning.partOfSpeech && meaning.partOfSpeech.trim() !== '') {
                detailsMessage += `🔤 **Часть речи:** ${meaning.partOfSpeech}\n\n`;
            }

            if (meaning.englishDefinition && meaning.englishDefinition.trim() !== '') {
                detailsMessage += `📖 **Английское определение:**\n${meaning.englishDefinition}\n\n`;
            }

            if (meaning.examples && meaning.examples.length > 0) {
                detailsMessage += `📝 **Примеры использования:**\n`;
                meaning.examples.forEach((example, index) => {
                    if (index < 3) { // Показываем максимум 3 примера
                        detailsMessage += `\n${index + 1}. ${example.english}`;
                        if (example.russian && example.russian.trim() !== '') {
                            detailsMessage += `\n   ${example.russian}`;
                        }
                    }
                });
            } else {
                detailsMessage += `📝 **Примеры:** не найдены\n`;
            }

            await bot.sendMessage(chatId, detailsMessage, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔙 Назад к выбору переводов', callback_data: 'back_to_translations' }]
                    ]
                }
            });
        } else {
            await bot.sendMessage(chatId, 
                `❌ Информация о переводе не найдена\n\n` +
                `Перевод: "${translation}"\n` +
                `Попробуйте выбрать другой перевод.`
            );
        }
    } catch (error) {
        optimizedLog('❌ Error showing translation details:', error);
        await bot.sendMessage(chatId, '❌ Ошибка при показе подробностей перевода');
    }
}

function toMoscowTime(date) {
    if (!date) return date;
    
    try {
        const moscowOffset = 3 * 60 * 60 * 1000; // +3 часа для Москвы
        return new Date(date.getTime() + moscowOffset);
    } catch (error) {
        return date;
    }
}

function formatMoscowDate(date) {
    if (!date) return 'дата не указана';
    
    try {
        const moscowDate = toMoscowTime(new Date(date));
        const day = moscowDate.getDate().toString().padStart(2, '0');
        const month = (moscowDate.getMonth() + 1).toString().padStart(2, '0');
        const year = moscowDate.getFullYear();
        const hours = moscowDate.getHours().toString().padStart(2, '0');
        const minutes = moscowDate.getMinutes().toString().padStart(2, '0');
        
        return `${day}.${month}.${year} ${hours}:${minutes}`;
    } catch (error) {
        return 'ошибка даты';
    }
}

// ✅ ВОССТАНОВЛЕНО: Функция возврата к выбору переводов
async function backToTranslationSelection(chatId, userState, callbackQuery) {
    try {
        let translationMessage = '🎯 **Выберите переводы:**\n\n' +
            `🇬🇧 **${userState.tempWord}**`;
        if (userState.tempTranscription) {
            translationMessage += `\n🔤 Транскрипция: ${userState.tempTranscription}`;
        }
        translationMessage += '\n\n💡 Нажмите на перевод чтобы выбрать его, или 🔍 для подробностей';

        await bot.sendMessage(chatId, translationMessage, {
            parse_mode: 'Markdown',
            ...getTranslationSelectionKeyboard(userState.tempTranslations, userState.meanings, userState.selectedTranslationIndices)
        });

        try {
            await bot.deleteMessage(chatId, callbackQuery.message.message_id);
        } catch (deleteError) {
            optimizedLog('⚠️ Не удалось удалить сообщение с деталями, продолжаем...');
        }
    } catch (error) {
        optimizedLog('❌ Error going back to translations:', error);
        await bot.sendMessage(chatId, '❌ Ошибка при возврате к выбору переводов');
    }
}

// ✅ ОБНОВЛЕННАЯ ФУНКЦИЯ: Инициализация сервисов с FSRS
async function initializeServices() {
    if (servicesInitialized) return true;
    
    try {
        optimizedLog('🔄 Initializing services...');
        sheetsService = new GoogleSheetsService();
        batchSheetsService = new BatchSheetsService(sheetsService);
        yandexService = new YandexDictionaryService();
        cambridgeService = new CambridgeDictionaryService();
        fsrsService = new FSRSService();
        
        // Ждем инициализацию Google Sheets
        await new Promise(resolve => {
            const checkInitialized = () => {
                if (sheetsService.initialized) {
                    resolve();
                } else {
                    setTimeout(checkInitialized, 100);
                }
            };
            checkInitialized();
        });
        
        servicesInitialized = true;
        optimizedLog('✅ Все сервисы успешно инициализированы');
        return true;
    } catch (error) {
        optimizedLog('❌ Ошибка инициализации сервисов:', error);
        // ✅ Создаем заглушки чтобы бот не падал
        sheetsService = { 
            initialized: false,
            hasWordsForReview: () => false,
            getReviewWordsCount: () => 0,
            getUserWords: () => [],
            getWordsForReview: () => [],
            getNewWordsCount: () => 0,
            getAllActiveUsers: () => [],
            addWordWithMeanings: async () => false,
            updateWordAfterFSRSReview: async () => false,
            batchUpdateWords: async () => false,
            resetUserProgress: async () => true
        };
        yandexService = { 
            getTranscriptionAndAudio: async () => ({ transcription: '', audioUrl: '' })
        };
        cambridgeService = { 
            getWordData: async () => ({ meanings: [] })
        };
        fsrsService = new FSRSService();
        batchSheetsService = {
            updateWordReviewBatch: async () => true,
            flushAll: async () => {}
        };
        servicesInitialized = true;
        return false;
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

// ✅ ФУНКЦИЯ: Проверка с учетом часового пояса
function isReviewDue(nextReviewDate) {
    if (!nextReviewDate) return false;
    
    try {
        const reviewDate = new Date(nextReviewDate);
        const now = new Date();
        
        // ✅ ИСПРАВЛЕНИЕ: Добавляем запас +3 часа для московского времени
        const timezoneOffset = 3 * 60 * 60 * 1000; // +3 часа в миллисекундах
        const adjustedNow = new Date(now.getTime() + timezoneOffset);
        
        return reviewDate <= adjustedNow;
    } catch (error) {
        return false;
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
        const now = new Date();
        
        // Московское время
        const moscowOffset = 3 * 60 * 60 * 1000;
        const moscowNow = new Date(now.getTime() + moscowOffset);
        const todayStart = new Date(moscowNow);
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date(moscowNow);
        todayEnd.setHours(23, 59, 59, 999);
        
        let learnedToday = 0;

        userWords.forEach(word => {
            if (word.status !== 'active') return;
            
            // ✅ Учитываем ТОЛЬКО слова которые ПЕРВЫЙ РАЗ изучены сегодня
            if (word.interval > 1 && word.firstLearnedDate && word.firstLearnedDate.trim() !== '') {
                try {
                    const learnedDate = new Date(word.firstLearnedDate);
                    const moscowLearned = new Date(learnedDate.getTime() + moscowOffset);
                    
                    if (moscowLearned >= todayStart && moscowLearned <= todayEnd) {
                        learnedToday++;
                        optimizedLog(`✅ Слово "${word.english}" изучено СЕГОДНЯ впервые: ${moscowLearned.toLocaleString('ru-RU')}`);
                    }
                } catch (error) {
                    optimizedLog(`❌ Ошибка даты для "${word.english}":`, error);
                }
            }
        });

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
    if (!translations || translations.length === 0) {
        optimizedLog('❌ No translations provided to keyboard function');
        return {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '✏️ Добавить свой перевод', callback_data: 'custom_translation' }],
                    [{ text: '🔙 Назад', callback_data: 'cancel_translation' }]
                ]
            }
        };
    }

    const translationButtons = [];
    
    translations.forEach((translation, index) => {
        const isSelected = selectedIndices.includes(index);
        const numberEmoji = getNumberEmoji(index + 1);
        const emoji = isSelected ? '✅' : numberEmoji;
        
        const buttonText = `${emoji} ${translation.substring(0, 30)}${translation.length > 30 ? '...' : ''}`;
        
        const row = [
            { 
                text: buttonText, 
                callback_data: `toggle_translation_${index}` 
            }
        ];
        
        // ✅ ИСПРАВЛЕНО: Правильное определение наличия деталей
        const meaningForTranslation = meanings?.find(m => 
            m.translation && m.translation.trim() === translation.trim()
        );
        
        const hasDetails = meaningForTranslation && (
            (meaningForTranslation.englishDefinition && meaningForTranslation.englishDefinition.trim() !== '') ||
            (meaningForTranslation.examples && meaningForTranslation.examples.length > 0) ||
            (meaningForTranslation.partOfSpeech && meaningForTranslation.partOfSpeech.trim() !== '')
        );
        
        optimizedLog(`🔍 Translation "${translation}" has details: ${hasDetails}`);
        
        if (hasDetails) {
            row.push({ 
                text: '🔍 Подробнее',
                callback_data: `details_${index}` 
            });
        }
        
        translationButtons.push(row);
    });

    const actionButtons = [];
    
    if (selectedIndices.length > 0) {
        actionButtons.push([
            { 
                text: `💾 Сохранить (${selectedIndices.length})`, 
                callback_data: 'save_selected_translations' 
            }
        ]);
    }
    
    actionButtons.push([
        { 
            text: '✏️ Свой перевод', 
            callback_data: 'custom_translation' 
        },
        { 
            text: '🔙 Назад', 
            callback_data: 'cancel_translation' 
        }
    ]);

    return {
        reply_markup: {
            inline_keyboard: [...translationButtons, ...actionButtons]
        }
    };
}

// Вспомогательная функция для эмодзи номеров
function getNumberEmoji(number) {
    const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
    return number <= emojis.length ? emojis[number - 1] : `${number}.`;
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
                    { text: '✍️ Правописание', callback_data: 'spelling_train' }
                ]
            ]
        }
    };
}

// Клавиатура для новых слов
function getNewWordsKeyboard() {
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: '✅ Выучил', callback_data: 'learned_word' }],
                [{ text: '🔄 Нужно повторить', callback_data: 'need_repeat_word' }],
                [{ text: '✍️ Правописание', callback_data: 'spelling_train' }],
                [{ text: '⏭️ Пропустить слово', callback_data: 'skip_new_word' }]
            ]
        }
    };
}

// Функция для принудительного показа меню
async function showMainMenu(chatId, text = '') {
    try {
        if (text && text.trim() !== '') {
            return await bot.sendMessage(chatId, text, {
                parse_mode: 'Markdown',
                ...getMainMenu()
            });
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

// ✅ ОБНОВЛЕННАЯ ФУНКЦИЯ: Сохранение слова с FSRS карточкой
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

        // Создаем FSRS карточку для нового слова
        const fsrsCard = fsrsService.createNewCard();
        
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

// ✅ ОБНОВЛЕННАЯ ФУНКЦИЯ: Проверка есть ли слова для повторения
async function hasWordsForReview(userId) {
    if (!servicesInitialized || !sheetsService.initialized) {
        return false;
    }
    
    try {
        const wordsToReview = await sheetsService.getWordsForReview(userId);
        
        // ✅ ДОПОЛНИТЕЛЬНАЯ ПРОВЕРКА: только слова с интервалом > 1
        const validReviewWords = wordsToReview.filter(word => word.interval > 1);
        
        optimizedLog(`🔍 Check review words for ${userId}: ${validReviewWords.length} valid words`);
        return validReviewWords.length > 0;
        
    } catch (error) {
        optimizedLog('❌ Error checking words for review:', error);
        return false;
    }
}

// ✅ УПРОЩЕННАЯ ВЕРСИЯ: Отправка нотификаций
async function sendReviewNotification(chatId) {
    try {
        const hasWords = await hasWordsForReview(chatId);
        
        if (hasWords) {
            const wordsCount = await sheetsService.getReviewWordsCount(chatId);
            const userWords = await getCachedUserWords(chatId);
            
            const newWords = userWords.filter(word => word.interval === 1).length;
            
            let message = '🔔 **Время учить английский!**\n\n';
            
            if (wordsCount > 0) {
                message += `📚 **Готово к повторению:** ${wordsCount} слов\n`;
            }
            
            if (newWords > 0) {
                message += `🆕 **Новых слов доступно:** ${newWords}\n`;
            }
            
            message += `\n💪 Потратьте всего 5-10 минут на изучение!`;

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
            
            await bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                ...keyboard
            });
            
            optimizedLog(`✅ Sent notification to ${chatId}`);
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

// ✅ УПРОЩЕННАЯ ВЕРСИЯ: Проверка и отправка нотификаций
async function checkAndSendNotifications() {
    optimizedLog('🔔 Checking notifications for all users...');
    
    if (!servicesInitialized || !sheetsService.initialized) {
        optimizedLog('❌ Sheets service not initialized, skipping notifications');
        return;
    }
    
    try {
        const activeUsers = await sheetsService.getAllActiveUsers();
        optimizedLog(`📋 Found ${activeUsers.length} active users`);
        
        let sentCount = 0;
        
        for (const userId of activeUsers) {
            try {
                const sent = await sendReviewNotification(userId);
                if (sent) {
                    sentCount++;
                    // Задержка между отправками
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            } catch (userError) {
                optimizedLog(`❌ Error processing user ${userId}:`, userError);
            }
        }
        
        optimizedLog(`📢 Notification check completed: ${sentCount} sent`);
        
    } catch (error) {
        optimizedLog('❌ Error in notification check:', error);
    }
}

// ✅ ДОБАВЛЕНО: Простой тренажер правописания
async function startSpellingTraining(chatId, context) {
    const userState = userStates.get(chatId);
    if (!userState) return;

    let word;
    let originalState;

    if (context === 'review' && userState.state === 'review_session') {
        word = userState.reviewWords[userState.currentReviewIndex];
        originalState = { ...userState };
    } else if (context === 'learning' && userState.state === 'learning_new_words') {
        word = userState.newWords[userState.currentWordIndex];
        originalState = { ...userState };
    } else {
        return;
    }

    if (!word) return;

    // Сохраняем оригинальное состояние и запускаем тренажер
    userStates.set(chatId, {
        state: 'spelling_training',
        originalState: originalState,
        originalContext: context,
        trainingWord: word,
        attempts: 0,
        lastActivity: Date.now()
    });

    await askSpellingQuestion(chatId, word);
}

// ✅ ДОБАВЛЕНО: Задать вопрос по правописанию
async function askSpellingQuestion(chatId, word) {
    const message = `✍️ **Тренировка правописания**\n\n` +
                   `🇷🇺 Перевод: **${word.meanings[0]?.translation || 'перевод'}**\n\n` +
                   `✏️ Напишите английское слово:`;

    await bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: {
            keyboard: [['🔙 Назад к карточке']],
            resize_keyboard: true
        }
    });
}

// ✅ ДОБАВЛЕНО: Проверить ответ
async function checkSpellingAnswer(chatId, userAnswer) {
    const userState = userStates.get(chatId);
    if (!userState || userState.state !== 'spelling_training') return;

    const word = userState.trainingWord;
    const correct = word.english.toLowerCase();
    const answer = userAnswer.trim().toLowerCase();
    
    userState.attempts++;

    if (answer === correct) {
        await bot.sendMessage(chatId, 
            `✅ **Правильно!**\n\n` +
            `🇬🇧 ${word.english}\n` +
            `🔤 ${word.transcription || ''}`
        );
        
        // Возвращаем к карточке через 2 секунды
        setTimeout(() => returnToCard(chatId, userState), 2000);
    } else {
        await bot.sendMessage(chatId, 
            `❌ Неправильно. Попробуйте еще раз!\n` +
            `💡 Подсказка: начинается на "${word.english[0]}"`
        );
        
        // После 3 попыток показываем ответ
        if (userState.attempts >= 3) {
            setTimeout(async () => {
                await bot.sendMessage(chatId, 
                    `💡 Правильный ответ: **${word.english}**\n` +
                    `Возвращаем к карточке...`
                );
                setTimeout(() => returnToCard(chatId, userState), 2000);
            }, 1000);
        }
    }
}

// ✅ ДОБАВЛЕНО: Вернуться к карточке
async function returnToCard(chatId, userState) {
    const originalState = userState.originalState;
    const context = userState.originalContext;
    
    // Восстанавливаем оригинальное состояние
    userStates.set(chatId, originalState);
    
    if (context === 'review') {
        await showReviewAnswer(chatId);
    } else if (context === 'learning') {
        await showNextNewWord(chatId);
    }
}

// ✅ УПРОЩЕННАЯ ВЕРСИЯ: Запуск нотификаций
function startOptimizedNotifications() {
    optimizedLog('💰 Запуск оптимизированных нотификаций...');
    
    // Основная проверка каждые 2 часа
    setInterval(async () => {
        await checkAndSendNotifications().catch(console.error);
    }, 2 * 60 * 60 * 1000);
    
    // Утренняя нотификация в 9:00
    scheduleMorningNotification();
}

function scheduleMorningNotification() {
    const now = new Date();
    const nextMorning = new Date();
    
    nextMorning.setHours(9, 0, 0, 0);
    if (now >= nextMorning) {
        nextMorning.setDate(nextMorning.getDate() + 1);
    }
    
    const timeUntilMorning = nextMorning.getTime() - now.getTime();
    
    setTimeout(() => {
        optimizedLog('🌅 Sending morning notifications...');
        checkAndSendNotifications();
        scheduleMorningNotification();
    }, timeUntilMorning);
}

// ✅ ОБНОВЛЕННАЯ ФУНКЦИЯ: Начало сессии повторения с FSRS
async function startReviewSession(chatId) {
    await initializeServices();
    
    // ✅ ПРЕЖДЕ ЧЕМ НАЧАТЬ: Очищаем предыдущее состояние
    const existingState = userStates.get(chatId);
    if (existingState) {
        optimizedLog(`⚠️ Очищаем предыдущее состояние для ${chatId}: ${existingState.state}`);
        userStates.delete(chatId);
        
        // Очищаем кеш
        const cacheKey = `words_${chatId}`;
        cache.delete(cacheKey);
    }
    
    if (!sheetsService.initialized) {
        await bot.sendMessage(chatId, '❌ Google Sheets не инициализирован.');
        return;
    }

    try {
        const wordsToReview = await sheetsService.getWordsForReview(chatId);
        
        // ✅ ДОПОЛНИТЕЛЬНЫЙ ФИЛЬТР: только изученные слова
        const validReviewWords = wordsToReview.filter(word => word.interval > 1);
        
        optimizedLog(`🔍 Review session for ${chatId}: ${validReviewWords.length} valid words`);
        
        if (validReviewWords.length === 0) {
            // Показываем детальную информацию
            const userWords = await getCachedUserWords(chatId);
            const activeWords = userWords.filter(word => word.status === 'active');
            const learnedWords = activeWords.filter(word => word.interval > 1);
            const newWords = activeWords.filter(word => word.interval === 1);
            
            let message = '📊 **Статус повторений:**\n\n';
            message += `• Всего активных слов: ${activeWords.length}\n`;
            message += `• Изученных слов: ${learnedWords.length}\n`;
            message += `• Новых слов: ${newWords.length}\n`;
            message += `• Слов готово к повторению: 0\n\n`;
            
            if (learnedWords.length === 0) {
                message += '💡 Сначала изучите слова в разделе "🆕 Новые слова"';
            } else {
                message += '⏰ Слова появятся для повторения согласно их интервалам';
            }
            
            await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
            return;
        }

        // ✅ СОЗДАЕМ НОВОЕ СОСТОЯНИЕ С ПРАВИЛЬНЫМИ СЧЕТЧИКАМИ
        userStates.set(chatId, {
            state: 'review_session',
            reviewWords: validReviewWords,
            originalWordsCount: validReviewWords.length,
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
    if (!userState || userState.state !== 'review_session') {
        await bot.sendMessage(chatId, '❌ Сессия повторения не найдена. Начните заново.');
        return;
    }

    const { reviewWords } = userState;
    
    if (!reviewWords || reviewWords.length === 0) {
        console.log('🎯 showNextReviewWord: массив reviewWords пуст, завершение сессии');
        await completeReviewSession(chatId, userState);
        return;
    }
    
    if (userState.currentReviewIndex >= reviewWords.length) {
        console.log('🔄 showNextReviewWord: индекс вышел за границы, сбрасываем в 0');
        userState.currentReviewIndex = 0;
    }

    const word = reviewWords[userState.currentReviewIndex];
    
    if (!word) {
        console.log('❌ showNextReviewWord: слово не найдено по индексу', userState.currentReviewIndex);
        userState.reviewWords.splice(userState.currentReviewIndex, 1);
        userState.lastActivity = Date.now();
        await showNextReviewWord(chatId);
        return;
    }
    
    const progress = `${userState.currentReviewIndex + 1}/${reviewWords.length} (${userState.reviewedCount} оценено)`;
    
    let message = `📚 Повторение слов ${progress}\n\n`;
    message += `🇬🇧 **${word.english}**\n`;
    
    if (word.transcription) {
        message += `🔤 ${word.transcription}\n`;
    }
    
    message += `\n💡 Вспомните перевод и нажмите "Показать ответ"`;

    await bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '👀 Показать ответ', callback_data: 'show_answer' }],
                [{ text: '⏭️ Пропустить', callback_data: 'skip_review' }],
                [{ text: '❌ Завершить повторение', callback_data: 'end_review' }]
            ]
        }
    });
}

// ✅ ОБНОВЛЕННАЯ ФУНКЦИЯ: Показать ответ для повторения
async function showReviewAnswer(chatId) {
    const userState = userStates.get(chatId);
    if (!userState || userState.state !== 'review_session') {
        await bot.sendMessage(chatId, '❌ Сессия повторения не найдена.');
        return;
    }

    const word = userState.reviewWords[userState.currentReviewIndex];
    
    if (!word) {
        await bot.sendMessage(chatId, '❌ Ошибка: слово не найдено.');
        return;
    }
    
    let message = `📚 **Ответ:**\n\n`;
    message += `🇬🇧 **${word.english}**\n`;
    
    if (word.transcription) {
        message += `🔤 ${word.transcription}\n`;
    }
    
    message += `\n🇷🇺 **Переводы:**\n`;
    
    if (word.meanings && Array.isArray(word.meanings)) {
        word.meanings.forEach((meaning, index) => {
            message += `\n${index + 1}. ${meaning.translation || 'Перевод не указан'}`;
            if (meaning.definition) {
                message += ` - ${meaning.definition}`;
            }
            if (meaning.example && meaning.example.trim() !== '') {
                message += `\n   📝 *Пример:* ${meaning.example}`;
            }
        });
    } else {
        message += `\n❌ Переводы не найдены`;
    }

    if (word.audioUrl) {
        try {
            await bot.sendAudio(chatId, word.audioUrl, {
                caption: '🔊 Произношение'
            });
        } catch (error) {
            optimizedLog('❌ Audio not available for review word:', error);
        }
    }

    await bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        ...getReviewKeyboard()
    });
}

// ✅ ОБНОВЛЕННАЯ ФУНКЦИЯ: Обработка оценки повторения с FSRS
async function processReviewRating(chatId, rating) {
    const userState = userStates.get(chatId);
    if (!userState || userState.state !== 'review_session') {
        return;
    }

    if (userState.currentReviewIndex >= userState.reviewWords.length) {
        await completeReviewSession(chatId, userState);
        return;
    }

    const word = userState.reviewWords[userState.currentReviewIndex];
    
    if (!word) {
        userState.reviewWords.splice(userState.currentReviewIndex, 1);
        userState.lastActivity = Date.now();
        await showNextReviewWord(chatId);
        return;
    }

    try {
        // Подготавливаем данные карточки для FSRS
        const cardData = {
            due: word.nextReview ? new Date(word.nextReview) : new Date(),
            stability: word.stability || 0.1,
            difficulty: word.difficulty || 5.0,
            elapsed_days: word.elapsed_days || 0,
            scheduled_days: word.scheduled_days || 1,
            reps: word.reps || 0,
            lapses: word.lapses || 0,
            state: word.state || 1,
            last_review: word.lastReview ? new Date(word.lastReview) : new Date()
        };

        console.log('🔄 Processing review for word:', word.english, 'rating:', rating);
        console.log('📝 Card data:', cardData);

        // Используем FSRS для обновления карточки
        const fsrsResult = await fsrsService.reviewCard(chatId, word.english, cardData, rating);
        
        if (fsrsResult) {
            console.log('✅ FSRS result received:', fsrsResult);
            
            const success = await sheetsService.updateWordAfterFSRSReview(
                chatId,
                word.english,
                fsrsResult,
                rating
            );
            
            if (success) {
                userState.reviewedCount = (userState.reviewedCount || 0) + 1;
                userState.reviewWords.splice(userState.currentReviewIndex, 1);
                
                if (userState.reviewWords.length === 0) {
                    await completeReviewSession(chatId, userState);
                } else {
                    userState.lastActivity = Date.now();
                    await showNextReviewWord(chatId);
                }
            } else {
                throw new Error('Failed to save to Google Sheets');
            }
        } else {
            throw new Error('FSRS returned empty result');
        }

    } catch (error) {
        console.error('❌ Error processing review rating:', error);
        // Fallback: просто удаляем слово из списка и продолжаем
        userState.reviewWords.splice(userState.currentReviewIndex, 1);
        
        if (userState.reviewWords.length === 0) {
            await completeReviewSession(chatId, userState);
        } else {
            userState.lastActivity = Date.now();
            await showNextReviewWord(chatId);
        }
    }
}

// ✅ ОБНОВЛЕННАЯ ФУНКЦИЯ: Завершение сессии повторения
async function completeReviewSession(chatId, userState) {
    const totalWordsAtStart = userState.originalWordsCount || userState.reviewWords?.length || 0;
    const reviewedCount = userState.reviewedCount || 0;
    const remainingWords = userState.reviewWords?.length || 0;
    
    userStates.delete(chatId);
    
    const cacheKeys = [
        `words_${chatId}`,
        `review_${chatId}`
    ];
    cacheKeys.forEach(key => cache.delete(key));
    
    const totalProcessed = reviewedCount + remainingWords;
    const actualReviewed = reviewedCount;
    
    let message = '🎉 **Сессия повторения завершена!**\n\n';
    message += `📊 Результаты:\n`;
    message += `• Всего слов в сессии: ${totalProcessed}\n`;
    message += `• Успешно повторено: ${actualReviewed}\n`;
    
    if (remainingWords > 0) {
        message += `• Пропущено/ошибок: ${remainingWords}\n`;
    }
    
    if (totalProcessed > 0) {
        const progressPercentage = Math.round((actualReviewed / totalProcessed) * 100);
        message += `• Прогресс: ${progressPercentage}%\n\n`;
    } else {
        message += `\n`;
    }
    
    const hasMoreWords = await hasWordsForReview(chatId);
    if (hasMoreWords) {
        const remainingCount = await sheetsService.getReviewWordsCount(chatId);
        message += `📚 Осталось слов для повторения: ${remainingCount}\n`;
    } else {
        message += `✅ Все слова повторены!\n`;
    }
    
    message += `\n💡 Вы можете:\n`;
    message += `• Начать новую сессию повторения\n`;
    message += `• Изучить новые слова\n`;
    message += `• Посмотреть статистику\n`;
    
    await bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        ...getMainMenu()
    });
}

// ✅ ОБНОВЛЕННАЯ ФУНКЦИЯ: Начало сессии изучения новых слов
async function startNewWordsSession(chatId) {
    await initializeServices();
    
    const existingState = userStates.get(chatId);
    if (existingState && existingState.state === 'learning_new_words') {
        optimizedLog(`⚠️ Завершаем предыдущую сессию изучения для ${chatId}`);
        await completeNewWordsSession(chatId, existingState);
    }
    
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

        const availableNewWords = await getAllUnlearnedWords(chatId);
        
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

// ✅ ФУНКЦИЯ: Получение доступных новых слов на сегодня
async function getAllUnlearnedWords(chatId) {
    if (!servicesInitialized || !sheetsService.initialized) {
        return [];
    }
    
    try {
        const userWords = await getCachedUserWords(chatId);
        
        optimizedLog(`🔍 Поиск новых слов для ${chatId}, всего слов: ${userWords.length}`);

        // ✅ ПРАВИЛЬНАЯ ЛОГИКА: Только слова, которые НИКОГДА не изучались
        const unlearnedWords = userWords.filter(word => {
            if (word.status !== 'active') {
                return false;
            }
            
            // Новое слово = interval=1 И нет firstLearnedDate
            const isNewWord = word.interval === 1 && 
                            (!word.firstLearnedDate || word.firstLearnedDate.trim() === '');
            
            return isNewWord;
        });

        optimizedLog(`📊 Найдено новых слов (никогда не изучавшихся): ${unlearnedWords.length}`);
        
        // Логируем для отладки
        if (unlearnedWords.length > 0) {
            unlearnedWords.forEach(word => {
                optimizedLog(`🔍 Новое слово: "${word.english}", interval: ${word.interval}, firstLearnedDate: "${word.firstLearnedDate}"`);
            });
        }
        
        unlearnedWords.sort((a, b) => new Date(b.createdDate) - new Date(a.createdDate));

        return unlearnedWords;
        
    } catch (error) {
        optimizedLog('❌ Error getting unlearned words:', error);
        return [];
    }
}

// ✅ ОБНОВЛЕННАЯ ФУНКЦИЯ: Показ следующего нового слова
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
    
    const wordStatus = word.firstLearnedDate ? 
        `🔄 Возвращено на повторение (изучено: ${formatMoscowDate(word.firstLearnedDate)})` : 
        `🆕 Новое слово`;
    
    let message = `🎯 Изучение слов ${progress}\n\n`;
    message += `📊 Изучено сегодня: ${currentLearnedToday}/5\n`;
    message += `📝 Статус: ${wordStatus}\n\n`;
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

    await bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        ...getNewWordsKeyboard()
    });
}

// ✅ ОБНОВЛЕННАЯ ФУНКЦИЯ: Обработка изучения нового слова с FSRS
async function processNewWordLearning(chatId, action) {
    const userState = userStates.get(chatId);
    if (!userState || userState.state !== 'learning_new_words') return;

    const word = userState.newWords[userState.currentWordIndex];
    
    try {
        if (action === 'learned') {
            console.log('🎯 Processing word learning:', word.english);
            
            // Используем FSRS для обработки изучения нового слова
            const cardData = fsrsService.createNewCard();
            const fsrsResult = await fsrsService.reviewCard(chatId, word.english, cardData, 'good');
            console.log('📊 FSRS result:', fsrsResult);
            
            if (fsrsResult) {
                // ✅ ВАЖНОЕ ИСПРАВЛЕНИЕ: Устанавливаем firstLearnedDate для новых слов
                // Если слово изучается впервые (было новым словом), устанавливаем дату
                const shouldSetFirstLearnedDate = word.interval === 1 && 
                                                (!word.firstLearnedDate || word.firstLearnedDate.trim() === '');
                
                if (shouldSetFirstLearnedDate) {
                    fsrsResult.firstLearnedDate = new Date().toISOString();
                    console.log('✅ Setting firstLearnedDate for new word:', fsrsResult.firstLearnedDate);
                }

                const success = await sheetsService.updateWordAfterFSRSReview(
                    chatId,
                    word.english,
                    fsrsResult,
                    'good'
                );
     
                if (!success) {
                    throw new Error('Failed to save word progress to Google Sheets');
                }

                userState.learnedCount++;
                markWordAsLearned(chatId, word.english);
                optimizedLog(`📚 Слово "${word.english}" изучено сегодня. Interval: ${fsrsResult.interval}`);
                
                userState.newWords.splice(userState.currentWordIndex, 1);
                
                optimizedLog(`✅ Слово "${word.english}" удалено из списка. Осталось слов: ${userState.newWords.length}`);
                
                const currentLearnedToday = await getLearnedToday(chatId);
                optimizedLog(`📈 После изучения "${word.english}": ${currentLearnedToday}/5 изучено сегодня`);
                
                if (userState.newWords.length === 0) {
                    optimizedLog(`🎯 Все слова изучены, завершение сессии`);
                    await completeNewWordsSession(chatId, userState);
                    return;
                }
                
                if (currentLearnedToday >= 5) {
                    await bot.sendMessage(chatId, 
                        `🎉 Вы достигли дневного лимита в 5 слов!\n\n` +
                        `📊 Изучено сегодня: ${currentLearnedToday}/5\n\n` +
                        '💡 Возвращайтесь завтра для изучения новых слов.'
                    );
                    await completeNewWordsSession(chatId, userState);
                    return;
                }
                
                if (userState.currentWordIndex >= userState.newWords.length) {
                    userState.currentWordIndex = 0;
                }
                
            } else {
                throw new Error('FSRS returned empty result');
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
        
        if (userState.newWords.length === 0) {
            optimizedLog(`🎯 Все слова обработаны, завершение сессии`);
            await completeNewWordsSession(chatId, userState);
            return;
        }
        
        if (userState.currentWordIndex >= userState.newWords.length) {
            userState.currentWordIndex = 0;
            optimizedLog(`🔄 Индекс сброшен в 0 (достигнут конец массива)`);
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

// ✅ ОБНОВЛЕННАЯ ФУНКЦИЯ: Завершение сессии изучения новых слов
async function completeNewWordsSession(chatId, userState) {
    userStates.delete(chatId);
    
    const currentLearnedToday = await getLearnedToday(chatId);
    const originalWordsCount = userState.originalWordsCount || 0;
    const learnedCount = userState.learnedCount || 0;
    
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
    
    await bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        ...getMainMenu()
    });
}

// ✅ ОБНОВЛЕННАЯ ФУНКЦИЯ: Показ статистики
async function showUserStats(chatId) {
    await initializeServices();
    
    if (!sheetsService.initialized) {
        await bot.sendMessage(chatId, '❌ Google Sheets не инициализирован.');
        return;
    }

    try {
        const userWords = await getCachedUserWords(chatId);
        const activeWords = userWords.filter(word => word.status === 'active');
        
        // ✅ ПРАВИЛЬНАЯ ЛОГИКА: Новые слова - только те, что НИКОГДА не изучались
        const newWords = activeWords.filter(word => 
            word.interval === 1 && 
            (!word.firstLearnedDate || word.firstLearnedDate.trim() === '')
        );
        const newWordsCount = newWords.length;
        
        // ✅ ПРАВИЛЬНАЯ ЛОГИКА: Слова для повторения - изученные слова с наступившей датой
        const reviewWords = await sheetsService.getWordsForReview(chatId);
        const reviewWordsCount = reviewWords.length;
        
        const totalWordsCount = activeWords.length;
        const learnedToday = await getLearnedToday(chatId);
        const DAILY_LIMIT = 5;
        const remainingToday = Math.max(0, DAILY_LIMIT - learnedToday);
        
        // ✅ ПРАВИЛЬНАЯ ЛОГИКА: Изученные слова - те, что изучались хоть раз
        const learnedWords = activeWords.filter(word => 
            word.interval > 1 || 
            (word.firstLearnedDate && word.firstLearnedDate.trim() !== '')
        );
        const learnedWordsCount = learnedWords.length;
        
        let message = '📊 **Ваша статистика:**\n\n';
        message += `📚 Всего слов в словаре: ${totalWordsCount}\n`;
        message += `🎓 Изучено слов: ${learnedWordsCount}\n`;
        message += `🆕 Новых слов доступно: ${newWordsCount}\n`;
        message += `🔄 Слов для повторения: ${reviewWordsCount}\n`;
        message += `📅 Изучено сегодня: ${learnedToday}/${DAILY_LIMIT}\n`;
        
        // Проверка целостности данных
        const calculatedTotal = learnedWordsCount + newWordsCount;
        if (calculatedTotal !== totalWordsCount) {
            const discrepancy = totalWordsCount - calculatedTotal;
            message += `\n⚠️ **Расхождение в данных:** ${discrepancy} слов имеют нестандартный статус\n`;
            
            // Покажем эти слова для отладки
            const conflictWords = activeWords.filter(word => 
                word.interval === 1 && 
                word.firstLearnedDate && 
                word.firstLearnedDate.trim() !== ''
            );
            
            if (conflictWords.length > 0) {
                message += `🔍 Слова с interval=1 но firstLearnedDate: ${conflictWords.length}\n`;
            }
        }
        
        if (remainingToday > 0) {
            message += `🎯 Осталось изучить сегодня: ${remainingToday} слов\n`;
        } else {
            message += `✅ Дневной лимит достигнут!\n`;
        }

        // Ближайшие повторения
        const now = new Date();
        const futureWords = activeWords.filter(word => {
            if (!word.nextReview || word.interval <= 1) return false;
            try {
                const nextReview = new Date(word.nextReview);
                const moscowOffset = 3 * 60 * 60 * 1000;
                const moscowNow = new Date(now.getTime() + moscowOffset);
                const moscowReview = new Date(nextReview.getTime() + moscowOffset);
                
                return moscowReview > moscowNow;
            } catch (e) {
                return false;
            }
        });
        
        futureWords.sort((a, b) => new Date(a.nextReview) - new Date(b.nextReview));
        const nearestWords = futureWords.slice(0, 5);
        
        if (nearestWords.length > 0) {
            message += `\n⏰ **Ближайшие повторения:**\n`;
            
            nearestWords.forEach((word, index) => {
                const reviewDate = new Date(word.nextReview);
                message += `• ${formatTimeWithCountdown(reviewDate)}: ${word.english}\n`;
            });
            
            if (futureWords.length > 5) {
                const remainingCount = futureWords.length - 5;
                message += `• ... и еще ${remainingCount} слов\n`;
            }
        } else if (reviewWordsCount > 0) {
            message += `\n⏰ **Ближайшее повторение:** 🔔 ГОТОВО СЕЙЧАС!\n`;
            message += `🎯 Начните повторение через меню "📚 Повторить слова"\n`;
        } else {
            message += `\n⏰ **Ближайшее повторение:** пока нет запланированных\n`;
        }
        
        // Время сервера
        const serverTime = new Date();
        const moscowTime = toMoscowTime(serverTime);
        
        message += `\n🕐 **Время сервера:** ${formatTimeDetailed(serverTime)}`;
        message += `\n🇷🇺 **Московское время:** ${formatTimeDetailed(moscowTime)}`;
        
        // Последние добавленные слова
        const recentAddedWords = activeWords
            .sort((a, b) => new Date(b.createdDate) - new Date(a.createdDate))
            .slice(0, 3);
        
        if (recentAddedWords.length > 0) {
            message += `\n\n📥 **Последние добавленные слова:**\n`;
            recentAddedWords.forEach(word => {
                const timeAdded = formatMoscowDate(word.createdDate);
                // ✅ Правильный статус: новое слово или изученное
                const isNew = word.interval === 1 && (!word.firstLearnedDate || word.firstLearnedDate.trim() === '');
                const status = isNew ? '🆕' : '🎓';
                message += `• ${status} ${word.english} (${timeAdded})\n`;
            });
        }

        // Прогресс
        const progressPercentage = totalWordsCount > 0 ? Math.round((learnedWordsCount / totalWordsCount) * 100) : 0;
        
        message += `\n📈 **Общий прогресс:** ${progressPercentage}% изучено`;
        message += `\n   (${learnedWordsCount} из ${totalWordsCount} слов)`;
        
        await bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            ...getMainMenu()
        });
        
    } catch (error) {
        optimizedLog('❌ Error showing stats:', error);
        await bot.sendMessage(chatId, '❌ Ошибка при загрузке статистики.');
    }
}

// ✅ ФУНКЦИЯ: Форматирование даты с обратным отсчетом
function formatTimeWithCountdown(date) {
    const now = new Date();
    const targetDate = new Date(date);
    
    // ✅ Используем московское время для сравнения
    const moscowOffset = 3 * 60 * 60 * 1000;
    const moscowNow = new Date(now.getTime() + moscowOffset);
    const moscowTarget = new Date(targetDate.getTime() + moscowOffset);
    
    const diffTime = moscowTarget - moscowNow;
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor((diffTime % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const diffMinutes = Math.floor((diffTime % (1000 * 60 * 60)) / (1000 * 60));
    
    const day = moscowTarget.getDate().toString().padStart(2, '0');
    const month = (moscowTarget.getMonth() + 1).toString().padStart(2, '0');
    const hours = moscowTarget.getHours().toString().padStart(2, '0');
    const minutes = moscowTarget.getMinutes().toString().padStart(2, '0');
    
    const daysOfWeek = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
    const dayOfWeek = daysOfWeek[moscowTarget.getDay()];
    
    let timeString = `${day}.${month} ${hours}:${minutes}`;
    
    if (diffDays === 0) {
        if (diffHours === 0) {
            timeString += ` (через ${diffMinutes} мин)`;
        } else {
            timeString += ` (через ${diffHours} ч ${diffMinutes} мин)`;
        }
    } else if (diffDays === 1) {
        timeString += ` (завтра, через ${diffDays} дн)`;
    } else if (diffDays <= 7) {
        timeString += ` (${dayOfWeek}, через ${diffDays} дн)`;
    } else {
        timeString += ` (${dayOfWeek})`;
    }
    
    return timeString;
}

// ✅ ФУНКЦИЯ: Детальное форматирование времени
function formatTimeDetailed(date) {
    const moscowDate = toMoscowTime(date);
    
    const day = moscowDate.getDate().toString().padStart(2, '0');
    const month = (moscowDate.getMonth() + 1).toString().padStart(2, '0');
    const year = moscowDate.getFullYear();
    const hours = moscowDate.getHours().toString().padStart(2, '0');
    const minutes = moscowDate.getMinutes().toString().padStart(2, '0');
    const seconds = moscowDate.getSeconds().toString().padStart(2, '0');
    
    const daysOfWeek = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
    const dayOfWeek = daysOfWeek[moscowDate.getDay()];
    
    return `${day}.${month}.${year} ${hours}:${minutes}:${seconds} (${dayOfWeek})`;
}

// ✅ КОМАНДА: Сброс прогресса
bot.onText(/\/reset_progress/, async (msg) => {
    const chatId = msg.chat.id;
    
    if (!servicesInitialized || !sheetsService.initialized) {
        await bot.sendMessage(chatId, '❌ Google Sheets не инициализирован.');
        return;
    }

    try {
        dailyLearnedWords.delete(chatId);
        learnedWords.delete(chatId);
        userStates.delete(chatId);
        
        const success = await sheetsService.resetUserProgress(chatId);
        
        if (success) {
            optimizedLog(`🔄 Полный сброс прогресса для пользователя ${chatId}`);
            
            await bot.sendMessage(chatId, 
                '✅ **Весь прогресс полностью сброшен!**\n\n' +
                '• Все интервалы сброшены\n' +
                '• Дневной лимит очищен\n' + 
                '• История изучения удалена\n' +
                '• Все слова теперь "новые"\n\n' +
                '💡 Теперь вы можете начать изучение заново!',
                { parse_mode: 'Markdown' }
            );
        } else {
            await bot.sendMessage(chatId, '❌ Не удалось сбросить прогресс в базе данных.');
        }
        
    } catch (error) {
        optimizedLog('❌ Error resetting progress:', error);
        await bot.sendMessage(chatId, 
            '❌ Ошибка при сбросе прогресса.\n' +
            'Попробуйте еще раз.'
        );
    }
});

// ✅ КОМАНДА: Диагностика статуса слов
bot.onText(/\/debug_stats/, async (msg) => {
    const chatId = msg.chat.id;
    await initializeServices();
    
    try {
        const userWords = await getCachedUserWords(chatId);
        const activeWords = userWords.filter(word => word.status === 'active');
        const now = new Date();
        
        let message = '🔍 **Диагностика статуса слов:**\n\n';
        
        const reviewWords = activeWords.filter(word => {
            if (!word.nextReview) return false;
            try {
                const nextReview = new Date(word.nextReview);
                return nextReview <= now;
            } catch (e) {
                return false;
            }
        });
        
        const futureWords = activeWords.filter(word => {
            if (!word.nextReview) return false;
            try {
                const nextReview = new Date(word.nextReview);
                return nextReview > now;
            } catch (e) {
                return false;
            }
        });
        
        const newWords = activeWords.filter(word => word.interval === 1);
        
        message += `📊 Всего активных слов: ${activeWords.length}\n`;
        message += `🔄 Готово к повторению: ${reviewWords.length}\n`;
        message += `⏰ Ожидают повторения: ${futureWords.length}\n`;
        message += `🆕 Новые слова: ${newWords.length}\n\n`;
        
        if (futureWords.length > 0) {
            message += `📅 **Ближайшие повторения:**\n`;
            const sorted = futureWords
                .map(word => ({ 
                    word: word.english, 
                    date: new Date(word.nextReview),
                    interval: word.interval 
                }))
                .sort((a, b) => a.date - b.date)
                .slice(0, 3);
                
            sorted.forEach(item => {
                message += `• ${item.word} (инт. ${item.interval}д): ${formatConcreteDate(item.date)}\n`;
            });
        }
        
        await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        
    } catch (error) {
        optimizedLog('❌ Debug stats error:', error);
        await bot.sendMessage(chatId, '❌ Ошибка диагностики.');
    }
});

// ✅ ФУНКЦИЯ: Форматирование конкретной даты
function formatConcreteDate(date) {
    const now = new Date();
    const targetDate = new Date(date);
    
    const moscowNow = toMoscowTime(now);
    const moscowTarget = toMoscowTime(targetDate);
    
    const diffTime = moscowTarget - moscowNow;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const diffHours = Math.ceil(diffTime / (1000 * 60 * 60));
    
    const day = moscowTarget.getDate().toString().padStart(2, '0');
    const month = (moscowTarget.getMonth() + 1).toString().padStart(2, '0');
    const year = moscowTarget.getFullYear();
    
    const hours = moscowTarget.getHours().toString().padStart(2, '0');
    const minutes = moscowTarget.getMinutes().toString().padStart(2, '0');
    
    const daysOfWeek = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
    const dayOfWeek = daysOfWeek[moscowTarget.getDay()];
    
    if (diffDays === 0) {
        if (diffHours <= 1) {
            return `${hours}:${minutes} (через ${diffHours} час)`;
        } else if (diffHours <= 24) {
            return `${hours}:${minutes} (через ${diffHours} часов)`;
        } else {
            return `${day}.${month}.${year} ${hours}:${minutes}`;
        }
    } else if (diffDays === 1) {
        return `завтра ${hours}:${minutes}`;
    } else if (diffDays === 2) {
        return `${day}.${month}.${year} ${hours}:${minutes}`;
    } else if (diffDays <= 7) {
        return `${day}.${month}.${year} ${hours}:${minutes} (${dayOfWeek}, через ${diffDays} дн.)`;
    } else {
        return `${day}.${month}.${year} ${hours}:${minutes} (${dayOfWeek})`;
    }
}

// Основные команды бота
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    await initializeServices();
    await showMainMenu(chatId, 
        '📚 Англо-русский словарь\n' +
        '🔤 С транскрипцией и произношением\n' +
        '🇬🇧 Британский вариант\n' +
        '📝 Каждое слово хранится с несколькими значениями\n' +
        '🔄 **Умное интервальное повторение (FSRS)**\n' +
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
    else if (userState?.state === 'waiting_custom_translation') {
        const customTranslation = text.trim();
        if (!customTranslation) {
            await showMainMenu(chatId, '❌ Перевод не может быть пустым. Введите перевод:');
            return;
        }

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
            await processCustomTranslationWithoutExample(chatId, userState);
            return;
        }

        const example = text.trim();
        await processCustomTranslationWithExample(chatId, userState, example);
    }
     else if (userState?.state === 'spelling_training') {
        if (text === '🔙 Назад к карточке') {
            await returnToCard(chatId, userState);
        } else {
            await checkSpellingAnswer(chatId, text);
        }
    }
    else {
        await showMainMenu(chatId, 'Выберите действие из меню:');
    }
});

// Обработка callback_query
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;
    
    await initializeServices();
    updateUserActivity(chatId);

    const userState = userStates.get(chatId);
    await bot.answerCallbackQuery(callbackQuery.id);

    optimizedLog('🔍 Callback data:', data);
    optimizedLog('🔍 User state:', userState?.state);

    if (data.startsWith('details_')) {
        const translationIndex = parseInt(data.replace('details_', ''));
        if (userState?.state === 'choosing_translation' && userState.tempTranslations[translationIndex]) {
            await showTranslationDetails(chatId, translationIndex, userState);
        }
    }
    else if (data === 'back_to_translations') {
        if (userState?.state === 'choosing_translation') {
            await backToTranslationSelection(chatId, userState, callbackQuery);
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
                optimizedLog('❌ Error toggling translation:', error);
                await bot.sendMessage(chatId, '❌ Ошибка при выборе перевода');
            }
        }
    }
    else if (data === 'save_selected_translations') {
        if (userState?.state === 'choosing_translation' && userState.selectedTranslationIndices.length > 0) {
            try {
                const selectedTranslations = userState.selectedTranslationIndices
                    .map(index => userState.tempTranslations[index]);

                optimizedLog(`💾 Сохраняем выбранные переводы:`, selectedTranslations);
                
                await saveWordWithMeanings(chatId, userState, selectedTranslations);
                
                try {
                    await bot.deleteMessage(chatId, callbackQuery.message.message_id);
                } catch (deleteError) {
                    optimizedLog('⚠️ Не удалось удалить сообщение с выбором переводов');
                }
            } catch (error) {
                optimizedLog('❌ Error saving translations:', error);
                await bot.sendMessage(chatId, '❌ Ошибка при сохранении слова');
            }
        } else {
            await bot.sendMessage(chatId, '❌ Выберите хотя бы один перевод для сохранения');
        }
    }
    else if (data === 'custom_translation') {
        if (userState?.state === 'choosing_translation') {
            try {
                userStates.set(chatId, {
                    ...userState,
                    state: 'waiting_custom_translation'
                });

                let translationMessage = '✏️ **Добавьте свой перевод**\n\n' +
                    `🇬🇧 Слово: **${userState.tempWord}**`;
                if (userState.tempTranscription) {
                    translationMessage += `\n🔤 Транскрипция: ${userState.tempTranscription}`;
                }
                translationMessage += '\n\n📝 Введите ваш вариант перевода:';

                await bot.deleteMessage(chatId, callbackQuery.message.message_id);
                await showMainMenu(chatId, translationMessage);
            } catch (error) {
                optimizedLog('❌ Error in custom_translation:', error);
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
                optimizedLog('❌ Error canceling translation:', error);
                await bot.sendMessage(chatId, '❌ Ошибка при отмене');
            }
        }
    }
    else if (data === 'show_answer') {
        await showReviewAnswer(chatId);
    }
    else if (data.startsWith('review_')) {
        const rating = data.replace('review_', '');
        await processReviewRating(chatId, rating);
    }
    else if (data === 'skip_review') {
        const userState = userStates.get(chatId);
        if (userState?.state === 'review_session') {
            const skippedWord = userState.reviewWords.splice(userState.currentReviewIndex, 1)[0];
            userState.reviewWords.push(skippedWord);
            
            optimizedLog(`⏭️ Слово "${skippedWord.english}" пропущено и перемещено в конец`);
            
            userState.lastActivity = Date.now();
            
            await showNextReviewWord(chatId);
        }
    }
    else if (data === 'end_review') {
        if (userState?.state === 'review_session') {
            await completeReviewSession(chatId, userState);
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
    else if (data === 'start_review_from_notification') {
        await bot.deleteMessage(chatId, callbackQuery.message.message_id);
        await startReviewSession(chatId);
    }
    else if (data === 'start_learning_from_notification') {
        await bot.deleteMessage(chatId, callbackQuery.message.message_id);
        await startNewWordsSession(chatId);
    }
    else if (data.startsWith('audio_')) {
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
                optimizedLog('Error sending audio:', error);
                await bot.sendMessage(chatId, '❌ Ошибка при воспроизведении аудио.');
            }
        } else {
            await bot.sendMessage(chatId, '❌ Аудио произношение недоступно для этого слова.');
        }
    }
    else if (data === 'enter_translation') {
        optimizedLog('🔍 Processing enter_translation callback');
        
        if (userState?.state === 'showing_transcription') {
            try {
                try {
                    await bot.editMessageReplyMarkup(
                        { inline_keyboard: [] },
                        { 
                            chat_id: chatId, 
                            message_id: callbackQuery.message.message_id 
                        }
                    );
                } catch (editError) {
                    optimizedLog('⚠️ Could not edit message markup, continuing...');
                }

                const hasTranslations = userState.tempTranslations && 
                                      userState.tempTranslations.length > 0;
                
                optimizedLog(`🔍 Translations available: ${hasTranslations}, count: ${userState.tempTranslations?.length}`);

                if (hasTranslations) {
                    userStates.set(chatId, {
                        ...userState,
                        state: 'choosing_translation',
                        selectedTranslationIndices: []
                    });

                    let translationMessage = '🎯 **Выберите переводы:**\n\n' +
                        `🇬🇧 **${userState.tempWord}**`;
                        
                    if (userState.tempTranscription) {
                        translationMessage += `\n🔤 Транскрипция: ${userState.tempTranscription}`;
                    }
                    
                    translationMessage += '\n\n💡 Нажмите на номер перевода чтобы выбрать его';

                    await bot.sendMessage(
                        chatId, 
                        translationMessage,
                        {
                            parse_mode: 'Markdown',
                            ...getTranslationSelectionKeyboard(
                                userState.tempTranslations, 
                                userState.meanings, 
                                []
                            )
                        }
                    );
                    
                } else {
                    userStates.set(chatId, {
                        ...userState,
                        state: 'waiting_custom_translation'
                    });

                    let translationMessage = '✏️ **Добавьте свой перевод**\n\n' +
                        `🇬🇧 Слово: **${userState.tempWord}**`;
                        
                    if (userState.tempTranscription) {
                        translationMessage += `\n🔤 Транскрипция: ${userState.tempTranscription}`;
                    }
                    
                    translationMessage += '\n\n📝 Введите ваш вариант перевода:';

                    await bot.sendMessage(chatId, translationMessage, { parse_mode: 'Markdown' });
                }
                
            } catch (error) {
                optimizedLog('❌ Error in enter_translation:', error);
                await bot.sendMessage(chatId, 
                    '❌ Ошибка при обработке запроса. Попробуйте еще раз.'
                );
            }
        } else {
            optimizedLog(`❌ Wrong state for enter_translation: ${userState?.state}`);
            await bot.sendMessage(chatId, 
                '❌ Неверное состояние. Начните добавление слова заново.'
            );
            userStates.delete(chatId);
        }
    }
    else if (data === 'spelling_train') {
        const userState = userStates.get(chatId);
        
        if (userState?.state === 'review_session') {
            await startSpellingTraining(chatId, 'review');
        } 
        else if (userState?.state === 'learning_new_words') {
            await startSpellingTraining(chatId, 'learning');
        }
        
        try {
            await bot.deleteMessage(chatId, callbackQuery.message.message_id);
        } catch (e) {
            optimizedLog('⚠️ Cannot delete message');
        }
    }
    else {
        optimizedLog(`❌ Unknown callback data: ${data}`);
        await bot.sendMessage(chatId, '❌ Неизвестная команда. Попробуйте еще раз.');
    }
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

optimizedLog('🤖 Бот запущен: Обновленная версия с FSRS и улучшенной интеграцией Google Sheets!');










