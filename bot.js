import TelegramBot from 'node-telegram-bot-api';
import { GoogleSheetsService } from './services/google-sheets.js';
import { YandexDictionaryService } from './services/yandex-dictionary-service.js';
import { CambridgeDictionaryService } from './services/cambridge-dictionary-service.js';

const bot = new TelegramBot(process.env.BOT_TOKEN, { 
    polling: true 
});

// Инициализация сервисов с обработкой ошибок
let sheetsService, yandexService, cambridgeService;

try {
    sheetsService = new GoogleSheetsService();
    yandexService = new YandexDictionaryService();
    cambridgeService = new CambridgeDictionaryService();
    console.log('✅ Все сервисы успешно инициализированы');
} catch (error) {
    console.error('❌ Ошибка инициализации сервисов:', error);
    sheetsService = { initialized: false };
    yandexService = { getTranscriptionAndAudio: () => ({ transcription: '', audioUrl: '' }) };
    cambridgeService = { getWordData: () => ({ meanings: [] }) };
}

// Хранилище состояний пользователей
const userStates = new Map();

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
                [{ text: '➡️ Выбрать перевод', callback_data: 'enter_translation' }]
            ]
        }
    };
}

// Клавиатура для ввода примера с кнопкой "Пропустить"
function getExampleInputKeyboard() {
    return {
        reply_markup: {
            keyboard: [
                ['⏭️ Пропустить'],
                ['➕ Добавить новое слово']
            ],
            resize_keyboard: true
        }
    };
}

// Клавиатура для выбора переводов
function getTranslationSelectionKeyboard(translations, meanings, selectedIndices = []) {
    const translationButtons = [];

    translations.forEach((translation, index) => {
        const isSelected = selectedIndices.includes(index);
        const emoji = isSelected ? '✅' : '🔘';
        
        const meaning = meanings.find(m => m.translation === translation);
        const englishDefinition = meaning?.englishDefinition || '';
        
        // Создаем кнопки для перевода и подробностей
        const row = [
            { 
                text: `${emoji} ${translation}`, 
                callback_data: `toggle_translation_${index}` 
            },
            { 
                text: '🔍 Подробнее', 
                callback_data: `details_${index}` 
            }
        ];
        
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
        { text: '✏️ Добавить свой перевод', callback_data: 'custom_translation' },
        { text: '🔙 Отменить', callback_data: 'cancel_translation' }
    ]);

    return {
        reply_markup: {
            inline_keyboard: [
                ...translationButtons,
                ...actionButtons
            ]
        }
    };
}

// Функция для принудительного показа меню
async function showMainMenu(chatId, text = '') {
    if (text && text.trim() !== '') {
        return await bot.sendMessage(chatId, text, getMainMenu());
    } else {
        return await bot.sendMessage(chatId, 'Выберите действие:', getMainMenu());
    }
}

// ✅ НОВАЯ ФУНКЦИЯ: Сохранение с JSON структурой
async function saveWordWithMeanings(chatId, userState, selectedTranslations) {
    console.log(`💾 Saving word with meanings:`, {
        word: userState.tempWord,
        selectedTranslations: selectedTranslations
    });
    
    let success = true;
    
    if (sheetsService.initialized) {
        // Проверяем дубликаты - теперь по английскому слову
        try {
            const existingWords = await sheetsService.getUserWords(chatId);
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
        } catch (error) {
            console.error('❌ Error checking duplicates:', error);
        }
        
        // ✅ СОЗДАЕМ МАССИВ ЗНАЧЕНИЙ ДЛЯ JSON
        const meaningsData = [];
        
        selectedTranslations.forEach(translation => {
            // Находим соответствующие значения из Cambridge Dictionary
            const cambridgeMeanings = userState.meanings.filter(
                meaning => meaning.translation === translation
            );
            
            // Для пользовательских переводов создаем пустые значения
            if (cambridgeMeanings.length === 0) {
                meaningsData.push({
                    translation: translation,
                    example: '', // Пользователь может добавить позже
                    partOfSpeech: '',
                    definition: ''
                });
            } else {
                // Для переводов из Cambridge добавляем все данные
                cambridgeMeanings.forEach(meaning => {
                    meaningsData.push({
                        translation: translation,
                        example: meaning.examples && meaning.examples.length > 0 
                            ? meaning.examples[0].english 
                            : '',
                        partOfSpeech: meaning.partOfSpeech || '',
                        definition: meaning.englishDefinition || ''
                    });
                });
            }
        });
        
        console.log(`📝 Meanings data for JSON:`, meaningsData);
        
        // ✅ СОХРАНЯЕМ В НОВОМ ФОРМАТЕ
        success = await sheetsService.addWordWithMeanings(
            chatId, 
            userState.tempWord, 
            userState.tempTranscription,
            userState.tempAudioUrl,
            meaningsData  // Передаем массив значений
        );
    }
    
    // Очищаем состояние пользователя
    userStates.delete(chatId);
    
    if (success) {
        const transcriptionText = userState.tempTranscription ? ` [${userState.tempTranscription}]` : '';
        
        let successMessage = '✅ Слово добавлено в словарь!\n\n' +
            `💬 **${userState.tempWord}**${transcriptionText}\n\n` +
            '**Добавленные значения:**\n';
        
        selectedTranslations.forEach((translation, index) => {
            successMessage += `\n${index + 1}. ${translation}`;
        });
        
        successMessage += '\n\n📚 Теперь вы можете повторять слово целиком с разными значениями!';
        
        await showMainMenu(chatId, successMessage);
    } else {
        await showMainMenu(chatId, 
            '❌ Ошибка сохранения\n\nНе удалось сохранить слово в словарь. Попробуйте еще раз.'
        );
    }
}

// Команда /start
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    await showMainMenu(chatId, 
        '📚 Англо-русский словарь\n' +
        '🔤 С транскрипцией и произношением\n' +
        '🇬🇧 Британский вариант\n' +
        '📝 Каждое слово хранится с несколькими значениями\n' +
        '🔄 Интервальное повторение слов целиком'
    );
});

// Обработка сообщений (основная логика остается прежней)
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text || text.startsWith('/')) {
        return;
    }

    const userState = userStates.get(chatId);

    if (text === '➕ Добавить новое слово') {
        userStates.set(chatId, { state: 'waiting_english' });
        await showMainMenu(chatId, '🇬🇧 Введите английское слово:');
    }
    else if (userState?.state === 'waiting_english') {
        // ... (логика поиска слова остается прежней)
        // После получения данных переходим к выбору переводов
    }
    else if (userState?.state === 'waiting_custom_translation') {
        const customTranslation = text.trim();
        
        if (!customTranslation) {
            await showMainMenu(chatId, '❌ Перевод не может быть пустым. Введите перевод:');
            return;
        }
        
        userStates.set(chatId, {
            ...userState,
            state: 'waiting_custom_example',
            customTranslation: customTranslation
        });
        
        await bot.sendMessage(chatId, 
            `✅ Вы ввели перевод: "${customTranslation}"\n\n` +
            `📝 Теперь вы можете добавить пример использования (необязательно):\n\n` +
            `💡 Просто отправьте пример предложения с этим словом\n` +
            `⏭️ Или нажмите "Пропустить" чтобы перейти к выбору переводов`,
            getExampleInputKeyboard()
        );
    }
    else if (userState?.state === 'waiting_custom_example') {
        if (text === '⏭️ Пропустить' || text === '➕ Добавить новое слово') {
            // Пропускаем ввод примера
            await processCustomTranslationWithoutExample(chatId, userState);
            return;
        }
        
        const example = text.trim();
        await processCustomTranslationWithExample(chatId, userState, example);
    }
    else {
        await showMainMenu(chatId, 'Выберите действие из меню:');
    }
});

// Вспомогательная функция для обработки пользовательского перевода без примера
async function processCustomTranslationWithoutExample(chatId, userState) {
    const newTranslations = [userState.customTranslation, ...userState.tempTranslations];
    
    const newMeaning = {
        translation: userState.customTranslation,
        englishDefinition: '',
        examples: []
    };
    
    const newMeanings = [newMeaning, ...userState.meanings];
    
    userStates.set(chatId, {
        ...userState,
        state: 'choosing_translation',
        tempTranslations: newTranslations,
        meanings: newMeanings,
        selectedTranslationIndices: [0]
    });
    
    const successMessage = `✅ Ваш перевод "${userState.customTranslation}" добавлен!\n\n` +
                          `🎯 Теперь выберите переводы которые хотите сохранить:\n` +
                          `✅ Ваш перевод отмечен как выбранный`;
    
    await bot.sendMessage(chatId, successMessage, 
        getTranslationSelectionKeyboard(newTranslations, newMeanings, [0])
    );
    
    await showMainMenu(chatId);
}

// Вспомогательная функция для обработки пользовательского перевода с примером
async function processCustomTranslationWithExample(chatId, userState, example) {
    const newTranslations = [userState.customTranslation, ...userState.tempTranslations];
    
    const newMeaning = {
        translation: userState.customTranslation,
        englishDefinition: '',
        examples: example ? [{ english: example, russian: '' }] : []
    };
    
    const newMeanings = [newMeaning, ...userState.meanings];
    
    userStates.set(chatId, {
        ...userState,
        state: 'choosing_translation',
        tempTranslations: newTranslations,
        meanings: newMeanings,
        selectedTranslationIndices: [0]
    });
    
    let successMessage = `✅ Ваш перевод "${userState.customTranslation}" добавлен!\n\n`;
    
    if (example) {
        successMessage += `📝 Пример: ${example}\n\n`;
    }
    
    successMessage += `🎯 Теперь выберите переводы которые хотите сохранить:\n` +
                     `✅ Ваш перевод отмечен как выбранный`;
    
    await bot.sendMessage(chatId, successMessage, 
        getTranslationSelectionKeyboard(newTranslations, newMeanings, [0])
    );
    
    await showMainMenu(chatId);
}

// Обработка inline кнопок
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;
    const userState = userStates.get(chatId);

    await bot.answerCallbackQuery(callbackQuery.id);

    // ... (остальная логика обработки кнопок остается прежней)

    else if (data === 'save_selected_translations') {
        if (userState?.state === 'choosing_translation' && userState.selectedTranslationIndices.length > 0) {
            try {
                const selectedTranslations = userState.selectedTranslationIndices
                    .map(index => userState.tempTranslations[index]);
                
                // ✅ ИЗМЕНЕНИЕ: Используем новую функцию сохранения
                await saveWordWithMeanings(chatId, userState, selectedTranslations);
                
                await bot.deleteMessage(chatId, callbackQuery.message.message_id);
            } catch (error) {
                console.error('Error saving translations:', error);
                await bot.sendMessage(chatId, '❌ Ошибка при сохранении слова');
            }
        }
    }
    // ... (остальные обработчики)
});

// Обработка ошибок
bot.on('error', (error) => {
    console.error('Bot error:', error);
});

bot.on('polling_error', (error) => {
    console.error('Polling error:', error);
});

console.log('🤖 Бот запущен: Новая структура - одно слово, несколько значений');
