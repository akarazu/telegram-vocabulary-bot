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
function getAfterAudioKeyboard() {
    return {
        reply_markup: {
            inline_keyboard: [
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

    const userState = userStates.get(chatId);

    if (text === '➕ Добавить слово') {
        userStates.set(chatId, { state: 'waiting_english' });
        bot.sendMessage(chatId, '🇬🇧 Введите английское слово:');
    }
    else if (userState?.state === 'waiting_english') {
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
        }
        
        // СОХРАНЯЕМ ВСЕ ДАННЫЕ В СОСТОЯНИИ
        userStates.set(chatId, {
            state: 'showing_transcription',
            tempWord: englishWord,
            tempTranscription: result.transcription, // ← Сохраняем транскрипцию!
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
        // Пользователь вводит перевод
        const translation = text.trim();
        
        if (!translation) {
            bot.sendMessage(chatId, '❌ Перевод не может быть пустым. Введите перевод:');
            return;
        }
        
        // ИСПОЛЬЗУЕМ СОХРАНЕННУЮ ТРАНСКРИПЦИЮ ИЗ СОСТОЯНИЯ
        const success = await sheetsService.addWord(
            chatId, 
            userState.tempWord, 
            userState.tempTranscription, // ← Используем сохраненную транскрипцию!
            translation,
            userState.tempAudioUrl
        );
        
        // Очищаем состояние
        userStates.delete(chatId);
        
        if (success) {
            // ИСПОЛЬЗУЕМ ТУ ЖЕ ТРАНСКРИПЦИЮ ДЛЯ СООБЩЕНИЯ
            const transcriptionText = userState.tempTranscription ? ` [${userState.tempTranscription}]` : '';
            await bot.sendMessage(chatId, 
                `✅ Слово добавлено в словарь!\n\n` +
                `💬 <b>${userState.tempWord}</b>${transcriptionText} - ${translation}`,
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
});

// Обработка inline кнопок
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;
    const userState = userStates.get(chatId);

    // Всегда подтверждаем callback без текста
    await bot.answerCallbackQuery(callbackQuery.id);

    if (data.startsWith('audio_')) {
        const audioId = data.replace('audio_', '');
        const audioUrl = userState?.tempAudioUrl;
        
        if (audioUrl) {
            try {
                // Убираем кнопки из исходного сообщения
                await bot.editMessageReplyMarkup(
                    { inline_keyboard: [] },
                    {
                        chat_id: chatId,
                        message_id: callbackQuery.message.message_id
                    }
                );

                // Отправляем аудио сообщение
                await bot.sendAudio(chatId, audioUrl, {
                    caption: '🔊 Британское произношение'
                });
                
                // Отправляем сообщение с кнопками действий после аудио
                await bot.sendMessage(chatId, 
                    '🎵 Вы прослушали произношение. Что дальше?',
                    getAfterAudioKeyboard()
                );
                
            } catch (error) {
                console.error('Error sending audio:', error);
            }
        }
    }
    else if (data === 'enter_translation') {
        if (userState?.state === 'showing_transcription') {
            // Убираем кнопки из исходного сообщения
            await bot.editMessageReplyMarkup(
                { inline_keyboard: [] },
                {
                    chat_id: chatId,
                    message_id: callbackQuery.message.message_id
                }
            );

            // Переходим к вводу перевода - СОХРАНЯЕМ ВСЕ ДАННЫЕ
            userStates.set(chatId, {
                ...userState, // ← Важно: сохраняем все данные включая транскрипцию!
                state: 'waiting_translation'
            });
            
            // Отправляем новое сообщение с запросом перевода
            // ИСПОЛЬЗУЕМ СОХРАНЕННУЮ ТРАНСКРИПЦИЮ
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
    else if (data === 'back_to_word') {
        if (userState?.state === 'showing_transcription') {
            // Убираем кнопки из сообщения с действиями
            try {
                await bot.deleteMessage(chatId, callbackQuery.message.message_id);
            } catch (error) {
                // Если не удалось удалить, просто убираем кнопки
                await bot.editMessageReplyMarkup(
                    { inline_keyboard: [] },
                    {
                        chat_id: chatId,
                        message_id: callbackQuery.message.message_id
                    }
                );
            }

            // Возвращаемся к исходному сообщению со словом
            // ИСПОЛЬЗУЕМ СОХРАНЕННУЮ ТРАНСКРИПЦИЮ
            const message = `📝 Слово: <b>${userState.tempWord}</b>\n` +
                (userState.tempTranscription ? `🔤 Транскрипция: <code>${userState.tempTranscription}</code>\n\n` : '\n') +
                '🎵 Аудио произношение доступно\n\n' +
                'Выберите действие:';
            
            await bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
                ...getListeningKeyboard(userState.tempAudioId)
            });
        }
    }
    else if (data === 'cancel_translation') {
        // Отмена ввода перевода
        if (userState) {
            // Убираем кнопки из сообщения с запросом перевода
            await bot.editMessageReplyMarkup(
                { inline_keyboard: [] },
                {
                    chat_id: chatId,
                    message_id: callbackQuery.message.message_id
                }
            );

            // Возвращаемся к состоянию показа транскрипции
            // СОХРАНЯЕМ ВСЕ ДАННЫЕ
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

console.log('🤖 Бот запущен с исправленной транскрипцией');
