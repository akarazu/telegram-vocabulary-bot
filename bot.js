import TelegramBot from 'node-telegram-bot-api';
import { GoogleSheetsService } from './services/google-sheets.js';
import { TranscriptionService } from './services/transcription-service.js';

const bot = new TelegramBot(process.env.BOT_TOKEN, { 
    polling: true 
});

const sheetsService = new GoogleSheetsService();
const transcriptionService = new TranscriptionService();
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

// Команда /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, 
        '📚 Англо-русский словарь\n' +
        '🔤 С автоматической транскрипцией',
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
            
            bot.sendMessage(chatId, '🔍 Ищу транскрипцию...');
            
            const transcription = await transcriptionService.getUKTranscription(englishWord);
            
            userStates.set(chatId, {
                state: 'waiting_translation',
                tempWord: englishWord,
                tempTranscription: transcription
            });
            
            const transcriptionText = transcription ? `\n🔤 Транскрипция: ${transcription}` : '\n❌ Транскрипция не найдена';
            bot.sendMessage(chatId, `Слово: ${englishWord}${transcriptionText}\n\nВведите перевод:`);
        }
        else if (userState?.state === 'waiting_translation') {
            const success = await sheetsService.addWord(
                chatId, 
                userState.tempWord, 
                userState.tempTranscription, 
                text.trim()
            );
            
            userStates.delete(chatId);
            
            if (success) {
                const transcriptionText = userState.tempTranscription ? ` [${userState.tempTranscription}]` : '';
                bot.sendMessage(chatId, 
                    `✅ Слово добавлено в Google Таблицы!\n\n` +
                    `💬 ${userState.tempWord}${transcriptionText} - ${text}`,
                    getMainMenu()
                );
            } else {
                bot.sendMessage(chatId, '❌ Ошибка сохранения', getMainMenu());
            }
        }
    }
});

console.log('🤖 Бот запущен с Free Dictionary API');
