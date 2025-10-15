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

// Хранилище для отслеживания воспроизведения аудио по словам
const audioPlaybackTracker = new Map();

// Таймеры для управления задержками между аудио
const audioCooldowns = new Map();

// Главное меню
function getMainMenu() {
    return {
        reply_markup: {
            keyboard: [
                ['➕ Добавить слово']
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

// Клавиатура действий после прослушивания (без кнопки "Вернуться к слову")
function getAfterAudioKeyboard() {
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: '✏️ Ввести перевод', callback_data: 'enter_translation' }]
            ]
        }
    };
}

// Функция для проверки и отметки воспроизведения аудио
function canPlayAudio(englishWord, chatId) {
    const key = `${chatId}_${englishWord.toLowerCase()}`;
    
    if (audioPlaybackTracker.has(key)) {
        return false;
    }
    
    audioPlaybackTracker.set(key, true);
    setTimeout(() => {
        audioPlaybackTracker.delete(key);
    }, 30000);
    
    return true;
}

// Функция для проверки кулдауна между аудио
function canSendAudio(chatId) {
    const lastAudioTime = audioCooldowns.get(chatId);
    if (!lastAudioTime) return true;
    
    const timeSinceLastAudio = Date.now() - lastAudioTime;
    return timeSinceLastAudio > 5000; // 5 секунд между аудио
}

// Функция для отправки аудио с защитой от автовоспроизведения
async function sendAudioSafe(chatId, audioUrl, englishWord) {
    try {
        // Устанавливаем кулдаун для этого чата
        audioCooldowns.set(chatId, Date.now());
        
        // 1. Отправляем сообщение-разделитель ПЕРЕД аудио
        await bot.sendMessage(chatId, `🔊 Произношение слова: "${englishWord}"`, {
            reply_markup: {
                inline_keyboard: [[
                    { text: '⏸️ Пауза между аудио', callback_data: 'audio_divider' }
                ]]
            }
        });

        // 2. Ждем немного чтобы разорвать медиагруппу
        await new Promise(resolve => setTimeout(resolve, 500));

        // 3. Отправляем аудио
        await bot.sendAudio(chatId, audioUrl, {
            caption: '🎧 Нажмите для прослушивания',
            title: englishWord,
            performer: 'Британское произношение'
        });

        // 4. Ждем еще немного
        await new Promise(resolve => setTimeout(resolve, 500));

        // 5. Отправляем сообщение-разделитель ПОСЛЕ аудио
        await bot.sendMessage(chatId, '────────────', {
            reply_markup: {
                inline_keyboard: [[
                    { text: '✅ Аудио завершено', callback_data: 'audio_complete' }
                ]]
            }
        });

        return true;
    } catch (error) {
        console.error('Error sending safe audio:', error);
        // Сбрасываем кулдаун при ошибке
        audioCooldowns.delete(chatId);
        return false;
    }
}

// Команда /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, 
        '📚 Англо-русский словарь\n' +
        '🔤 С транскрипцией и произношением\n' +
        '🇬🇧 Британский вариант',
        getMainMenu()
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
        bot.sendMessage(chatId, '🇬🇧 Введите английское слово:');
    }
    else if (userState?.state === 'waiting_english') {
        const englishWord = text.trim();
        
        if (!/^[a-zA-Z\s\-']+$/.test(englishWord)) {
            bot.sendMessage(chatId, 
                '❌ Это не похоже на английское слово.\n' +
                'Пожалуйста, введите слово на английском:'
            );
            return;
        }
        
        bot.sendMessage(chatId, '🔍 Ищу транскрипцию и произношение...');
        
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
        
        await bot.sendMessage(chatId, message, {
            parse_mode: 'HTML',
            ...getListeningKeyboard(audioId)
        });
    }
    else if (userState?.state === 'waiting_translation') {
        const translation = text.trim();
        
        if (!translation) {
            bot.sendMessage(chatId, '❌ Перевод не может быть пустым. Введите перевод:');
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
            
            await bot.sendMessage(chatId, 
                `✅ <b>Слово добавлено в словарь!</b>\n\n` +
                `💬 ${userState.tempWord}${transcriptionText} - <b>${translation}</b>\n\n` +
                `Теперь оно будет доступно для повторения.`,
                { 
                    parse_mode: 'HTML',
                    ...getMainMenu() 
                }
            );
        } else {
            await bot.sendMessage(chatId, 
                '❌ <b>Ошибка сохранения</b>\n\nНе удалось сохранить слово в словарь. Попробуйте еще раз.',
                { 
                    parse_mode: 'HTML',
                    ...getMainMenu() 
                }
            );
        }
    }
    else {
        await bot.sendMessage(chatId, 'Выберите действие:', getMainMenu());
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
            // Проверяем кулдаун между аудио
            if (!canSendAudio(chatId)) {
                await bot.answerCallbackQuery(callbackQuery.id, {
                    text: '⏳ Пожалуйста, подождите 5 секунд перед следующим аудио',
                    show_alert: true
                });
                return;
            }
            
            if (!canPlayAudio(englishWord, chatId)) {
                await bot.answerCallbackQuery(callbackQuery.id, {
                    text: '🔇 Аудио уже было воспроизведено. Можно повторить через 30 секунд.',
                    show_alert: true
                });
                return;
            }
            
            try {
                // Убираем кнопки из исходного сообщения
                await bot.editMessageReplyMarkup(
                    { inline_keyboard: [] },
                    {
                        chat_id: chatId,
                        message_id: callbackQuery.message.message_id
                    }
                );

                // Используем безопасную отправку аудио
                const success = await sendAudioSafe(chatId, audioUrl, englishWord);
                
                if (success) {
                    // Ждем немного перед отправкой следующего сообщения
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
                    await bot.sendMessage(chatId, 
                        '🎵 Произношение отправлено. Хотите ввести перевод?',
                        getAfterAudioKeyboard()
                    );
                }
                
            } catch (error) {
                console.error('Error in audio playback:', error);
                const key = `${chatId}_${englishWord.toLowerCase()}`;
                audioPlaybackTracker.delete(key);
                audioCooldowns.delete(chatId);
            }
        }
    }
    else if (data === 'audio_divider' || data === 'audio_complete') {
        // Просто подтверждаем нажатие на разделители
        await bot.answerCallbackQuery(callbackQuery.id, {
            text: '🎧 Аудио готово к прослушиванию',
            show_alert: false
        });
    }
    else if (data === 'enter_translation') {
        if (userState?.state === 'showing_transcription') {
            await bot.editMessageReplyMarkup(
                { inline_keyboard: [] },
                {
                    chat_id: chatId,
                    message_id: callbackQuery.message.message_id
                }
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
            
            await bot.sendMessage(chatId, translationMessage, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔙 Отменить', callback_data: 'cancel_translation' }]
                    ]
                }
            });
        }
    }
    else if (data === 'cancel_translation') {
        if (userState) {
            await bot.editMessageReplyMarkup(
                { inline_keyboard: [] },
                {
                    chat_id: chatId,
                    message_id: callbackQuery.message.message_id
                }
            );

            userStates.set(chatId, {
                ...userState,
                state: 'showing_transcription'
            });
            
            const message = `📝 Слово: <b>${userState.tempWord}</b>\n` +
                (userState.tempTranscription ? `🔤 Транскрипция: <code>${userState.tempTranscription}</code>\n\n` : '\n') +
                '🎵 Доступно аудио произношение\n\n' +
                'Выберите действие:';
            
            await bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
                ...getListeningKeyboard(userState.tempAudioId)
            });
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

console.log('🤖 Бот запущен с улучшенной защитой от автовоспроизведения аудио');
