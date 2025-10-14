import TelegramBot from 'node-telegram-bot-api';
import { GoogleSheetsService } from './services/google-sheets.js';

const bot = new TelegramBot(process.env.BOT_TOKEN, { 
    polling: true 
});

const sheetsService = new GoogleSheetsService();
const userStates = new Map();

// Главное меню
function getMainMenu() {
    return {
        reply_markup: {
            keyboard: [
                ['➕ Добавить слово'],
                ['📝 Мои слова']
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
        bot.sendMessage(chatId, 'Введите слово:');
    }
    else if (text === '📝 Мои слова') {
        const words = await sheetsService.getUserWords(chatId);
        let message = 'Ваши слова:\n\n';
        words.forEach((word, index) => {
            message += `${index + 1}. ${word.word} - ${word.translation}\n`;
        });
        bot.sendMessage(chatId, message || 'Слов нет', getMainMenu());
    }
    else {
        const userState = userStates.get(chatId);
        if (userState?.state === 'waiting_word') {
            userStates.set(chatId, {
                state: 'waiting_translation',
                tempWord: text
            });
            bot.sendMessage(chatId, 'Введите перевод:');
        }
        else if (userState?.state === 'waiting_translation') {
            const success = await sheetsService.addWord(chatId, userState.tempWord, text);
            userStates.delete(chatId);
            
            if (success) {
                bot.sendMessage(chatId, '✅ Слово добавлено!', getMainMenu());
            } else {
                bot.sendMessage(chatId, '❌ Ошибка сохранения', getMainMenu());
            }
        }
    }
});

console.log('🤖 Бот запущен с Google Таблицами');
