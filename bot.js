import TelegramBot from 'node-telegram-bot-api';
import { GoogleSheetsService } from './services/google-sheets.js';
import { TranscriptionService } from './services/transcription-service.js';

const bot = new TelegramBot(process.env.BOT_TOKEN, { 
    polling: true 
});

const sheetsService = new GoogleSheetsService();
const transcriptionService = new TranscriptionService();

// Хранилище состояний пользователей
const userStates = new Map();

// Хранилище для отслеживания отправленных аудио в каждом чате
const sentAudios = new Map();

// Главное меню
function getMainMenu() {
    return {
        reply_markup: {
            keyboard: [
                ['➕ Добавить новое слово']
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
                [{ text: '➡️ Ввести перевод', callback_data: 'enter_translation' }]
            ]
        }
    };
}

// Клавиатура действий после прослушивания
function getAfterAudioKeyboard() {
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: '✏️ Ввести перевод', callback_data: 'enter_translation' }]
            ]
        }
    };
}

// Функция для принудительного показа меню
function showMainMenu(chatId, text = '') {
    if (text && text.trim() !== '') {
        return bot.sendMessage(chatId, text, getMainMenu());
    } else {
        // Просто показываем меню без текста или с минимальным текстом
        return bot.sendMessage(chatId, ' ', getMainMenu());
    }
}

// Функция для проверки, есть ли предыдущие аудио в чате
function hasPreviousAudios(chatId, currentAudioUrl) {
    if (!sentAudios.has(chatId)) {
        return false;
    }
    
    const chatAudios = sentAudios.get(chatId);
    const previousAudios = chatAudios.filter(audio => audio.url !== currentAudioUrl);
    return previousAudios.length > 0;
}

// Функция для добавления аудио в историю чата
function addAudioToHistory(chatId, audioUrl, word) {
    if (!sentAudios.has(chatId)) {
        sentAudios.set(chatId, []);
    }
    
    const chatAudios = sentAudios.get(chatId);
    const existingAudioIndex = chatAudios.findIndex(audio => audio.url === audioUrl);
    
    if (existingAudioIndex !== -1) {
        chatAudios[existingAudioIndex] = { url: audioUrl, word: word, timestamp: Date.now() };
    } else {
        chatAudios.push({ url: audioUrl, word: word, timestamp: Date.now() });
    }
    
    if (chatAudios.length > 10) {
        chatAudios.shift();
    }
}

// Команда /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    showMainMenu(chatId, 
        '📚 Англо-русский словарь\n' +
        '🔤 С транскрипцией и произношением\n' +
        '🇬🇧 Британский вариант'
    );
});

// Обработка сообщений
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (text.startsWith('/')) return;

    const userState = userStates.get(chatId);

    if (text === '➕ Добавить новое слово') {
        userStates.set(chatId, { state: 'waiting_english' });
        showMainMenu(chatId, '🇬🇧 Введите английское слово:');
    }
    else if (userState?.state === 'waiting_english') {
        const englishWord = text.trim().toLowerCase();
        
        // Проверяем что это английское слово
        if (!/^[a-zA-Z\s\-']+$/.test(englishWord)) {
            showMainMenu(chatId, 
                '❌ Это не похоже на английское слово.\n' +
                'Пожалуйста, введите слово на английском:'
            );
            return;
        }
        
        // ✅ ПРОВЕРКА GOOGLE SHEETS И ДУБЛИКАТОВ
        if (!sheetsService.initialized) {
            showMainMenu(chatId, 
                '❌ Сервис словаря временно недоступен\n\n' +
                'Попробуйте позже или продолжите без проверки дубликатов.'
            );
            // Пропускаем проверку дубликатов и продолжаем
        } else {
            const existingWords = await sheetsService.getUserWords(chatId);
            const isDuplicate = existingWords.some(word => 
                word.english.toLowerCase() === englishWord.toLowerCase()
            );
            
            if (isDuplicate) {
                showMainMenu(chatId, 
                    `❌ Слово "${englishWord}" уже есть в вашем словаре!\n\n` +
                    'Пожалуйста, введите другое слово:'
                );
                return;
            }
        }
        
        showMainMenu(chatId, '🔍 Ищу транскрипцию и произношение...');
        
        const result = await transcriptionService.getUKTranscription(englishWord);
        
        let audioId = null;
        if (result.audioUrl) {
            audioId = Date.now().toString();
        }
        
        userStates.set(chatId, {
            state: 'showing_transcription',
            tempWord: englishWord,
            tempTranscription: result.transcription,
            tempAudioUrl: result.audioUrl,
            tempAudioId: audioId
        });
        
        let message = `📝 Слово: ${englishWord}`;
        
        if (result.transcription) {
            message += `\n🔤 Транскрипция: ${result.transcription}`;
        } else {
            message += `\n❌ Транскрипция не найдена`;
        }
        
        if (result.audioUrl) {
            message += `\n\n🎵 Доступно аудио произношение`;
        }
        
        message += `\n\nВыберите действие:`;
        
        await bot.sendMessage(chatId, message, getListeningKeyboard(audioId));
        showMainMenu(chatId);
    }
    else if (userState?.state === 'waiting_translation') {
        const translation = text.trim();
        
        if (!translation) {
            showMainMenu(chatId, '❌ Перевод не может быть пустым. Введите перевод:');
            return;
        }
        
        // ✅ ПРОВЕРКА ПЕРЕД СОХРАНЕНИЕМ
        let success = true;
        if (sheetsService.initialized) {
            // Еще раз проверяем дубликат перед сохранением
            const existingWords = await sheetsService.getUserWords(chatId);
            const isDuplicate = existingWords.some(word => 
                word.english.toLowerCase() === userState.tempWord.toLowerCase()
            );
            
            if (isDuplicate) {
                showMainMenu(chatId, 
                    `❌ Слово "${userState.tempWord}" уже было добавлено в словарь!\n\n` +
                    'Пожалуйста, начните заново.'
                );
                userStates.delete(chatId);
                return;
            }
            
            success = await sheetsService.addWord(
                chatId, 
                userState.tempWord, 
                userState.tempTranscription,
                translation,
                userState.tempAudioUrl
            );
        }
        
        userStates.delete(chatId);
        
        if (success) {
            const transcriptionText = userState.tempTranscription ? ` [${userState.tempTranscription}]` : '';
            
            showMainMenu(chatId, 
                '✅ Слово добавлено в словарь!\n\n' +
                `💬 ${userState.tempWord}${transcriptionText} - ${translation}\n\n` +
                'Теперь оно будет доступно для повторения.'
            );
        } else {
            showMainMenu(chatId, 
                '❌ Ошибка сохранения\n\nНе удалось сохранить слово в словарь. Попробуйте еще раз.'
            );
        }
    }
    else {
        showMainMenu(chatId);
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

                addAudioToHistory(chatId, audioUrl, englishWord);
                const hasPrevious = hasPreviousAudios(chatId, audioUrl);
                
                await bot.sendAudio(chatId, audioUrl, {
                    caption: `🔊 Британское произношение: ${englishWord}`
                });

                if (hasPrevious) {
                    await bot.sendMessage(chatId,
                        '⚠️ Чтобы избежать автовоспроизведения старых аудио:\n\n' +
                        '📱 На Android:\n' +
                        '• Нажмите кнопку "Назад" после прослушивания\n' +
                        '• Или закройте плеер свайпом вниз\n\n' +
                        '📱 На iOS:\n' +
                        '• Свайпните плеер вниз\n' +
                        '• Или нажмите "Закрыть"\n\n' +
                        '💡 Это нужно сделать только если начали играть старые слова'
                    );
                }
                
                await bot.sendMessage(chatId, 
                    '🎵 Вы прослушали произношение. Хотите ввести перевод?',
                    getAfterAudioKeyboard()
                );
                
                showMainMenu(chatId);
                
            } catch (error) {
                console.error('Error sending audio:', error);
            }
        }
    }
    else if (data === 'enter_translation') {
        if (userState?.state === 'showing_transcription') {
            await bot.editMessageReplyMarkup(
                { inline_keyboard: [] },
                { chat_id: chatId, message_id: callbackQuery.message.message_id }
            );

            userStates.set(chatId, {
                ...userState,
                state: 'waiting_translation'
            });
            
            let translationMessage = '✏️ Введите перевод для слова:\n\n' +
                `🇬🇧 ${userState.tempWord}`;
            
            if (userState.tempTranscription) {
                translationMessage += `\n🔤 Транскрипция: ${userState.tempTranscription}`;
            }
            
            translationMessage += '\n\nНапишите перевод и отправьте сообщением';
            
            showMainMenu(chatId, translationMessage);
        }
    }
    else if (data === 'cancel_translation') {
        if (userState) {
            await bot.editMessageReplyMarkup(
                { inline_keyboard: [] },
                { chat_id: chatId, message_id: callbackQuery.message.message_id }
            );

            userStates.set(chatId, { ...userState, state: 'showing_transcription' });
            
            let message = `📝 Слово: ${userState.tempWord}`;
            
            if (userState.tempTranscription) {
                message += `\n🔤 Транскрипция: ${userState.tempTranscription}`;
            }
            
            message += '\n\n🎵 Доступно аудио произношение\n\nВыберите действие:';
            
            await bot.sendMessage(chatId, message, getListeningKeyboard(userState.tempAudioId));
            showMainMenu(chatId);
        }
    }
});

// Обработка ошибок
bot.on('error', (error) => {
    console.error('Bot error:', error);
});

bot.on('polling_error', (error) => {
    console.error('Polling error:', error);
});

console.log('🤖 Бот запущен с проверкой дубликатов');


