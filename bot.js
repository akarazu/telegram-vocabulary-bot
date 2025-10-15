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
    const keyboard = [];
    
    if (audioId) {
        keyboard.push([{ text: '🔊 Прослушать произношение', callback_data: `audio_${audioId}` }]);
    }
    
    keyboard.push([{ text: '➡️ Продолжить', callback_data: 'continue' }]);
    
    return {
        reply_markup: {
            inline_keyboard: keyboard
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

    if (text === '➕ Добавить слово') {
        userStates.set(chatId, { state: 'waiting_english' });
        bot.sendMessage(chatId, '🇬🇧 Введите английское слово:');
    }
    else {
        const userState = userStates.get(chatId);
        
        if (userState?.state === 'waiting_english') {
            const englishWord = text.trim();
            
            bot.sendMessage(chatId, '🔍 Ищу транскрипцию и произношение...');
            
            const result = await transcriptionService.getUKTranscription(englishWord);
            
            // Сохраняем audioUrl во временное хранилище
            let audioId = null;
            if (result.audioUrl) {
                audioId = Date.now().toString(); // Простой ID на основе времени
                audioUrlStorage.set(audioId, result.audioUrl);
                
                // Очищаем старые записи через 5 минут
                setTimeout(() => {
                    audioUrlStorage.delete(audioId);
                }, 5 * 60 * 1000);
            }
            
            userStates.set(chatId, {
                state: 'showing_transcription',
                tempWord: englishWord,
                tempTranscription: result.transcription,
                tempAudioUrl: result.audioUrl,
                tempAudioId: audioId
            });
            
            let message = `Слово: <b>${englishWord}</b>`;
            
            if (result.transcription) {
                message += `\n🔤 Транскрипция: <code>${result.transcription}</code>`;
            } else {
                message += `\n❌ Транскрипция не найдена`;
            }
            
            if (result.audioUrl) {
                message += `\n\n🎵 Доступно аудио произношение`;
            }
            
            message += `\n\nВведите перевод:`;
            
            bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
                ...getListeningKeyboard(audioId)
            });
        }
        else if (userState?.state === 'waiting_translation') {
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
                bot.sendMessage(chatId, 
                    `✅ Слово добавлено!\n\n` +
                    `💬 ${userState.tempWord}${transcriptionText} - ${text}`,
                    getMainMenu()
                );
            } else {
                bot.sendMessage(chatId, '❌ Ошибка сохранения', getMainMenu());
            }
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
    else if (data === 'continue') {
        if (userState?.state === 'showing_transcription') {
            // Переходим к вводу перевода
            userStates.set(chatId, {
                ...userState,
                state: 'waiting_translation'
            });
            
            await bot.editMessageText(
                `Слово: <b>${userState.tempWord}</b>\n` +
                (userState.tempTranscription ? `Транскрипция: <code>${userState.tempTranscription}</code>\n\n` : '\n') +
                'Введите перевод:',
                {
                    chat_id: chatId,
                    message_id: callbackQuery.message.message_id,
                    parse_mode: 'HTML'
                }
            );
            
            await bot.answerCallbackQuery(callbackQuery.id);
        }
    }
});

console.log('🤖 Бот запущен с прослушиванием произношения');
