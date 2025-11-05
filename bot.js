import TelegramBot from 'node-telegram-bot-api';
import { GoogleSheetsService } from './services/google-sheets.js';
import { YandexDictionaryService } from './services/yandex-dictionary-service.js';
import { CambridgeDictionaryService } from './services/cambridge-dictionary-service.js';
import { FSRSService } from './services/fsrs-service.js';
import express from 'express';

// Минимальный Express сервер для Render
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    message: 'Bot is running',
    timestamp: new Date().toISOString()
  });
});

app.get('/', (req, res) => {
  res.status(200).json({
    service: 'Telegram English Bot',
    status: 'operational',
    version: '1.0.0'
  });
});

// Запускаем сервер
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Health check server running on port ${PORT}`);
});

// Обработка graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});

// ✅ ИСПРАВЛЕНИЕ: Улучшенная конфигурация бота с обработкой дублирования
const bot = new TelegramBot(process.env.BOT_TOKEN, { 
  polling: {
    interval: 300,
    autoStart: true,
    params: {
      timeout: 10,
    }
  }
});

// ✅ ИСПРАВЛЕНИЕ: Глобальная защита от дублирования сообщений
const messageProcessing = new Map();
const MESSAGE_PROCESSING_TIMEOUT = 3000; // 3 секунды

// Функция для проверки дублирования
function isDuplicateMessage(chatId, messageId) {
  const key = `${chatId}_${messageId}`;
  if (messageProcessing.has(key)) {
    return true;
  }
  messageProcessing.set(key, Date.now());
  
  // Очистка старых записей
  setTimeout(() => {
    messageProcessing.delete(key);
  }, MESSAGE_PROCESSING_TIMEOUT);
  
  return false;
}

// Обработчик ошибок polling с интеллектуальным перезапуском
bot.on('polling_error', (error) => {
  console.error('❌ Polling error:', error.code, error.message);
  
  // Только для определенных ошибок делаем перезапуск
  const recoverableErrors = ['EFATAL', 'ETELEGRAM', 'ECONNRESET'];
  if (recoverableErrors.includes(error.code)) {
    console.log('🔄 Restarting bot polling...');
    setTimeout(() => {
      try {
        bot.stopPolling();
        setTimeout(() => bot.startPolling(), 1000);
      } catch (restartError) {
        console.error('Failed to restart polling:', restartError);
      }
    }, 5000);
  }
});

bot.on('webhook_error', (error) => {
  console.error('❌ Webhook error:', error);
});

bot.on('polling_start', () => {
  console.log('✅ Bot polling started successfully');
});

// Оптимизированные хранилища для экономии памяти
const userStates = new Map();
const cache = new Map();
const dailyLearnedWords = new Map();
const learnedWords = new Map();
const audioCache = new Map();
const REVERSE_TRAINING_STATES = {
    ACTIVE: 'reverse_training',
    SPELLING: 'reverse_training_spelling'
};

// Ленивая инициализация сервисов
let sheetsService, yandexService, cambridgeService, fsrsService;
let servicesInitialized = false;
let initializationInProgress = false;

async function initializeServices() {
  if (servicesInitialized) return true;
  if (initializationInProgress) {
    // Ждем завершения текущей инициализации
    return new Promise(resolve => {
      const checkInitialized = () => {
        if (servicesInitialized) resolve(true);
        else setTimeout(checkInitialized, 100);
      };
      checkInitialized();
    });
  }

  initializationInProgress = true;
  
  try {
    console.log('🔄 Fast initializing services...');
    
    // Быстрая инициализация без долгих таймаутов
    sheetsService = new GoogleSheetsService();
    yandexService = new YandexDictionaryService();
    cambridgeService = new CambridgeDictionaryService();
    fsrsService = new FSRSService();
    
    // Не ждем полной инициализации Google Sheets - запускаем в фоне
    setTimeout(() => {
      if (!sheetsService.initialized) {
        console.log('⚠️ Google Sheets still initializing in background...');
      }
    }, 1000);
    
    servicesInitialized = true;
    console.log('✅ Services initialized (fast mode)');
    return true;
    
  } catch (error) {
    console.error('❌ Service initialization error:', error);
    // Все равно продолжаем работу
    servicesInitialized = true;
    return true;
  } finally {
    initializationInProgress = false;
  }
}

// Очистка неактивных пользователей каждые 30 минут
setInterval(() => {
    const now = Date.now();
    for (const [chatId, state] of userStates.entries()) {
        if (now - (state.lastActivity || 0) > 30 * 60 * 1000) {
            userStates.delete(chatId);
        }
    }
}, 30 * 60 * 1000);

// Функции для работы с кешем
function updateUserActivity(chatId) {
    const state = userStates.get(chatId);
    if (state) {
        state.lastActivity = Date.now();
    }
}

function cacheAudio(audioId, audioUrl, word = '') {
    audioCache.set(audioId, {
        url: audioUrl,
        word: word,
        timestamp: Date.now()
    });
    
    // Очистка старых записей (старше 1 часа)
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    for (const [key, value] of audioCache.entries()) {
        if (value.timestamp < oneHourAgo) {
            audioCache.delete(key);
        }
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
async function processCustomTranslationWithDetails(chatId, userState, translation, definition = '', example = '') {
    if (!translation || translation.trim() === '') {
        await bot.sendMessage(chatId, '❌ Перевод не может быть пустым. Введите перевод:');
        return;
    }

    const newTranslations = [translation, ...(userState.tempTranslations || [])];
    const newMeaning = {
        translation: translation,
        englishDefinition: definition,
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

    let message = `✅ **Ваш перевод добавлен!**\n\n`;
    message += `🇬🇧 Слово: **${userState.tempWord}**\n`;
    message += `🇷🇺 Перевод: **${translation}**\n`;
    
    if (definition) {
        message += `📖 Определение: ${definition}\n`;
    }
    
    if (example) {
        message += `💡 Пример: ${example}\n`;
    }
    
    message += `\n🎯 Теперь выберите переводы для сохранения:`;
    
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
        console.error('Error in processReviewRating:', error);
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

        // ✅ ИЗМЕНЕНИЕ: Получаем 5 случайных не изученных слов
        const availableNewWords = await getRandomUnlearnedWords(chatId, 5);
        
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
        console.error('Error in startNewWordsSession:', error);
        await bot.sendMessage(chatId, '❌ Ошибка при загрузке новых слов.');
    }
}

// Функция для перемешивания массива (Fisher-Yates shuffle)
function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

// ✅ НОВАЯ ФУНКЦИЯ: Получение случайных не изученных слов
async function getRandomUnlearnedWords(chatId, count = 5) {
    const unlearnedWords = await getAllUnlearnedWords(chatId);
    
    // Перемешиваем массив и берем нужное количество слов
    const shuffledWords = shuffleArray(unlearnedWords);
    return shuffledWords.slice(0, count);
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
    
    if (word.meanings && Array.isArray(word.meanings)) {
        word.meanings.forEach((meaning, index) => {
            message += `\n${index + 1}. ${meaning.translation || 'перевод'}`;
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
            const fsrsResult = await fsrsService.reviewCard(chatId, word, cardData, 'good');
            
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
        console.error('Error in processNewWordLearning:', error);
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
  // ✅ ИСПРАВЛЕНИЕ: Защита от повторного вызова
  const processingKey = `stats_${chatId}_${Date.now()}`;
  if (isDuplicateMessage(chatId, processingKey)) {
    console.log('🛑 Duplicate stats request blocked');
    return;
  }

  await initializeServices();
  
  if (!sheetsService.initialized) {
    await bot.sendMessage(chatId, '❌ Сервис временно недоступен.');
    return;
  }

  try {
    const userWords = await getCachedUserWords(chatId);
    const activeWords = userWords.filter(word => word.status === 'active');
    
    // Старая статистика...
    const newWords = await getAllUnlearnedWords(chatId);
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
    
    // ✅ ДОБАВЛЕНО: Статистика по гибридной системе
    const wordsWithReverseData = await Promise.all(
        learnedWords.map(async (word) => {
            const reverseData = await sheetsService.getReverseCardData(chatId, word.english);
            return { word, reverseData };
        })
    );
    
    const trainedReverseWords = wordsWithReverseData.filter(({ reverseData }) => 
        reverseData && reverseData.reps > 0
    );
    
    const totalReverseReps = trainedReverseWords.reduce((sum, { reverseData }) => 
        sum + (reverseData.reps || 0), 0
    );
    
    const syncedWords = wordsWithReverseData.filter(({ word, reverseData }) => 
        reverseData && calculateCorrelation(reverseData.interval, word.interval) >= 0.8
    );
    
    message += `\n🔁 **Гибридная система:**\n`;
    message += `• Слов с обратными карточками: ${trainedReverseWords.length}\n`;
    message += `• Всего повторений Рус→Англ: ${totalReverseReps}\n`;
    message += `• Синхронизированных слов: ${syncedWords.length}\n`;
    message += `• Прогресс: ${learnedWordsCount > 0 ? Math.round((syncedWords.length / learnedWordsCount) * 100) : 0}%\n`;
    
    if (remainingToday > 0) {
        message += `🎯 Осталось изучить сегодня: ${remainingToday} слов\n`;
    } else {
        message += `✅ Дневной лимит достигнут!\n`;
    }

    // ✅ ИСПРАВЛЕНИЕ: Отправляем сообщение только один раз
    await bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        ...getMainMenu()
    });
    
  } catch (error) {
    console.error('Error showing stats:', error);
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

// ФУНКЦИЯ: Расчет корреляции между интервалами
function calculateCorrelation(reverseInterval, mainInterval) {
    if (mainInterval <= 0) return 1.0;
    const ratio = reverseInterval / mainInterval;
    return Math.min(Math.max(ratio, 0.5), 2.0); // Ограничиваем разницу от 0.5x до 2x
}

// Обработчики команд
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    // Немедленный ответ чтобы пользователь знал что бот "проснулся"
    await bot.sendChatAction(chatId, 'typing');
    const welcomeMsg = await bot.sendMessage(chatId, '🔄 Запускаю бота...');
    
    // Быстрая инициализация
    await initializeServices();
    
    // Обновляем сообщение когда все готово
    const welcomeMessage = 
      '📚 Англо-русский словарь\n' +
      '🔤 С транскрипцией и произношением\n' +
      '🇬🇧 Британский вариант\n' +
      '📝 Каждое слово хранится с несколькими значениями\n' +
      '🔄 **Умное интервальное повторение (FSRS)**\n\n' +
      '💡 **Как учить слова:**\n' +
      '1. ➕ Добавить новое слово\n' +
      '2. 🆕 Изучить новые слова (5 в день)\n' +
      '3. 📚 Повторить изученные слова\n\n' +
      'Используйте меню для навигации:';
    
    await bot.editMessageText(welcomeMessage, {
      chat_id: chatId,
      message_id: welcomeMsg.message_id,
      parse_mode: 'Markdown',
      ...getMainMenu()
    });
    
  } catch (error) {
    console.error('Start command error:', error);
    // Фолбэк - просто отправляем сообщение без редактирования
    await bot.sendMessage(chatId, 
      '📚 Англо-русский словарь бот\n\nВыберите действие из меню:', 
      getMainMenu()
    );
  }
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
    const messageId = msg.message_id;

    // ✅ Защита от дублирования
    if (isDuplicateMessage(chatId, messageId)) {
        console.log('🛑 Duplicate message blocked:', text);
        return;
    }

    if (!text || text.startsWith('/')) {
        return;
    }

    await initializeServices();
    updateUserActivity(chatId);

    const userState = userStates.get(chatId);

    // ✅ ИСПРАВЛЕНИЕ: Добавляем задержку для стабильности
    await new Promise(resolve => setTimeout(resolve, 100));

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
        if (text === '❌ Отмена') {
            userStates.delete(chatId);
            await showMainMenu(chatId, '❌ Добавление перевода отменено.');
        } else if (text && text.trim() !== '') {
            // Сохраняем перевод и запрашиваем определение
            userStates.set(chatId, {
                ...userState,
                state: 'waiting_custom_definition',
                customTranslation: text.trim()
            });

            await bot.sendMessage(chatId, 
                `✅ Перевод "${text.trim()}" сохранен.\n\n` +
                `📖 Введите значение на английском (определение) или отправьте "-" чтобы пропустить:`,
                {
                    reply_markup: {
                        keyboard: [['-', '❌ Отмена']],
                        resize_keyboard: true
                    }
                }
            );
        } else {
            await bot.sendMessage(chatId, '❌ Перевод не может быть пустым. Введите перевод:');
        }
    }
    else if (userState?.state === 'waiting_custom_definition') {
        if (text === '❌ Отмена') {
            userStates.delete(chatId);
            await showMainMenu(chatId, '❌ Добавление перевода отменено.');
        } else {
            // Сохраняем определение и запрашиваем пример
            userStates.set(chatId, {
                ...userState,
                state: 'waiting_custom_example',
                customDefinition: text === '-' ? '' : text.trim()
            });

            await bot.sendMessage(chatId, 
                `✅ Определение сохранено.\n\n` +
                `💡 Теперь введите пример использования (или отправьте "-" чтобы пропустить):`,
                {
                    reply_markup: {
                        keyboard: [['-', '❌ Отмена']],
                        resize_keyboard: true
                    }
                }
            );
        }
    }
    else if (userState?.state === 'waiting_custom_example') {
        if (text === '❌ Отмена') {
            userStates.delete(chatId);
            await showMainMenu(chatId, '❌ Добавление перевода отменено.');
        } else {
            // Сохраняем пример и завершаем процесс
            const example = text === '-' ? '' : text.trim();
            await processCustomTranslationWithDetails(chatId, userState, userState.customTranslation, userState.customDefinition, example);
        }
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
            await returnToTraining(chatId, userState);
        } else {
            await checkTrainingSpellingAnswer(chatId, text);
        }
    }
    else if (userState?.state === 'waiting_translation') {
        if (text === '❌ Отмена') {
            userStates.delete(chatId);
            await showMainMenu(chatId, '❌ Добавление слова отменено.');
        } else {
            await processManualTranslation(chatId, userState, text);
        }
    }
    else if (userState?.state === 'waiting_example') {
        if (text === '❌ Отмена') {
            userStates.delete(chatId);
            await showMainMenu(chatId, '❌ Добавление слова отменено.');
        } else {
            await saveWordWithManualInput(chatId, userState, text);
        }
    }
    else if (userState?.state === 'waiting_definition') {
        if (text === '❌ Отмена') {
            userStates.delete(chatId);
            await showMainMenu(chatId, '❌ Добавление слова отменено.');
        } else {
            await processManualDefinition(chatId, userState, text);
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
        await bot.sendMessage(chatId, '❌ Это не похоже на английское слово. Введите корректное слово:');
        return;
    }

    await bot.sendMessage(chatId, '🔍 Ищу перевод в Cambridge Dictionary...');

    try {
        if (!servicesInitialized) {
            await initializeServices();
        }

        let transcription = '';
        let audioUrl = '';
        let meanings = [];
        let translations = [];

        // ПЕРВЫЙ ПРИОРИТЕТ: Cambridge Dictionary для переводов
        try {
            const cambridgeData = await cambridgeService.getWordData(lowerWord);
            
            if (cambridgeData.meanings && cambridgeData.meanings.length > 0) {
                meanings = cambridgeData.meanings;
                translations = meanings
                    .map(m => m.translation)
                    .filter(t => t && t.trim() !== '')
                    .filter((t, i, arr) => arr.indexOf(t) === i);
                
                if (translations.length > 0) {
                    await bot.sendMessage(chatId, '✅ Перевод найден в Cambridge Dictionary!');
                } else {
                    await bot.sendMessage(chatId, '❌ Переводы не найдены в Cambridge Dictionary');
                }
            } else {
                await bot.sendMessage(chatId, '❌ Слово не найдено в Cambridge Dictionary');
            }
        } catch (cambridgeError) {
            console.log('Cambridge Dictionary не доступен:', cambridgeError);
            await bot.sendMessage(chatId, '❌ Cambridge Dictionary не доступен');
        }

        // ВТОРОЙ ЭТАП: Yandex для транскрипции и аудио
        await bot.sendMessage(chatId, '🎵 Ищу транскрипцию и произношение...');
        
        try {
            const yandexData = await yandexService.getTranscriptionAndAudio(lowerWord);
            
            if (yandexData) {
                transcription = yandexData.transcription || '';
                audioUrl = yandexData.audioUrl || '';
                
                if (transcription || audioUrl) {
                    await bot.sendMessage(chatId, '✅ Транскрипция и аудио найдены!');
                } else {
                    await bot.sendMessage(chatId, '❌ Транскрипция и аудио не найдены');
                }
            }
        } catch (yandexError) {
            console.log('Yandex audio service не доступен:', yandexError);
            await bot.sendMessage(chatId, '❌ Сервис произношения не доступен');
        }

        // Fallback для аудио
        if (!audioUrl) {
            audioUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(lowerWord)}&tl=en-gb&client=tw-ob`;
        }

        // Генерируем уникальный ID для аудио
        const audioId = `audio_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        cacheAudio(audioId, audioUrl, lowerWord);

        // Сохраняем состояние с ВСЕМИ данными
        userStates.set(chatId, {
            state: 'showing_transcription',
            tempWord: lowerWord,
            tempTranscription: transcription,
            tempAudioUrl: audioUrl,
            tempAudioId: audioId,
            tempTranslations: translations,
            meanings: meanings,
            selectedTranslationIndices: [],
            lastActivity: Date.now()
        });

        // Формируем сообщение с результатами поиска
        let message = `📋 **Результаты поиска:**\n\n`;
        message += `🇬🇧 Слово: **${lowerWord}**\n`;
        
        if (transcription) {
            message += `🔤 Транскрипция: *${transcription}*\n`;
        }
        
        if (translations.length > 0) {
            message += `\n✅ Найдено переводов: ${translations.length}\n`;
            message += `📚 Источник: Cambridge Dictionary\n\n`;
            message += `💡 Вы можете:\n`;
            message += `• Прослушать произношение 🔊\n`;
            message += `• Выбрать из найденных переводов\n`;
            message += `• Добавить свой вариант перевода\n\n`;
            message += `🎯 Выберите действие:`;
        } else {
            message += `\n❌ Переводы не найдены\n`;
            message += `💡 Вы можете:\n`;
            message += `• Прослушать произношение 🔊\n`;
            message += `• Добавить перевод вручную\n\n`;
            message += `🎯 Выберите действие:`;
        }

        // Отправляем сообщение с кнопками
        await bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    audioUrl ? [{ text: '🔊 Прослушать произношение', callback_data: `audio_${audioId}` }] : [],
                    [{ text: '➡️ Выбрать перевод', callback_data: 'enter_translation' }]
                ].filter(row => row.length > 0)
            }
        });

    } catch (error) {
        console.error('Общая ошибка при поиске слова:', error);
        
        let errorMessage = '❌ Произошла ошибка при поиске слова.\n\n';
        errorMessage += '📝 Введите перевод на русский язык вручную:';
        
        // Сохраняем состояние для ручного ввода
        userStates.set(chatId, {
            state: 'waiting_translation',
            tempWord: lowerWord,
            tempTranscription: '',
            tempAudioUrl: '',
            meanings: [],
            tempTranslations: [],
            selectedTranslationIndices: [],
            lastActivity: Date.now()
        });

        await bot.sendMessage(chatId, errorMessage, { 
            parse_mode: 'Markdown',
            reply_markup: {
                keyboard: [['❌ Отмена']],
                resize_keyboard: true
            }
        });
    }
}

// Обработчики callback
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;
    const callbackId = callbackQuery.id;
    
    // ✅ Защита от дублирования callback
    if (isDuplicateMessage(chatId, `callback_${callbackId}`)) {
        console.log('🛑 Duplicate callback blocked:', data);
        await bot.answerCallbackQuery(callbackQuery.id);
        return;
    }

    await initializeServices();
    updateUserActivity(chatId);

    const userState = userStates.get(chatId);
    await bot.answerCallbackQuery(callbackQuery.id);

    console.log(`📨 Callback received: ${data}`);


    // Обработка аудио через короткий ID
    if (data.startsWith('audio_')) {
        const audioId = data.replace('audio_', '');
        const cachedAudio = audioCache.get(audioId);
        const audioUrl = cachedAudio?.url || userState?.tempAudioUrl;
        const englishWord = userState?.tempWord || cachedAudio?.word || 'слова';

        if (audioUrl) {
            try {
                // Убираем клавиатуру у сообщения
                await bot.editMessageReplyMarkup(
                    { inline_keyboard: [] },
                    { chat_id: chatId, message_id: callbackQuery.message.message_id }
                );
                
                await bot.sendAudio(chatId, audioUrl, {
                    caption: `🔊 Британское произношение: ${englishWord}`
                });
                
                // После проигрывания аудио предлагаем продолжить
                await bot.sendMessage(chatId, 
                    '🎵 Вы прослушали произношение. Хотите выбрать перевод?', 
                    {
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '✏️ Выбрать перевод', callback_data: 'enter_translation' }]
                            ]
                        }
                    }
                );
            } catch (audioError) {
                console.error('Audio playback error:', audioError);
                await bot.sendMessage(chatId, '❌ Ошибка при воспроизведении аудио.');
            }
        } else {
            await bot.sendMessage(chatId, '❌ Аудио произношение недоступно для этого слова.');
        }
        return;
    }

    // Обработка деталей перевода
    if (data.startsWith('details_')) {
        const translationIndex = parseInt(data.replace('details_', ''));
        if (userState?.state === 'choosing_translation' && userState.tempTranslations[translationIndex]) {
            await showTranslationDetails(chatId, translationIndex, userState);
        }
        return;
    }

    // Назад к переводам
    if (data === 'back_to_translations') {
        if (userState?.state === 'choosing_translation') {
            await backToTranslationSelection(chatId, userState, callbackQuery);
        }
        return;
    }

    // Переключение выбора перевода
    if (data.startsWith('toggle_translation_')) {
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
        return;
    }

    // Сохранение выбранных переводов
    if (data === 'save_selected_translations') {
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
        return;
    }

    // Пользовательский перевод
    if (data === 'custom_translation') {
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
                await bot.sendMessage(chatId, translationMessage, { 
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [['❌ Отмена']],
                        resize_keyboard: true
                    }
                });
            } catch (error) {
                await bot.sendMessage(chatId, '❌ Ошибка при обработке запроса');
            }
        }
        return;
    }

    // Отмена перевода
    if (data === 'cancel_translation') {
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

                // Генерируем новый audioId для кнопки
                const audioId = `audio_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                audioCache.set(audioId, userState.tempAudioUrl);

                await bot.editMessageReplyMarkup(
                    {
                        inline_keyboard: [
                            userState.tempAudioUrl ? [{ text: '🔊 Прослушать произношение', callback_data: audioId }] : [],
                            [{ text: '➡️ Выбрать перевод', callback_data: 'enter_translation' }]
                        ].filter(row => row.length > 0)
                    },
                    { chat_id: chatId, message_id: callbackQuery.message.message_id }
                );
            } catch (error) {
                await bot.sendMessage(chatId, '❌ Ошибка при отмене');
            }
        }
        return;
    }

    // Показать ответ в режиме повторения
    if (data === 'show_answer') {
        await showReviewAnswer(chatId);
        return;
    }

    // Оценка в режиме повторения
    if (data.startsWith('review_')) {
        const rating = data.replace('review_', '');
        await processReviewRating(chatId, rating);
        return;
    }

    // Завершить повторение
    if (data === 'end_review') {
        if (userState?.state === 'review_session') {
            await completeReviewSession(chatId, userState);
        }
        return;
    }

    // Изучение новых слов
    if (data === 'learned_word') {
        await processNewWordLearning(chatId, 'learned');
        return;
    }

    if (data === 'need_repeat_word') {
        await processNewWordLearning(chatId, 'repeat');
        return;
    }

    // Тренировка правописания
    if (data === 'spelling_train') {
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
        return;
    }

    // Выбор перевода
    if (data === 'enter_translation') {
        console.log('🔍 Processing enter_translation callback');
        
        if (userState?.state === 'showing_transcription') {
            try {
                const hasTranslations = userState.tempTranslations && 
                                      userState.tempTranslations.length > 0;
                
                console.log(`🔍 Translations available: ${hasTranslations}, count: ${userState.tempTranslations?.length}`);

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
                    
                    translationMessage += '\n\n💡 Нажмите на перевод чтобы выбрать его, или 🔍 для подробностей';

                    // Удаляем предыдущее сообщение и отправляем новое с кнопками выбора
                    try {
                        await bot.deleteMessage(chatId, callbackQuery.message.message_id);
                    } catch (deleteError) {
                        console.log('⚠️ Could not delete previous message');
                    }

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

                    try {
                        await bot.deleteMessage(chatId, callbackQuery.message.message_id);
                    } catch (deleteError) {
                        console.log('⚠️ Could not delete previous message');
                    }

                    await bot.sendMessage(chatId, translationMessage, { 
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [['❌ Отмена']],
                            resize_keyboard: true
                        }
                    });
                }
                
            } catch (error) {
                console.log('❌ Error in enter_translation:', error);
                await bot.sendMessage(chatId, 
                    '❌ Ошибка при обработке запроса. Попробуйте еще раз.'
                );
            }
        } else {
            console.log(`❌ Wrong state for enter_translation: ${userState?.state}`);
            await bot.sendMessage(chatId, 
                '❌ Неверное состояние. Начните добавление слова заново.'
            );
            userStates.delete(chatId);
        }
        return;
    }

    // Если callback_data не распознан
    console.log(`❓ Unknown callback data: ${data}`);
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
        const userWords = await getCachedUserWords(chatId);
        
        // Фильтруем слова, которые уже изучены
        const learnedWords = userWords.filter(word => 
            word.status === 'active' && 
            word.interval > 1 && 
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

        // Загружаем данные обратных карточек для каждого слова
        const wordsWithReverseData = await Promise.all(
            learnedWords.map(async (word) => {
                try {
                    const reverseData = await sheetsService.getReverseCardData(chatId, word.english);
                    return {
                        ...word,
                        reverseCard: reverseData
                    };
                } catch (error) {
                    console.error(`Error loading reverse data for ${word.english}:`, error);
                    return word;
                }
            })
        );

        // Быстрое перемешивание
        const shuffledWords = wordsWithReverseData
            .map(word => ({ word, sort: Math.random() }))
            .sort((a, b) => a.sort - b.sort)
            .map(({ word }) => word)
            .slice(0, 10);

        userStates.set(chatId, {
            state: REVERSE_TRAINING_STATES.ACTIVE,
            words: shuffledWords,
            total: shuffledWords.length,
            index: 0,
            correct: 0,
            startTime: Date.now(),
            lastActivity: Date.now()
        });

        // ✅ ДОБАВЛЕНО: Информационное сообщение о гибридной системе
        await bot.sendMessage(chatId,
            `🔁 **Тренировка Рус→Англ (Гибридная система)**\n\n` +
            `📊 Всего слов: ${shuffledWords.length}\n` +
            `🎯 Особенности системы:\n` +
            `• Отдельные интервалы для каждого направления\n` +
            `• Успех в обратном направлении улучшает основное\n` +
            `• Автоматическая синхронизация прогресса\n` +
            `• Адаптивная сложность для каждого направления\n\n` +
            `💡 Начинаем тренировку!`,
            { parse_mode: 'Markdown' }
        );

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

    try {
        const rating = isCorrect ? 'good' : 'again';
        
        // ✅ ГИБРИД: Получаем или создаем обратную карточку
        let reverseCardData = await sheetsService.getReverseCardData(chatId, word.english);
        
        if (!reverseCardData) {
            // Создаем новую обратную карточку на основе основной
            const mainCardData = {
                difficulty: word.difficulty || 5.0,
                interval: word.interval || 1
            };
            reverseCardData = await createReverseCard(chatId, word.english, mainCardData);
        }

        // Обновляем ОБРАТНУЮ карточку через FSRS
        const fsrsResult = await fsrsService.reviewCard(chatId, word.english, reverseCardData, rating);
        
        if (fsrsResult) {
            // Сохраняем обратную карточку
            const success = await sheetsService.updateReverseCardProgress(
                chatId,
                word.english,
                fsrsResult,
                rating
            );
            
            if (success) {
                console.log('✅ Reverse card updated. New interval:', fsrsResult.interval, 'days');
                
                // ✅ СИНХРОНИЗАЦИЯ: Успех в обратном направлении улучшает основную карточку
                if (isCorrect) {
                    const correlation = calculateCorrelation(fsrsResult.interval, word.interval);
                    console.log('🔗 Correlation factor:', correlation);
                    
                    // Если корреляция хорошая, улучшаем основную карточку
                    if (correlation >= 0.8) {
                        const mainCardData = {
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
                        
                        // Используем рейтинг в зависимости от корреляции
                        let mainCardRating = 'hard';
                        if (correlation >= 1.2) mainCardRating = 'good';
                        if (correlation >= 1.5) mainCardRating = 'easy';
                        
                        const mainCardUpdate = await fsrsService.reviewCard(
                            chatId, 
                            word.english, 
                            mainCardData, 
                            mainCardRating
                        );
                        
                        if (mainCardUpdate) {
                            await sheetsService.updateWordAfterFSRSReview(
                                chatId,
                                word.english,
                                mainCardUpdate,
                                mainCardRating
                            );
                        }
                    }
                }
            }
        }
    } catch (error) {
        console.error('❌ Error in hybrid training:', error);
    }

    await showTrainingResult(chatId, state, word, isCorrect, userAnswer);
    
    setTimeout(async () => {
        state.index++;
        state.lastActivity = Date.now();

        if (state.index >= state.words.length) {
            await completeTraining(chatId, state);
        } else {
            await showNextTrainingWord(chatId);
        }
    }, 2500);
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
    if (translations.length) message += `📚 ${translations.join(', ')}\n\n`;
    
    // ✅ ДОБАВЛЕНО: Информация о прогрессе обеих карточек
    message += `📊 **Прогресс обучения:**\n`;
    message += `• Основное направление: ${word.interval || 1} дней\n`;
    
    // Получаем данные обратной карточки для отображения
    try {
        const reverseCardData = await sheetsService.getReverseCardData(chatId, word.english);
        if (reverseCardData) {
            message += `• Обратное направление: ${reverseCardData.interval || 1} дней\n`;
            
            const correlation = calculateCorrelation(reverseCardData.interval, word.interval);
            if (correlation >= 1.2) {
                message += `• 🎯 Отлично! Вы знаете слово в обоих направлениях\n`;
            } else if (correlation >= 0.8) {
                message += `• 👍 Хорошо! Прогресс синхронизирован\n`;
            } else {
                message += `• 💪 Продолжайте тренировать обратное направление\n`;
            }
        } else {
            message += `• Обратное направление: новая тренировка\n`;
        }
    } catch (error) {
        message += `• Обратное направление: обновляется...\n`;
    }

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
    message += `📊 Результаты:\n`;
    message += `• Пройдено слов: ${index}/${total}\n`;
    message += `• Правильных ответов: ${correct}\n`;
    message += `• Точность: ${accuracy}%\n`;
    message += `• Время: ${timeSpent} мин\n\n`;
    
    // ✅ ДОБАВЛЕНО: Статистика по гибридной системе
    message += `🔁 **Гибридная система:**\n`;
    message += `• ${correct} слов обновлено в обратных карточках\n`;
    message += `• Прогресс синхронизирован с основным обучением\n`;
    message += `• Интервалы адаптируются к каждому направлению\n\n`;
    
    if (accuracy >= 80) {
        message += `💪 Отлично! Обратное направление хорошо освоено!\n`;
        message += `🔄 Следующее повторение будет через увеличенный интервал`;
    } else if (accuracy >= 60) {
        message += `👍 Хорошо! Продолжайте тренироваться!\n`;
        message += `📚 Слова будут повторяться чаще для закрепления`;
    } else {
        message += `💡 Есть над чем поработать!\n`;
        message += `🎯 Эти слова будут повторяться чаще в обратном направлении`;
    }

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

async function askTrainingSpellingQuestion(chatId, translation) {
    const message = `✍️ **Тренировка правописания**\n\n` +
                   `🇷🇺 Перевод: **${translation}**\n\n` +
                   `✏️ Напишите английское слово:`;

    await bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: {
            keyboard: [['🔙 Назад']],
            resize_keyboard: true
        }
    });
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
            return cached.url;
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
                url: audioUrl,
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

async function processManualTranslation(chatId, userState, translation) {
    if (!translation || translation.trim() === '') {
        await bot.sendMessage(chatId, '❌ Перевод не может быть пустым. Введите перевод:');
        return;
    }

    // Сохраняем перевод
    const newTranslation = translation.trim();
    
    // Переходим к следующему шагу - запросу значения (определения)
    userStates.set(chatId, {
        ...userState,
        state: 'waiting_definition',
        tempTranslation: newTranslation,
        lastActivity: Date.now()
    });

    await bot.sendMessage(chatId, 
        `✅ Перевод "${newTranslation}" сохранен.\n\n` +
        `📖 Введите значение на английском (определение) или отправьте "-" чтобы пропустить:`,
        {
            reply_markup: {
                keyboard: [['-', '❌ Отмена']],
                resize_keyboard: true
            }
        }
    );
}

async function saveWordWithManualInput(chatId, userState, example = '') {
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
        const meaningsData = [{
            translation: userState.tempTranslation,
            example: example === '-' ? '' : example,
            partOfSpeech: '',
            definition: userState.tempDefinition || ''
        }];

        // Создаем FSRS карточку для нового слова
        const fsrsCard = fsrsService.createNewCard();
        
        const success = await sheetsService.addWordWithMeanings(
            chatId,
            userState.tempWord,
            userState.tempTranscription || '',
            userState.tempAudioUrl || '',
            meaningsData
        );

        userStates.delete(chatId);

        if (success) {
            const transcriptionText = userState.tempTranscription ? ` [${userState.tempTranscription}]` : '';
            let successMessage = '✅ Слово добавлено в словарь!\n\n' +
                `💬 **${userState.tempWord}**${transcriptionText}\n` +
                `📝 **Перевод:** ${userState.tempTranslation}`;
            
            if (userState.tempDefinition) {
                successMessage += `\n📖 **Значение:** ${userState.tempDefinition}`;
            }
            
            if (example && example !== '-') {
                successMessage += `\n📚 **Пример:** ${example}`;
            }
            
            successMessage += '\n\n📚 Теперь вы можете изучать слово в разделе "🆕 Новые слова"!';
            await showMainMenu(chatId, successMessage);
        } else {
            await showMainMenu(chatId, 
                '❌ Ошибка сохранения\n\n' +
                'Не удалось сохранить слово в словарь. Попробуйте еще раз.'
            );
        }

    } catch (error) {
        console.error('Error in saveWordWithManualInput:', error);
        await showMainMenu(chatId, 
            '❌ Ошибка при сохранении слова.\n\n' +
            'Попробуйте еще раз.'
        );
        userStates.delete(chatId);
    }
}

async function processManualDefinition(chatId, userState, definition) {
    // Сохраняем определение
    const newDefinition = definition.trim();
    
    // Переходим к следующему шагу - запросу примера
    userStates.set(chatId, {
        ...userState,
        state: 'waiting_example',
        tempDefinition: newDefinition === '-' ? '' : newDefinition,
        lastActivity: Date.now()
    });

    await bot.sendMessage(chatId, 
        `✅ Определение сохранено.\n\n` +
        `💡 Теперь введите пример использования (или отправьте "-" чтобы пропустить):`,
        {
            reply_markup: {
                keyboard: [['-', '❌ Отмена']],
                resize_keyboard: true
            }
        }
    );
}

async function createReverseCard(chatId, englishWord, mainCardData) {
    const baseDifficulty = (mainCardData?.difficulty || 5.0) + 0.5; // Сложнее на 0.5
    const adjustedDifficulty = Math.max(3.0, Math.min(baseDifficulty, 7.0));
    
    return {
        due: new Date(),
        stability: 0.1,
        difficulty: adjustedDifficulty,
        elapsed_days: 0,
        scheduled_days: 1,
        reps: 0,
        lapses: 0,
        state: 1,
        last_review: new Date(),
        card_type: 'reverse'
    };
}

// Запуск периодических задач
setInterval(() => {
    resetDailyLimit();
}, 60 * 60 * 1000);

initializeServices().then(() => {
    console.log('✅ Bot started successfully on Railways');
}).catch(error => {
    console.error('❌ Failed to start bot:', error);
});


