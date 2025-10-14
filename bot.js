import TelegramBot from 'node-telegram-bot-api';
import { GoogleSheetsService } from './services/google-sheets.js';

const bot = new TelegramBot(process.env.BOT_TOKEN, { 
    polling: true 
});

console.log('🔧 Initializing Google Sheets service...');
const sheetsService = new GoogleSheetsService();

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
    bot.sendMessage(chatId, '📚 Словарь с Google Таблицами', getMainMenu());
});

// Обработка сообщений
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (text === '➕ Добавить слово') {
        userStates.set(chatId, { state: 'waiting_word' });
        bot.sendMessage(chatId, 'Введите слово на английском:');
    }
    else {
        const userState = userStates.get(chatId);
        if (userState?.state === 'waiting_word') {
            userStates.set(chatId, {
                state: 'waiting_translation',
                tempWord: text
            });
            bot.sendMessage(chatId, 'Введите перевод на русский:');
        }
        else if (userState?.state === 'waiting_translation') {
            console.log(`🔄 Processing word: ${userState.tempWord} -> ${text}`);
            
            const success = await sheetsService.addWord(chatId, userState.tempWord, text);
            userStates.delete(chatId);
            
            if (success) {
                bot.sendMessage(chatId, '✅ Слово добавлено в таблицу!', getMainMenu());
            } else {
                bot.sendMessage(chatId, '❌ Ошибка сохранения. Проверьте логи.', getMainMenu());
            }
        }
    }
});

console.log('🤖 Бот запущен');
