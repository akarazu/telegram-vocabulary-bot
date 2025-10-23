import TelegramBot from 'node-telegram-bot-api';
import { GoogleSheetsService } from './services/google-sheets.js';
import { YandexDictionaryService } from './services/yandex-dictionary-service.js';
import { CambridgeDictionaryService } from './services/cambridge-dictionary-service.js';
import { FSRSService } from './services/fsrs-service.js';

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// Оптимизированные хранилища для экономии памяти
const userStates = new Map();
const cache = new Map();
const dailyLearnedWords = new Map();
const learnedWords = new Map();
const audioCache = new Map(); // Новый кэш для аудио
const REVERSE_TRAINING_STATES = {
    ACTIVE: 'reverse_training',
    SPELLING: 'reverse_training_spelling'
};

// Ленивая инициализация сервисов
let sheetsService, yandexService, cambridgeService, fsrsService;
let servicesInitialized = false;

async function initializeServices() {
    if (servicesInitialized) return true;
    
    try {
        sheetsService = new GoogleSheetsService();
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
        return true;
    } catch (error) {
        console.error('Service initialization failed');
        // Заглушки для работы бота
        sheetsService = { 
            initialized: false,
            getUserWords: () => [],
            getWordsForReview: () => [],
            getReviewWordsCount: () => 0,
            getNewWordsCount: () => 0,
            addWordWithMeanings: async () => false,
            updateWordAfterFSRSReview: async () => false,
            addMeaningToWord: async () => false
        };
        yandexService = { 
            getTranscriptionAndAudio: async () => ({ transcription: '', audioUrl: '' })
        };
        cambridgeService = { 
            getWordData: async () => ({ meanings: [] })
        };
        fsrsService = new FSRSService();
        servicesInitialized = true;
        return false;
    }
}

// Очистка неактивных пользователей каждые 10 минут
setInterval(() => {
    const now = Date.now();
    for (const [chatId, state] of userStates.entries()) {
        if (now - (state.lastActivity || 0) > 30 * 60 * 1000) {
            userStates.delete(chatId);
        }
    }
}, 10 * 60 * 1000);

// Функции для работы с кешем
function updateUserActivity(chatId) {
    const state = userStates.get(chatId);
    if (state) {
        state.lastActivity = Date.now();
    }
}

async function getCachedUserWords(chatId) {
    const cacheKey = `words_${chatId}`;
    const cached = cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
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

// Функции для работы с изученными словами
function markWordAsLearned(chatId, englishWord) {
    if (!learnedWords.has(chatId)) {
        learnedWords.set(chatId, new Set());
    }
    learnedWords.get(chatId).add(englishWord.toLowerCase());
}

function isWordLearned(chatId, englishWord) {
    if (!learnedWords.has(chatId)) return false;
    return learnedWords.get(chatId).has(englishWord.toLowerCase());
}

// Функции для работы с дневным лимитом
function resetDailyLimit() {
    const now = new Date();
    if (now.getHours() === 4) {
        dailyLearnedWords.clear();
    }
}

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
            
            // ✅ ТОЛЬКО слова, которые были изучены ВПЕРВЫЕ сегодня
            if (word.firstLearnedDate && word.firstLearnedDate.trim() !== '') {
                try {
                    const learnedDate = new Date(word.firstLearnedDate);
                    const moscowLearned = new Date(learnedDate.getTime() + moscowOffset);
                    
                    if (moscowLearned >= todayStart && moscowLearned <= todayEnd) {
                        learnedToday++;
                    }
                } catch (error) {
                    // Пропускаем слова с ошибками даты
                }
            }
        });

        return learnedToday;
        
    } catch (error) {
        return 0;
    }
}
// Клавиатуры
function getMainMenu() {
    return {
        reply_markup: {
            keyboard: [
                ['➕ Добавить слово', '📚 Повторить'],
                ['🆕 Новые слова', '📊 Статистика'],
                ['🔁 Рус→Англ Тренировка']
            ],
            resize_keyboard: true
        }
    };
}

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

function getNewWordsKeyboard() {
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: '✅ Выучил', callback_data: 'learned_word' }],
                [{ text: '🔄 Нужно повторить', callback_data: 'need_repeat_word' }],
                [{ text: '✍️ Правописание', callback_data: 'spelling_train' }]
            ]
        }
    };
}

function getTranslationSelectionKeyboard(translations, meanings, selectedIndices = []) {
    if (!translations || translations.length === 0) {
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
        
        const meaningForTranslation = meanings?.find(m => 
            m.translation && m.translation.trim() === translation.trim()
        );
        
        const hasDetails = meaningForTranslation && (
            (meaningForTranslation.englishDefinition && meaningForTranslation.englishDefinition.trim() !== '') ||
            (meaningForTranslation.examples && meaningForTranslation.examples.length > 0) ||
            (meaningForTranslation.partOfSpeech && meaningForTranslation.partOfSpeech.trim() !== '')
        );
        
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

function getNumberEmoji(number) {
    const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
    return number <= emojis.length ? emojis[number - 1] : `${number}.`;
}

// Вспомогательные функции
function toMoscowTime(date) {
    if (!date) return date;
    try {
        const moscowOffset = 3 * 60 * 60 * 1000;
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

// Основные функции бота
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
        await bot.sendMessage(chatId, text || 'Выберите действие из меню:');
    }
}

// Функции для работы со словами
async function saveWordWithMeanings(chatId, userState, selectedTranslations) {
    let success = true;
    
    if (!servicesInitialized || !sheetsService.initialized) {
        await showMainMenu(chatId, '❌ Сервис временно недоступен. Попробуйте позже.');
        userStates.delete(chatId);
        return;
    }

    try {
        // Проверка дубликатов
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

        // Подготовка данных для сохранения
        const meaningsData = [];
        selectedTranslations.forEach(translation => {
            const cambridgeMeanings = (userState.meanings || []).filter(
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

        // Создаем FSRS карточку для нового слова
        const fsrsCard = fsrsService.createNewCard();
        
        success = await sheetsService.addWordWithMeanings(
            chatId,
            userState.tempWord,
            userState.tempTranscription || '',
            userState.tempAudioUrl || '',
            meaningsData
        );

    } catch (error) {
        console.error('Error saving word:', error);
        success = false;
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

// Функции для ручного добавления перевода
async function processCustomTranslation(chatId, userState, translation, example = '') {
    if (!translation || translation.trim() === '') {
        await bot.sendMessage(chatId, '❌ Перевод не может быть пустым. Введите перевод:');
        return;
    }

    const newTranslations = [translation, ...(userState.tempTranslations || [])];
    const newMeaning = {
        translation: translation,
        englishDefinition: '',
        examples: example ? [{ english: example, russian: '' }] : [],
        partOfSpeech: ''
    };
    const newMeanings = [newMeaning, ...(userState.meanings || [])];
    
    // Сохраняем контекст добавления слова
    userStates.set(chatId, {
        ...userState,
        state: 'choosing_translation',
        tempTranslations: newTranslations,
        meanings: newMeanings,
        selectedTranslationIndices: [0], // автоматически выбираем пользовательский перевод
        lastActivity: Date.now()
    });

    let message = `✅ Ваш перевод "${translation}" добавлен!\n\n`;
    if (example) message += `📝 Пример: ${example}\n\n`;
    message += '🎯 Теперь выберите переводы для сохранения:';
    
    await bot.sendMessage(chatId, message, 
        getTranslationSelectionKeyboard(newTranslations, newMeanings, [0])
    );
}

// Функции тренажера правописания
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

async function askTrainingSpellingQuestion(chatId, word) {
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
        
        setTimeout(() => returnToCard(chatId, userState), 2000);
    } else {
        await bot.sendMessage(chatId, 
            `❌ Неправильно. Попробуйте еще раз!\n` +
            `💡 Подсказка: начинается на "${word.english[0]}"`
        );
        
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

async function returnToCard(chatId, userState) {
    const originalState = userState.originalState;
    const context = userState.originalContext;
    
    userStates.set(chatId, originalState);
    
    if (context === 'review') {
        await showReviewAnswer(chatId);
    } else if (context === 'learning') {
        await showNextNewWord(chatId);
    }
}

// Функции повторения слов
async function startReviewSession(chatId) {
    await initializeServices();
    
    const existingState = userStates.get(chatId);
    if (existingState) {
        userStates.delete(chatId);
        const cacheKey = `words_${chatId}`;
        cache.delete(cacheKey);
    }
    
    if (!sheetsService.initialized) {
        await bot.sendMessage(chatId, '❌ Сервис временно недоступен.');
        return;
    }

    try {
        const wordsToReview = await sheetsService.getWordsForReview(chatId);
        
        if (wordsToReview.length === 0) {
            const userWords = await getCachedUserWords(chatId);
            const activeWords = userWords.filter(word => word.status === 'active');
            const learnedWords = activeWords.filter(word => 
                word.interval > 1 || 
                (word.firstLearnedDate && word.firstLearnedDate.trim() !== '')
            );
            const newWords = activeWords.filter(word => 
                word.interval === 1 && 
                (!word.firstLearnedDate || word.firstLearnedDate.trim() === '')
            );
            
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

        userStates.set(chatId, {
            state: 'review_session',
            reviewWords: wordsToReview,
            originalWordsCount: wordsToReview.length,
            currentReviewIndex: 0,
            reviewedCount: 0,
            lastActivity: Date.now()
        });

        await showNextReviewWord(chatId);
        
    } catch (error) {
        await bot.sendMessage(chatId, '❌ Ошибка при загрузке слов для повторения.');
    }
}

async function showNextReviewWord(chatId) {
    const userState = userStates.get(chatId);
    if (!userState || userState.state !== 'review_session') {
        await bot.sendMessage(chatId, '❌ Сессия повторения не найдена. Начните заново.');
        return;
    }

    const { reviewWords } = userState;
    
    if (!reviewWords || reviewWords.length === 0) {
        await completeReviewSession(chatId, userState);
        return;
    }
    
    if (userState.currentReviewIndex >= reviewWords.length) {
        userState.currentReviewIndex = 0;
    }

    const word = reviewWords[userState.currentReviewIndex];
    
    if (!word) {
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
                [{ text: '❌ Завершить повторение', callback_data: 'end_review' }]
            ]
        }
    });
}

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

    // Используем кэшированное аудио
    if (word.english) {
        try {
            const audioUrl = await getCachedAudio(word.english);
            if (audioUrl) {
                await bot.sendAudio(chatId, audioUrl, {
                    caption: '🔊 Произношение'
                });
            }
        } catch (error) {
            // Пропускаем ошибки аудио
        }
    }

    await bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        ...getReviewKeyboard()
    });
}

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


         const fsrsResult = await fsrsService.reviewCard(chatId, word, cardData, rating);
        
 if (fsrsResult) {
            // ВАЖНО: Адаптируем параметры FSRS на основе успехов пользователя
            const userWords = await getCachedUserWords(chatId);
            const successRate = fsrsService.calculateUserSuccessRate(userWords);
            fsrsService.adaptUserParameters(chatId, successRate);

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
        userState.reviewWords.splice(userState.currentReviewIndex, 1);
        
        if (userState.reviewWords.length === 0) {
            await completeReviewSession(chatId, userState);
        } else {
            userState.lastActivity = Date.now();
            await showNextReviewWord(chatId);
        }
    }
}

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
    
    const hasMoreWords = await sheetsService.getReviewWordsCount(chatId) > 0;
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

// Функции изучения новых слов
async function startNewWordsSession(chatId) {
    await initializeServices();
    
    const existingState = userStates.get(chatId);
    if (existingState && existingState.state === 'learning_new_words') {
        await completeNewWordsSession(chatId, existingState);
    }
    
    if (!sheetsService.initialized) {
        await bot.sendMessage(chatId, '❌ Сервис временно недоступен.');
        return;
    }

    try {
        const learnedToday = await getLearnedToday(chatId);
        const DAILY_LIMIT = 5;
        
        if (learnedToday >= DAILY_LIMIT) {
            await bot.sendMessage(chatId, 
                `🎉 Вы достигли дневного лимита!\n\n` +
                `📊 Изучено слов сегодня: ${learnedToday}/${DAILY_LIMIT}\n\n` +
                '💡 Возвращайтесь завтра для изучения новых слов!\n' +
                '📚 Можете повторить уже изученные слова'
            );
            return;
        }

        const availableNewWords = await getAllUnlearnedWords(chatId);
        
        if (availableNewWords.length === 0) {
            await bot.sendMessage(chatId, 
                `🎉 На сегодня новых слов для изучения нет!\n\n` +
                `📊 Изучено слов сегодня: ${learnedToday}/${DAILY_LIMIT}\n\n` +
                '💡 Вы можете:\n' +
                '• Добавить новые слова через меню "➕ Добавить слово"\n' +
                '• Повторить уже изученные слова'
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
        preloadAudioForWords(availableNewWords);

        await showNextNewWord(chatId);
        
    } catch (error) {
        await bot.sendMessage(chatId, '❌ Ошибка при загрузке новых слов.');
    }
}

async function getAllUnlearnedWords(chatId) {
    if (!servicesInitialized || !sheetsService.initialized) {
        return [];
    }
    
    try {
        const userWords = await getCachedUserWords(chatId);
        
        // ✅ ПРАВИЛЬНАЯ ФИЛЬТРАЦИЯ: только слова которые НИКОГДА не изучались
        const unlearnedWords = userWords.filter(word => {
            if (word.status !== 'active') {
                return false;
            }
            
            // Новое слово = interval=1 И firstLearnedDate пустой
            const isNewWord = word.interval === 1 && 
                            (!word.firstLearnedDate || word.firstLearnedDate.trim() === '');
            
            return isNewWord;
        });

        // Сортируем по дате создания (новые первыми)
        unlearnedWords.sort((a, b) => new Date(b.createdDate) - new Date(a.createdDate));

        return unlearnedWords;
        
    } catch (error) {
        return [];
    }
}

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

    // Используем кэшированное аудио
    if (word.english) {
        try {
            const audioUrl = await getCachedAudio(word.english);
            if (audioUrl) {
                await bot.sendAudio(chatId, audioUrl, {
                    caption: '🔊 Произношение'
                });
            }
        } catch (error) {
            // Пропускаем ошибки аудио
        }
    }

    await bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        ...getNewWordsKeyboard()
    });
}

async function processNewWordLearning(chatId, action) {
    const userState = userStates.get(chatId);
    if (!userState || userState.state !== 'learning_new_words') return;

    const word = userState.newWords[userState.currentWordIndex];
    
    try {
        if (action === 'learned') {
            const cardData = fsrsService.createNewCard();
            const fsrsResult = await fsrsService.reviewCard(chatId, word.english, cardData, 'good');
            
            if (fsrsResult) {
                // ✅ ВАЖНО: Для новых слов устанавливаем firstLearnedDate
                if (word.interval === 1 && (!word.firstLearnedDate || word.firstLearnedDate.trim() === '')) {
                    fsrsResult.firstLearnedDate = new Date().toISOString();
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
                
                userState.newWords.splice(userState.currentWordIndex, 1);
                
                const currentLearnedToday = await getLearnedToday(chatId);
                
                if (userState.newWords.length === 0) {
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
            userState.currentWordIndex++;
            userState.lastActivity = Date.now();
        }
        
        if (userState.newWords.length === 0) {
            await completeNewWordsSession(chatId, userState);
            return;
        }
        
        if (userState.currentWordIndex >= userState.newWords.length) {
            userState.currentWordIndex = 0;
        }
        
        await showNextNewWord(chatId);

    } catch (error) {
        await bot.sendMessage(chatId, 
            '❌ Ошибка при сохранении прогресса.\n' +
            'Попробуйте еще раз.'
        );
    }
}

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

// Функции статистики
async function showUserStats(chatId) {
    await initializeServices();
    
    if (!sheetsService.initialized) {
        await bot.sendMessage(chatId, '❌ Сервис временно недоступен.');
        return;
    }

    try {
        const userWords = await getCachedUserWords(chatId);
        const activeWords = userWords.filter(word => word.status === 'active');
        
        const newWords = activeWords.filter(word => 
            word.interval === 1 && 
            (!word.firstLearnedDate || word.firstLearnedDate.trim() === '')
        );
        const newWordsCount = newWords.length;
        
        const reviewWords = await sheetsService.getWordsForReview(chatId);
        const reviewWordsCount = reviewWords.length;
        
        const totalWordsCount = activeWords.length;
        const learnedToday = await getLearnedToday(chatId);
        const DAILY_LIMIT = 5;
        const remainingToday = Math.max(0, DAILY_LIMIT - learnedToday);
        
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
        
        if (remainingToday > 0) {
            message += `🎯 Осталось изучить сегодня: ${remainingToday} слов\n`;
        } else {
            message += `✅ Дневной лимит достигнут!\n`;
        }

        // ВОССТАНОВЛЕНА СЕКЦИЯ: Ближайшие повторения с обратным отсчетом
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
        await bot.sendMessage(chatId, '❌ Ошибка при загрузке статистики.');
    }
}

// ФУНКЦИЯ: Форматирование даты с обратным отсчетом (ВОССТАНОВЛЕНА)
function formatTimeWithCountdown(date) {
    const now = new Date();
    const targetDate = new Date(date);
    
    // Используем московское время для сравнения
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

// ФУНКЦИЯ: Детальное форматирование времени (ВОССТАНОВЛЕНА)
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

// Обработчики команд
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    await initializeServices();
    await bot.sendMessage(chatId, 
        '📚 Англо-русский словарь\n' +
        '🔤 С транскрипцией и произношением\n' +
        '🇬🇧 Британский вариант\n' +
        '📝 Каждое слово хранится с несколькими значениями\n' +
        '🔄 **Умное интервальное повторение (FSRS)**\n\n' +
        '💡 **Как учить слова:**\n' +
        '1. ➕ Добавить новое слово\n' +
        '2. 🆕 Изучить новые слова (5 в день)\n' +
        '3. 📚 Повторить изученные слова\n\n' +
        'Используйте меню для навигации:',
        getMainMenu()
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

bot.onText(/\/reset_progress/, async (msg) => {
    const chatId = msg.chat.id;
    
    if (!servicesInitialized || !sheetsService.initialized) {
        await bot.sendMessage(chatId, '❌ Сервис временно недоступен.');
        return;
    }

    try {
        dailyLearnedWords.delete(chatId);
        learnedWords.delete(chatId);
        userStates.delete(chatId);
        
        // Сбрасываем прогресс через установку интервала = 1
        const userWords = await getCachedUserWords(chatId);
        for (const word of userWords) {
            if (word.status === 'active') {
                const cardData = {
                    due: new Date(),
                    stability: 0.1,
                    difficulty: 5.0,
                    elapsed_days: 0,
                    scheduled_days: 1,
                    reps: 0,
                    lapses: 0,
                    state: 1,
                    last_review: new Date()
                };
                
                await sheetsService.updateWordAfterFSRSReview(
                    chatId,
                    word.english,
                    cardData,
                    'again'
                );
            }
        }
        
        await bot.sendMessage(chatId, 
            '✅ **Прогресс сброшен!**\n\n' +
            'Все слова теперь отмечены как новые.\n' +
            'Дневной лимит очищен.',
            { parse_mode: 'Markdown' }
        );
        
    } catch (error) {
        await bot.sendMessage(chatId, '❌ Ошибка при сбросе прогресса.');
    }
});

bot.onText(/\/clear_audio_cache/, async (msg) => {
    const chatId = msg.chat.id;
    
    const audioCacheSize = audioCache.size;
    audioCache.clear();
    
    await bot.sendMessage(chatId, 
        `✅ Кэш аудио очищен!\n\n` +
        `Удалено ${audioCacheSize} записей.`,
        getMainMenu()
    );
});

// Обработчики сообщений
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text || text.startsWith('/')) {
        return;
    }

    await initializeServices();
    updateUserActivity(chatId);

    const userState = userStates.get(chatId);

    if (text === '➕ Добавить слово') {
        userStates.set(chatId, { state: 'waiting_english', lastActivity: Date.now() });
        await bot.sendMessage(chatId, '🇬🇧 Введите английское слово:');
    }
    else if (text === '📚 Повторить') {
        await startReviewSession(chatId);
    }
    else if (text === '🆕 Новые слова') {
        await startNewWordsSession(chatId);
    }
    else if (text === '📊 Статистика') {
        await showUserStats(chatId);
    }
    else if (userState?.state === 'waiting_english') {
        await handleAddWord(chatId, text);
    }
    else if (userState?.state === 'spelling_training') {
        if (text === '🔙 Назад к карточке') {
            await returnToCard(chatId, userState);
        } else {
            await checkSpellingAnswer(chatId, text);
        }
    }
    else if (userState?.state === 'waiting_custom_translation') {
        if (text && text.trim() !== '') {
            await processCustomTranslation(chatId, userState, text.trim());
        } else {
            await bot.sendMessage(chatId, '❌ Перевод не может быть пустым. Введите перевод:');
        }
    }
        else if (userState?.state === 'waiting_custom_example') {
        if (text && text.trim() !== '') {
            await processCustomTranslation(chatId, userState, userState.customTranslation, text.trim());
        } else {
            // Если пример пустой, сохраняем без примера
            await processCustomTranslation(chatId, userState, userState.customTranslation);
        }
    }

    else if (userState?.state === 'waiting_custom_example') {
        await processCustomTranslation(chatId, userState, userState.customTranslation, text);
    }
    else if (text === '🔁 Рус→Англ Тренировка') {
    await startReverseTraining(chatId);
}
else if (userState?.state === REVERSE_TRAINING_STATES.ACTIVE) {
    if (text === '👀 Ответ') {
        const word = userState.words[userState.index];
        await showTrainingResult(chatId, userState, word, false);
        
        // После показа ответа тоже переходим к следующему слову
        setTimeout(async () => {
            userState.index++;
            userState.lastActivity = Date.now();

            if (userState.index >= userState.words.length) {
                await completeTraining(chatId, userState);
            } else {
                await showNextTrainingWord(chatId);
            }
        }, 2500);
    } else if (text === '❌ Завершить') {
        await completeTraining(chatId, userState);
    } else {
        await checkTrainingAnswer(chatId, text);
    }
}
else if (userState?.state === REVERSE_TRAINING_STATES.SPELLING) {
    if (text === '🔙 Назад') {
        returnToTraining(chatId, userState);
    } else {
        await ccheckTrainingSpellingAnswer(chatId, text);
    }
}
    else {
        await bot.sendMessage(chatId, 'Выберите действие из меню:', getMainMenu());
    }
});

// Обработка добавления слова
async function handleAddWord(chatId, englishWord) {
    const lowerWord = englishWord.trim().toLowerCase();

    if (!/^[a-zA-Z\s\-'\.]+$/.test(lowerWord)) {
        await bot.sendMessage(chatId, 
            '❌ Это не похоже на английское слово.\n' +
            'Пожалуйста, введите слово на английском:'
        );
        return;

        if (!englishWord || englishWord.trim() === '') {
    await bot.sendMessage(chatId, '❌ Слово не может быть пустым. Введите английское слово:');
    return;
}
    }

    await bot.sendMessage(chatId, '🔍 Ищу перевод, транскрипцию и произношение...');

    try {
        let transcription = '';
        let audioUrl = '';
        let meanings = [];
        let translations = [];

        // Получаем данные из Cambridge Dictionary
        const cambridgeData = await cambridgeService.getWordData(lowerWord);
        if (cambridgeData.meanings && cambridgeData.meanings.length > 0) {
            meanings = cambridgeData.meanings;
            translations = meanings.map(m => m.translation).filter((t, i, arr) => arr.indexOf(t) === i);
        }

        // Получаем транскрипцию и аудио с кэшированием
        try {
            const yandexData = await yandexService.getTranscriptionAndAudio(lowerWord);
            transcription = yandexData.transcription || '';
            // Используем кэшированное аудио
            audioUrl = await getCachedAudio(lowerWord);
        } catch (yandexError) {
            // Если Yandex не сработал, используем кэшированное аудио от Google TTS
            audioUrl = await getCachedAudio(lowerWord);
        }

        userStates.set(chatId, {
            state: 'showing_transcription',
            tempWord: lowerWord,
            tempTranscription: transcription,
            tempAudioUrl: audioUrl,
            tempAudioId: Date.now().toString(),
            tempTranslations: translations,
            meanings: meanings,
            selectedTranslationIndices: [],
            lastActivity: Date.now()
        });

        let message = `📝 Слово: ${lowerWord}`;
        if (transcription) {
            message += `\n🔤 Транскрипция: ${transcription}`;
        }
        if (audioUrl) {
            message += `\n\n🎵 Доступно аудио произношение`;
        }
        if (translations.length > 0) {
            message += `\n\n🎯 Найдено ${translations.length} вариантов перевода`;
        } else {
            message += `\n\n❌ Переводы не найдены\n✏️ Вы можете добавить свой перевод`;
        }
        message += `\n\nВыберите действие:`;

        await bot.sendMessage(chatId, message, {
            reply_markup: {
                inline_keyboard: [
                    audioUrl ? [{ text: '🔊 Прослушать произношение', callback_data: `audio_${audioUrl}` }] : [],
                    [{ text: '➡️ Выбрать перевод', callback_data: 'enter_translation' }]
                ].filter(row => row.length > 0)
            }
        });

    } catch (error) {
        await bot.sendMessage(chatId, 
            '❌ Ошибка при поиске слова\n\n' +
            'Попробуйте другое слово или повторите позже.'
        );
        userStates.delete(chatId);
    }
}

// Обработчики callback
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;
    
    await initializeServices();
    updateUserActivity(chatId);

    const userState = userStates.get(chatId);
    await bot.answerCallbackQuery(callbackQuery.id);

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
                await bot.sendMessage(chatId, '❌ Ошибка при выборе перевода');
            }
        }
    }
    else if (data === 'save_selected_translations') {
        if (userState?.state === 'choosing_translation' && userState.selectedTranslationIndices.length > 0) {
            try {
                const selectedTranslations = userState.selectedTranslationIndices
                    .map(index => userState.tempTranslations[index]);

                await saveWordWithMeanings(chatId, userState, selectedTranslations);
                
                try {
                    await bot.deleteMessage(chatId, callbackQuery.message.message_id);
                } catch (deleteError) {
                    // Игнорируем ошибки удаления
                }
            } catch (error) {
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
                await bot.sendMessage(chatId, translationMessage, { parse_mode: 'Markdown' });
            } catch (error) {
                await bot.sendMessage(chatId, '❌ Ошибка при обработке запроса');
            }
        }
    }
    else if (data === 'cancel_translation') {
        if (userState) {
            try {
                userStates.set(chatId, {
                    ...userState,
                    state: 'showing_transcription'
                });

                let message = `📝 Слово: ${userState.tempWord}`;
                if (userState.tempTranscription) {
                    message += `\n🔤 Транскрипция: ${userState.tempTranscription}`;
                }
                message += '\n\n🎵 Доступно аудио произношение\n\nВыберите действие:';

                await bot.editMessageReplyMarkup(
                    {
                        inline_keyboard: [
                            userState.tempAudioUrl ? [{ text: '🔊 Прослушать произношение', callback_data: `audio_${userState.tempAudioId}` }] : [],
                            [{ text: '➡️ Выбрать перевод', callback_data: 'enter_translation' }]
                        ].filter(row => row.length > 0)
                    },
                    { chat_id: chatId, message_id: callbackQuery.message.message_id }
                );
            } catch (error) {
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
            // Игнорируем ошибки удаления
        }
    }
else if (data.startsWith('audio_')) {
    const audioUrl = data.replace('audio_', '');
    const englishWord = userState?.tempWord;

    if (audioUrl && englishWord) {
        try {
            await bot.sendAudio(chatId, audioUrl, {
                caption: `🔊 Британское произношение: ${englishWord}`
            });
            await bot.sendMessage(chatId, '🎵 Вы прослушали произношение. Хотите выбрать перевод?', {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '✏️ Выбрать перевод', callback_data: 'enter_translation' }]
                    ]
                }
            });
        } catch (error) {
            // Если URL не работает, пробуем получить новый из кэша
            try {
                const newAudioUrl = await getCachedAudio(englishWord);
                if (newAudioUrl && newAudioUrl !== audioUrl) {
                    await bot.sendAudio(chatId, newAudioUrl, {
                        caption: `🔊 Британское произношение: ${englishWord}`
                    });
                    await bot.sendMessage(chatId, '🎵 Вы прослушали произношение. Хотите выбрать перевод?', {
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '✏️ Выбрать перевод', callback_data: 'enter_translation' }]
                            ]
                        }
                    });
                } else {
                    throw new Error('No audio available');
                }
            } catch (retryError) {
                await bot.sendMessage(chatId, '❌ Ошибка при воспроизведении аудио.');
            }
        }
    } else {
        await bot.sendMessage(chatId, '❌ Аудио произношение недоступно для этого слова.');
    }
}
    else if (data === 'enter_translation') {
        if (userState?.state === 'showing_transcription') {
            try {
                const hasTranslations = userState.tempTranslations && 
                                      userState.tempTranslations.length > 0;
                
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
                await bot.sendMessage(chatId, '❌ Ошибка при обработке запроса.');
            }
        }
    } else if (data.startsWith('training_')) {
    await handleTrainingCallback(chatId, data);
    
    try {
        await bot.deleteMessage(chatId, callbackQuery.message.message_id);
    } catch (e) {
        // Игнорируем ошибки удаления
    }
}
});

// Вспомогательные функции для работы с переводами
async function showTranslationDetails(chatId, translationIndex, userState) {
    try {
        const translation = userState.tempTranslations[translationIndex];
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
                    if (index < 3) {
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
        await bot.sendMessage(chatId, '❌ Ошибка при показе подробностей перевода');
    }
}

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
            // Игнорируем ошибки удаления
        }
    } catch (error) {
        await bot.sendMessage(chatId, '❌ Ошибка при возврате к выбору переводов');
    }
}

async function startReverseTraining(chatId) {
    if (!servicesInitialized || !sheetsService.initialized) {
        await bot.sendMessage(chatId, '❌ Сервис временно недоступен.');
        return;
    }

    try {
        // Берем ВСЕ слова пользователя, а не только готовые к повторению
        const userWords = await getCachedUserWords(chatId);
        
        // Фильтруем только активные слова, которые уже изучены
        const learnedWords = userWords.filter(word => 
            word.status === 'active' && 
            word.interval > 1 && // Исключаем новые слова (interval = 1)
            word.firstLearnedDate && 
            word.firstLearnedDate.trim() !== ''
        );

        if (learnedWords.length === 0) {
            await bot.sendMessage(chatId, 
                '📚 Нет изученных слов для тренировки.\n\n' +
                '💡 Сначала изучите слова в разделе "🆕 Новые слова"'
            );
            return;
        }

        // Быстрое перемешивание
        const shuffledWords = learnedWords
            .map(word => ({ word, sort: Math.random() }))
            .sort((a, b) => a.sort - b.sort)
            .map(({ word }) => word)
            .slice(0, 10); // Ограничиваем 10 словами для одной сессии

userStates.set(chatId, {
    state: REVERSE_TRAINING_STATES.ACTIVE,
    words: shuffledWords,
    total: shuffledWords.length,
    index: 0,
    correct: 0,
    startTime: Date.now(),
    lastActivity: Date.now()
});

        preloadAudioForWords(shuffledWords);
        await showNextTrainingWord(chatId);
        
    } catch (error) {
        console.error('Error in startReverseTraining:', error);
        await bot.sendMessage(chatId, '❌ Ошибка при загрузке слов.');
    }
}

async function showNextTrainingWord(chatId) {
    const state = userStates.get(chatId);
    if (!state || state.state !== REVERSE_TRAINING_STATES.ACTIVE) return;

    const { words, index, total } = state;
    
    if (index >= words.length) {
        await completeTraining(chatId, state);
        return;
    }

    const word = words[index];
    const meaning = getRandomMeaning(word);
    
    if (!meaning) {
        // Пропускаем слова без переводов
        state.index++;
        state.lastActivity = Date.now();
        await showNextTrainingWord(chatId);
        return;
    }

    const message = `🔁 Тренировка ${index + 1}/${total}\n\n🇷🇺 **${meaning.translation}**\n\n✏️ Введите английское слово:`;

    await bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: {
            keyboard: [['👀 Ответ', '❌ Завершить']],
            resize_keyboard: true
        }
    });
}

// Быстрая функция получения случайного перевода
function getRandomMeaning(word) {
    if (!word.meanings || !word.meanings.length) return null;
    return word.meanings[Math.floor(Math.random() * word.meanings.length)];
}

async function checkTrainingAnswer(chatId, userAnswer) {
    const state = userStates.get(chatId);
    if (!state || state.state !== REVERSE_TRAINING_STATES.ACTIVE) return;

    const word = state.words[state.index];
    const isCorrect = normalizeAnswer(word.english) === normalizeAnswer(userAnswer);
    
    if (isCorrect) state.correct++;

    await showTrainingResult(chatId, state, word, isCorrect, userAnswer);
    
    // Увеличиваем индекс и переходим к следующему слову после показа результата
    setTimeout(async () => {
        state.index++;
        state.lastActivity = Date.now();

        if (state.index >= state.words.length) {
            await completeTraining(chatId, state);
        } else {
            await showNextTrainingWord(chatId);
        }
    }, 2500); // 2.5 секунды на просмотр результата
}

// Быстрая нормализация ответа
function normalizeAnswer(answer) {
    return answer.trim().toLowerCase().replace(/[^a-z]/g, '');
}

// Компактный показ результата
async function showTrainingResult(chatId, state, word, isCorrect, userAnswer = '') {
    const translations = word.meanings?.map(m => m.translation).filter(Boolean) || [];
    
    let message = isCorrect ? '✅ **Правильно!**\n\n' : '❌ **Неправильно**\n\n';
    
    if (!isCorrect && userAnswer) {
        message += `Ваш ответ: "${userAnswer}"\n`;
    }
    
    message += `🇬🇧 **${word.english}**\n`;
    if (word.transcription) message += `🔤 ${word.transcription}\n`;
    if (translations.length) message += `📚 ${translations.join(', ')}`;

    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
}

async function handleTrainingCallback(chatId, data) {
    const state = userStates.get(chatId);
    if (!state || state.state !== REVERSE_TRAINING_STATES.ACTIVE) return;

    switch (data) {
        case 'training_next':
            state.index++;
            state.lastActivity = Date.now();
            if (state.index >= state.words.length) {
                await completeTraining(chatId, state);
            } else {
                await showNextTrainingWord(chatId);
            }
            break;
            
        case 'training_spelling':
            await startTrainingSpelling(chatId);
            break;
            
        case 'training_stats':
            await showTrainingStats(chatId, state);
            break;
    }
}

async function showTrainingStats(chatId, state) {
    const { index, total, correct, startTime } = state;
    const accuracy = index > 0 ? Math.round((correct / index) * 100) : 0;
    const timeSpent = Math.round((Date.now() - startTime) / 1000 / 60);
    
    const message = `📊 **Статистика:**\n\n` +
                   `Пройдено: ${index}/${total}\n` +
                   `Правильно: ${correct}\n` +
                   `Точность: ${accuracy}%\n` +
                   `Время: ${timeSpent} мин`;

    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
}

async function completeTraining(chatId, state) {
    const { index, total, correct, startTime } = state;
    const accuracy = index > 0 ? Math.round((correct / index) * 100) : 0;
    const timeSpent = Math.round((Date.now() - startTime) / 1000 / 60);
    
    let message = '🎉 **Тренировка завершена!**\n\n';
    message += `Пройдено: ${index}/${total}\n`;
    message += `Правильно: ${correct}\n`;
    message += `Точность: ${accuracy}%\n`;
    message += `Время: ${timeSpent} мин\n\n`;
    
    if (accuracy >= 80) message += `💪 Отлично!`;
    else if (accuracy >= 60) message += `👍 Хорошо!`;
    else message += `💡 Продолжайте тренироваться!`;

    userStates.delete(chatId);
    
    await bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        ...getMainMenu()
    });
}

async function startTrainingSpelling(chatId) {
    const state = userStates.get(chatId);
    if (!state || state.state !== REVERSE_TRAINING_STATES.ACTIVE) return;

    const word = state.words[state.index];
    const meaning = getRandomMeaning(word);
    
    if (!meaning) {
        await bot.sendMessage(chatId, '❌ Не удалось начать тренировку правописания.');
        return;
    }

    userStates.set(chatId, {
        ...state,
        state: REVERSE_TRAINING_STATES.SPELLING,
        spellingWord: word,
        spellingTranslation: meaning.translation,
        attempts: 0
    });

    await askTrainingSpellingQuestion(chatId, meaning.translation);
}

async function checkTrainingSpellingAnswer(chatId, userAnswer) {
    const state = userStates.get(chatId);
    if (!state || state.state !== REVERSE_TRAINING_STATES.SPELLING) return;

    const word = state.spellingWord;
    const isCorrect = normalizeAnswer(word.english) === normalizeAnswer(userAnswer);
    
    state.attempts++;

    if (isCorrect) {
        await bot.sendMessage(chatId, `✅ Правильно! ${word.english}`);
        setTimeout(() => returnToTraining(chatId, state), 1500);
    } else if (state.attempts >= 2) {
        await bot.sendMessage(chatId, `💡 Ответ: ${word.english}`);
        setTimeout(() => returnToTraining(chatId, state), 1500);
    } else {
        await bot.sendMessage(chatId, '❌ Попробуйте ещё раз');
    }
}

async function returnToTraining(chatId, state) {
    const originalState = { ...state };
    originalState.state = REVERSE_TRAINING_STATES.ACTIVE;
    delete originalState.spellingWord;
    delete originalState.spellingTranslation;
    delete originalState.attempts;
    
    userStates.set(chatId, originalState);
    
    // После возврата из правописания показываем результат текущего слова
    const word = originalState.words[originalState.index];
    await showTrainingResult(chatId, originalState, word, false);
    
    // И переходим к следующему слову через 2 секунды
    setTimeout(async () => {
        originalState.index++;
        originalState.lastActivity = Date.now();

        if (originalState.index >= originalState.words.length) {
            await completeTraining(chatId, originalState);
        } else {
            await showNextTrainingWord(chatId);
        }
    }, 2000);
}

// Функция для получения аудио с кэшированием
async function getCachedAudio(englishWord) {
    const cacheKey = `audio_${englishWord.toLowerCase()}`;
    
    // Проверяем кэш
    if (audioCache.has(cacheKey)) {
        const cached = audioCache.get(cacheKey);
        // Проверяем, не устарел ли кэш (1 день)
        if (Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) {
            return cached.audioUrl;
        }
    }
    
    // Если нет в кэше или устарел, получаем новое аудио
    try {
        let audioUrl = '';
        
        // Сначала пробуем Yandex
        try {
            const yandexData = await yandexService.getTranscriptionAndAudio(englishWord);
            audioUrl = yandexData.audioUrl || '';
        } catch (yandexError) {
            // Если Yandex не сработал, используем Google TTS
            audioUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(englishWord)}&tl=en-gb&client=tw-ob`;
        }
        
        // Сохраняем в кэш
        if (audioUrl) {
            audioCache.set(cacheKey, {
                audioUrl: audioUrl,
                timestamp: Date.now()
            });
        }
        
        return audioUrl;
    } catch (error) {
        console.error('Error getting audio:', error);
        return '';
    }
}

async function preloadAudioForWords(words) {
    const audioPromises = words.map(async (word) => {
        if (word.english) {
            try {
                await getCachedAudio(word.english);
            } catch (error) {
                console.error(`Error preloading audio for "${word.english}":`, error);
            }
        }
    });
    
    // Запускаем в фоне, не ждем завершения
    Promise.allSettled(audioPromises);
}

// Запуск периодических задач
setInterval(() => {
    resetDailyLimit();
}, 60 * 60 * 1000);

console.log('🤖 Бот запущен: оптимизированная версия с тренажером правописания');












