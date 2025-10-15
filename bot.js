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

// Главное меню (Reply Keyboard - всегда видно)
function getMainMenu() {
    return {
        reply_markup: {
            keyboard: [
                ['➕ Добавить слово']
            ],
            resize_keyboard: true,
            one_time_keyboard: false // ✅ Важно: клавиатура не скрывается после использования
        }
    };
}

// Клавиатура с кнопкой прослушивания (Inline Keyboard)
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

// Клавиатура действий после прослушивания (Inline Keyboard)
function getAfterAudioKeyboard() {
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: '✏️ Ввести перевод', callback_data: 'enter_translation' }]
            ]
        }
    };
}

// Функция для отправки сообщения с всегда видимым меню
function sendWithMenu(chatId, text, extra = {}) {
    return bot.sendMessage(chatId, text, {
        ...getMainMenu(),
        ...extra
    });
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
    sendWithMenu(chatId, 
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

    if (text === '➕ Добавить слово') {
        userStates.set(chatId, { state: 'waiting_english' });
        sendWithMenu(chatId, '🇬🇧 Введите английское слово:');
    }
    else if (userState?.state === 'waiting_english') {
        const englishWord = text.trim();
        
        if (!/^[a-zA-Z\s\-']+$/.test(englishWord)) {
            sendWithMenu(chatId, 
                '❌ Это не похоже на английское слово.\n' +
                'Пожалуйста, введите слово на английском:'
            );
            return;
        }
        
        sendWithMenu(chatId, '🔍 Ищу транскрипцию и произношение...');
        
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
        
        let message = `📝 Слово: <b>${englishWord}</b>`;
        
        if (result.transcription) {
            message += `\n🔤 Транскрипция: <code>${result.transcription}</code>`;
        } else {
            message += `\n❌ Транскрипция не найдена`;
        }
        
        if (result.audioUrl) {
            message += `\n\n🎵 Доступно аудио произношение`;
        }
        
        message += `\n\nВыберите действие:`;
        
        // Для сообщения с inline кнопками не показываем меню
        await bot.sendMessage(chatId, message, {
            parse_mode: 'HTML',
            ...getListeningKeyboard(audioId)
        });
        
        // Но сразу после показываем меню
        sendWithMenu(chatId, 'Используйте кнопки выше или:');
    }
    else if (userState?.state === 'waiting_translation') {
        const translation = text.trim();
        
        if (!translation) {
            sendWithMenu(chatId, '❌ Перевод не может быть пустым. Введите перевод:');
            return;
        }
        
        const success = await sheetsService.addWord(
            chatId, 
            userState.tempWord, 
            userState.tempTranscription,
            translation,
            userState.tempAudioUrl
        );
        
        userStates.delete(chatId);
        
        if (success) {
            const transcriptionText = userState.tempTranscription ? ` [${userState.tempTranscription}]` : '';
            
            await sendWithMenu(chatId, 
                `✅ <b>Слово добавлено в словарь!</b>\n\n` +
                `💬 ${userState.tempWord}${transcriptionText} - <b>${translation}</b>\n\n` +
                `Теперь оно будет доступно для повторения.`,
                { parse_mode: 'HTML' }
            );
        } else {
            await sendWithMenu(chatId, 
                '❌ <b>Ошибка сохранения</b>\n\nНе удалось сохранить слово в словарь. Попробуйте еще раз.',
                { parse_mode: 'HTML' }
            );
        }
    }
    else {
        sendWithMenu(chatId, 'Выберите действие:');
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
                        '⚠️ **Чтобы избежать автовоспроизведения старых аудио:**\n\n' +
                        '📱 **На Android:**\n' +
                        '• Нажмите кнопку "Назад" после прослушивания\n' +
                        '• Или закройте плеер свайпом вниз\n\n' +
                        '📱 **На iOS:**\n' +
                        '• Свайпните плеер вниз\n' +
                        '• Или нажмите "Закрыть"\n\n' +
                        '💡 *Это нужно сделать только если начали играть старые слова*',
                        { parse_mode: 'Markdown' }
                    );
                }
                
                await bot.sendMessage(chatId, 
                    '🎵 Вы прослушали произношение. Хотите ввести перевод?',
                    getAfterAudioKeyboard()
                );
                
                // Всегда показываем меню после действий
                sendWithMenu(chatId, 'Или используйте:');
                
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
            
            let translationMessage = `✏️ <b>Введите перевод для слова:</b>\n\n` +
                `🇬🇧 <b>${userState.tempWord}</b>`;
            
            if (userState.tempTranscription) {
                translationMessage += `\n🔤 Транскрипция: <code>${userState.tempTranscription}</code>`;
            }
            
            translationMessage += `\n\n📝 <i>Напишите перевод и отправьте сообщением</i>`;
            
            sendWithMenu(chatId, translationMessage, { parse_mode: 'HTML' });
        }
    }
    else if (data === 'cancel_translation') {
        if (userState) {
            await bot.editMessageReplyMarkup(
                { inline_keyboard: [] },
                { chat_id: chatId, message_id: callbackQuery.message.message_id }
            );

            userStates.set(chatId, { ...userState, state: 'showing_transcription' });
            
            const message = `📝 Слово: <b>${userState.tempWord}</b>\n` +
                (userState.tempTranscription ? `🔤 Транскрипция: <code>${userState.tempTranscription}</code>\n\n` : '\n') +
                '🎵 Доступно аудио произношение\n\n' +
                'Выберите действие:';
            
            await bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
                ...getListeningKeyboard(userState.tempAudioId)
            });
            
            sendWithMenu(chatId, 'Или используйте:');
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

console.log('🤖 Бот запущен с всегда видимым меню');
