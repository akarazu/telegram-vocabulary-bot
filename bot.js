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

// Хранилище для audio URLs (временное)
const audioUrlStorage = new Map();

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

// Клавиатура действий после прослушивания
function getAfterAudioKeyboard(audioId) {
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: '🔊 Прослушать еще раз', callback_data: `audio_${audioId}` }],
                [{ text: '✏️ Ввести перевод', callback_data: 'enter_translation' }],
                [{ text: '🔙 Вернуться к слову', callback_data: 'back_to_word' }]
            ]
        }
    };
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

    // Игнорируем команды
    if (text.startsWith('/')) return;

    if (text === '➕ Добавить слово') {
        userStates.set(chatId, { state: 'waiting_english' });
        bot.sendMessage(chatId, '🇬🇧 Введите английское слово:');
    }
    else {
        const userState = userStates.get(chatId);
        
        if (userState?.state === 'waiting_english') {
            const englishWord = text.trim();
            
            // Проверяем что это английское слово
            if (!/^[a-zA-Z\s\-']+$/.test(englishWord)) {
                bot.sendMessage(chatId, 
                    '❌ Это не похоже на английское слово.\n' +
                    'Пожалуйста, введите слово на английском:'
                );
                return;
            }
            
            bot.sendMessage(chatId, '🔍 Ищу транскрипцию и произношение...');
            
            const result = await transcriptionService.getUKTranscription(englishWord);
            
            // Сохраняем audioUrl во временное хранилище
            let audioId = null;
            if (result.audioUrl) {
                audioId = Date.now().toString();
                audioUrlStorage.set(audioId, result.audioUrl);
                
                // Очищаем старые записи через 10 минут
                setTimeout(() => {
                    audioUrlStorage.delete(audioId);
                }, 10 * 60 * 1000);
            }
            
            userStates.set(chatId, {
                state: 'showing_transcription',
                tempWord: englishWord,
                tempTranscription: result.transcription,
                tempAudioUrl: result.audioUrl,
                tempAudioId: audioId,
                originalMessageId: msg.message_id + 2 // ID сообщения с кнопками
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
            
            const sentMessage = await bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
                ...getListeningKeyboard(audioId)
            });
            
            // Сохраняем ID сообщения с кнопками
            userStates.set(chatId, {
                ...userStates.get(chatId),
                controlsMessageId: sentMessage.message_id
            });
        }
        else if (userState?.state === 'waiting_translation') {
            // Пользователь вводит перевод
            const success = await sheetsService.addWord(
                chatId, 
                userState.tempWord, 
                userState.tempTranscription, 
                text.trim(),
                userState.tempAudioUrl
            );
            
            // Очищаем временное хранилище
            if (userState.tempAudioId) {
                audioUrlStorage.delete(userState.tempAudioId);
            }
            userStates.delete(chatId);
            
            if (success) {
                const transcriptionText = userState.tempTranscription ? ` [${userState.tempTranscription}]` : '';
                await bot.sendMessage(chatId, 
                    `✅ Слово добавлено в словарь!\n\n` +
                    `💬 <b>${userState.tempWord}</b>${transcriptionText} - ${text}`,
                    { 
                        parse_mode: 'HTML',
                        ...getMainMenu() 
                    }
                );
            } else {
                await bot.sendMessage(chatId, '❌ Ошибка сохранения', getMainMenu());
            }
        }
        else if (!userState) {
            // Если нет активного состояния, показываем главное меню
            await bot.sendMessage(chatId, 'Выберите действие:', getMainMenu());
        }
    }
});

// Обработка inline кнопок
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;
    const userState = userStates.get(chatId);

    if (data.startsWith('audio_')) {
        const audioId = data.replace('audio_', '');
        const audioUrl = audioUrlStorage.get(audioId);
        
        if (audioUrl) {
            try {
                // Отправляем аудио сообщение
                await bot.sendAudio(chatId, audioUrl, {
                    caption: '🔊 Британское произношение'
                });
                
                // Отправляем сообщение с кнопками действий после аудио
                await bot.sendMessage(chatId, 
                    '🎵 Вы прослушали произношение. Что дальше?',
                    getAfterAudioKeyboard(audioId)
                );
                
                // Подтверждаем нажатие кнопки
                await bot.answerCallbackQuery(callbackQuery.id, {
                    text: 'Аудио отправлено'
                });
                
            } catch (error) {
                console.error('Error sending audio:', error);
                await bot.answerCallbackQuery(callbackQuery.id, {
                    text: 'Ошибка отправки аудио'
                });
            }
        } else {
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: 'Аудио больше не доступно'
            });
        }
    }
    else if (data === 'enter_translation') {
        if (userState?.state === 'showing_transcription') {
            // Переходим к вводу перевода
            userStates.set(chatId, {
                ...userState,
                state: 'waiting_translation'
            });
            
            // Редактируем сообщение с кнопками
            await bot.editMessageText(
                `✏️ <b>Введите перевод</b>\n\n` +
                `Слово: <b>${userState.tempWord}</b>\n` +
                (userState.tempTranscription ? `Транскрипция: <code>${userState.tempTranscription}</code>\n\n` : '\n') +
                'Напишите перевод сообщением:',
                {
                    chat_id: chatId,
                    message_id: userState.controlsMessageId || callbackQuery.message.message_id,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔙 Отменить добавление', callback_data: 'cancel' }]
                        ]
                    }
                }
            );
            
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: 'Теперь введите перевод'
            });
        }
    }
    else if (data === 'back_to_word') {
        if (userState?.state === 'showing_transcription') {
            // Возвращаемся к исходному сообщению со словом
            const message = `📝 Слово: <b>${userState.tempWord}</b>\n` +
                (userState.tempTranscription ? `🔤 Транскрипция: <code>${userState.tempTranscription}</code>\n\n` : '\n') +
                '🎵 Доступно аудио произношение\n\n' +
                'Выберите действие:';
            
            await bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
                ...getListeningKeyboard(userState.tempAudioId)
            });
            
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: 'Возврат к слову'
            });
        }
    }
    else if (data === 'cancel') {
        // Отмена добавления слова
        if (userState?.tempAudioId) {
            audioUrlStorage.delete(userState.tempAudioId);
        }
        userStates.delete(chatId);
        
        await bot.editMessageText(
            '❌ Добавление слова отменено',
            {
                chat_id: chatId,
                message_id: callbackQuery.message.message_id
            }
        );
        
        await bot.sendMessage(chatId, 'Выберите действие:', getMainMenu());
        await bot.answerCallbackQuery(callbackQuery.id);
    }
});

// Обработка ошибок
bot.on('error', (error) => {
    console.error('Bot error:', error);
});

bot.on('polling_error', (error) => {
    console.error('Polling error:', error);
});

console.log('🤖 Бот запущен с улучшенным интерфейсом прослушивания');
