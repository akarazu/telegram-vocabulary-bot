import TelegramBot from 'node-telegram-bot-api';
import { GoogleSheetsService } from './services/google-sheets.js';
import { CombinedDictionaryService } from './services/combined-dictionary-service.js';

const bot = new TelegramBot(process.env.BOT_TOKEN, { 
    polling: true 
});

const sheetsService = new GoogleSheetsService();
const dictionaryService = new CombinedDictionaryService();

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

// Клавиатура для выбора переводов
function getTranslationSelectionKeyboard(translations, selectedIndices = []) {
    const translationButtons = translations.map((translation, index) => {
        const isSelected = selectedIndices.includes(index);
        
        // ✅ ФИКС: для всех номеров используем эмодзи
        let numberEmoji;
        if (index < 9) {
            // Для первых 9 используем эмодзи с цифрами 1️⃣-9️⃣
            numberEmoji = `${index + 1}️⃣`;
        } else {
            // Для 10+ разбиваем на две цифры эмодзи
            const number = index + 1;
            const digits = number.toString().split('');
            numberEmoji = digits.map(digit => {
                const digitEmojis = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];
                return digitEmojis[parseInt(digit)];
            }).join('');
        }
        
        const emoji = isSelected ? '✅' : numberEmoji;
        
        return [
            { 
                text: `${emoji} ${translation}`, 
                callback_data: `toggle_translation_${index}` 
            }
        ];
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

// ✅ Упрощенная функция сохранения с примерами
async function saveWordWithExamples(chatId, userState, selectedTranslations) {
    console.log(`💾 Saving word:`, {
        word: userState.tempWord,
        selectedTranslations: selectedTranslations
    });
    
    let success = true;
    
    if (sheetsService.initialized) {
        // Проверяем дубликаты
        try {
            const existingWords = await sheetsService.getUserWords(chatId);
            const isDuplicate = existingWords.some(word => 
                word.english.toLowerCase() === userState.tempWord.toLowerCase()
            );
            
            if (isDuplicate) {
                await showMainMenu(chatId, 
                    `❌ Слово "${userState.tempWord}" уже было добавлено в словарь!\n\n` +
                    'Пожалуйста, начните заново.'
                );
                userStates.delete(chatId);
                return;
            }
        } catch (error) {
            console.error('❌ Error checking duplicates:', error);
        }
        
        // ✅ НАХОДИМ ПРИМЕРЫ ДЛЯ ВЫБРАННЫХ ПЕРЕВОДОВ
        const examples = [];
        selectedTranslations.forEach(translation => {
            // Ищем значения с этим переводом
            const meaningsForTranslation = userState.meanings.filter(
                meaning => meaning.translation === translation
            );
            
            meaningsForTranslation.forEach(meaning => {
                if (meaning.examples && meaning.examples.length > 0) {
                    examples.push(...meaning.examples);
                }
            });
        });
        
        console.log(`🎯 Found examples:`, examples);
        
        const translationText = selectedTranslations.join(', ');
        
        // ✅ ФОРМИРУЕМ ПРИМЕРЫ ДЛЯ СОХРАНЕНИЯ
        let examplesText = '';
        if (examples.length > 0) {
            // Берем только английские примеры
            const englishExamples = examples.map(ex => ex.english).filter(ex => ex);
            examplesText = englishExamples.join(' | ');
        }
        
        // ✅ СОХРАНЯЕМ
        success = await sheetsService.addWordWithExamples(
            chatId, 
            userState.tempWord, 
            userState.tempTranscription,
            translationText,
            userState.tempAudioUrl,
            examplesText
        );
    }
    
    // Очищаем состояние пользователя
    userStates.delete(chatId);
    
    if (success) {
        const transcriptionText = userState.tempTranscription ? ` [${userState.tempTranscription}]` : '';
        
        let successMessage = '✅ Слово добавлено в словарь!\n\n' +
            `💬 ${userState.tempWord}${transcriptionText} - ${selectedTranslations.join(', ')}\n\n`;
        
        // ✅ ПОКАЗЫВАЕМ ПРИМЕРЫ ЕСЛИ ЕСТЬ
        const examples = [];
        selectedTranslations.forEach(translation => {
            const meaningsForTranslation = userState.meanings.filter(
                meaning => meaning.translation === translation
            );
            meaningsForTranslation.forEach(meaning => {
                if (meaning.examples && meaning.examples.length > 0) {
                    examples.push(...meaning.examples);
                }
            });
        });
        
        if (examples.length > 0) {
            successMessage += '📝 **Примеры использования:**\n';
            // Берем только уникальные примеры
            const uniqueExamples = [...new Set(examples.map(ex => ex.english))].slice(0, 3);
            uniqueExamples.forEach((example, index) => {
                successMessage += `${index + 1}. ${example}\n`;
            });
        }
        
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
        '📝 С примерами использования из контекста'
    );
});

// Обработка сообщений
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
        const englishWord = text.trim().toLowerCase();
        
        if (!/^[a-zA-Z\s\-']+$/.test(englishWord)) {
            await showMainMenu(chatId, 
                '❌ Это не похоже на английское слово.\n' +
                'Пожалуйста, введите слово на английском:'
            );
            return;
        }
        
        if (sheetsService.initialized) {
            try {
                const existingWords = await sheetsService.getUserWords(chatId);
                const isDuplicate = existingWords.some(word => 
                    word.english.toLowerCase() === englishWord.toLowerCase()
                );
                
                if (isDuplicate) {
                    await showMainMenu(chatId, 
                        `❌ Слово "${englishWord}" уже есть в вашем словаре!\n\n` +
                        'Пожалуйста, введите другое слово:'
                    );
                    return;
                }
            } catch (error) {
                console.error('Error checking duplicates:', error);
            }
        }
        
        await showMainMenu(chatId, '🔍 Ищу перевод, транскрипцию, произношение и примеры...');
        
        try {
            const result = await dictionaryService.getWordData(englishWord);
            
            let audioId = null;
            if (result.audioUrl) {
                audioId = Date.now().toString();
            }
                    
            userStates.set(chatId, {
                state: 'showing_transcription',
                tempWord: englishWord,
                tempTranscription: result.transcription || '',
                tempAudioUrl: result.audioUrl || '',
                tempAudioId: audioId,
                tempTranslations: result.translations || [],
                meanings: result.meanings || [],
                selectedTranslationIndices: []
            });
            
            let message = `📝 Слово: ${englishWord}`;
            
            if (result.transcription) {
                message += `\n🔤 Транскрипция: ${result.transcription}`;
            } else {
                message += `\n❌ Транскрипция не найдена`;
            }
            
            if (result.audioUrl) {
                message += `\n\n🎵 Доступно аудио произношение`;
            } else {
                message += `\n\n❌ Аудио произношение не найдено`;
            }

            if (result.translations && result.translations.length > 0) {
                message += `\n\n🎯 Найдено ${result.translations.length} вариантов перевода`;
                
                // ✅ ПОКАЗЫВАЕМ НАЙДЕННЫЕ ПРИМЕРЫ
                const totalExamples = result.meanings.reduce((total, meaning) => 
                    total + (meaning.examples ? meaning.examples.length : 0), 0
                );
                if (totalExamples > 0) {
                    message += `\n📝 Найдено ${totalExamples} примеров использования`;
                }
            } else {
                message += `\n\n❌ Переводы не найдены`;
            }
            
            message += `\n\nВыберите действие:`;
            
            await bot.sendMessage(chatId, message, getListeningKeyboard(audioId));
            await showMainMenu(chatId);
            
        } catch (error) {
            console.error('Error getting word data:', error);
            await showMainMenu(chatId, 
                '❌ Ошибка при поиске слова\n\nПопробуйте другое слово или повторите позже.'
            );
        }
    }
    else if (userState?.state === 'waiting_manual_translation') {
        const translation = text.trim();
        
        if (!translation) {
            await showMainMenu(chatId, '❌ Перевод не может быть пустым. Введите перевод:');
            return;
        }
        
        await saveWordWithExamples(chatId, userState, [translation]);
    }
    else if (userState?.state === 'waiting_custom_translation_with_selected') {
        const customTranslation = text.trim();
        
        if (!customTranslation) {
            await showMainMenu(chatId, '❌ Перевод не может быть пустым. Введите перевод:');
            return;
        }
        
        const selectedTranslations = userState.selectedTranslationIndices
            .map(index => userState.tempTranslations[index]);
        
        const allTranslations = [...selectedTranslations, customTranslation];
        
        await saveWordWithExamples(chatId, userState, allTranslations);
    }
    else {
        await showMainMenu(chatId, 'Выберите действие из меню:');
    }
});

// Обработка inline кнопок (остается без изменений)
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

                await bot.sendAudio(chatId, audioUrl, {
                    caption: `🔊 Британское произношение: ${englishWord}`
                });
                
                await bot.sendMessage(chatId, 
                    '🎵 Вы прослушали произношение. Хотите ввести перевод?',
                    getAfterAudioKeyboard()
                );
                
                await showMainMenu(chatId);
                
            } catch (error) {
                console.error('Error sending audio:', error);
                await bot.sendMessage(chatId, '❌ Ошибка при воспроизведении аудио.');
            }
        } else {
            await bot.sendMessage(chatId, '❌ Аудио произношение недоступно для этого слова.');
        }
    }
    else if (data === 'enter_translation') {
        if (userState?.state === 'showing_transcription') {
            try {
                await bot.editMessageReplyMarkup(
                    { inline_keyboard: [] },
                    { chat_id: chatId, message_id: callbackQuery.message.message_id }
                );

                if (userState.tempTranslations && userState.tempTranslations.length > 0) {
                    userStates.set(chatId, {
                        ...userState,
                        state: 'choosing_translation',
                        selectedTranslationIndices: []
                    });

                    let translationMessage = '🎯 **Выберите переводы:**\n\n' +
                        `🇬🇧 ${userState.tempWord}`;
                    
                    if (userState.tempTranscription) {
                        translationMessage += `\n🔤 Транскрипция: ${userState.tempTranscription}`;
                    }

                    await bot.sendMessage(chatId, translationMessage, 
                        getTranslationSelectionKeyboard(userState.tempTranslations, [])
                    );
                } else {
                    userStates.set(chatId, {
                        ...userState,
                        state: 'waiting_manual_translation'
                    });
                    
                    let translationMessage = '✏️ Введите перевод для слова:\n\n' +
                        `🇬🇧 ${userState.tempWord}`;
                    
                    if (userState.tempTranscription) {
                        translationMessage += `\n🔤 Транскрипция: ${userState.tempTranscription}`;
                    }
                    
                    await showMainMenu(chatId, translationMessage);
                }
            } catch (error) {
                console.error('Error in enter_translation:', error);
                await bot.sendMessage(chatId, '❌ Ошибка при обработке запроса');
            }
        }
    }
    else if (data.startsWith('toggle_translation_')) {
        const translationIndex = parseInt(data.replace('toggle_translation_', ''));
        
        if (userState?.state === 'choosing_translation' && userState.tempTranslations[translationIndex]) {
            try {
                let selectedIndices = [...(userState.selectedTranslationIndices || [])];
                
                if (selectedIndices.includes(translationIndex)) {
                    selectedIndices = selectedIndices.filter(idx => idx !== translationIndex);
                } else {
                    selectedIndices.push(translationIndex);
                }
                
                userStates.set(chatId, {
                    ...userState,
                    selectedTranslationIndices: selectedIndices
                });
                
                await bot.editMessageReplyMarkup(
                    getTranslationSelectionKeyboard(userState.tempTranslations, selectedIndices).reply_markup,
                    {
                        chat_id: chatId,
                        message_id: callbackQuery.message.message_id
                    }
                );
                
            } catch (error) {
                console.error('Error toggling translation:', error);
            }
        }
    }
    else if (data === 'save_selected_translations') {
        if (userState?.state === 'choosing_translation' && userState.selectedTranslationIndices.length > 0) {
            try {
                const selectedTranslations = userState.selectedTranslationIndices
                    .map(index => userState.tempTranslations[index]);
                
                await saveWordWithExamples(chatId, userState, selectedTranslations);
                
                await bot.deleteMessage(chatId, callbackQuery.message.message_id);
            } catch (error) {
                console.error('Error saving translations:', error);
                await bot.sendMessage(chatId, '❌ Ошибка при сохранении слова');
            }
        }
    }
    else if (data === 'custom_translation') {
        if (userState?.state === 'choosing_translation') {
            try {
                userStates.set(chatId, {
                    ...userState,
                    state: 'waiting_custom_translation_with_selected'
                });
                
                let translationMessage = '✏️ Введите свой вариант перевода:\n\n' +
                    `🇬🇧 ${userState.tempWord}`;
                
                if (userState.tempTranscription) {
                    translationMessage += `\n🔤 Транскрипция: ${userState.tempTranscription}`;
                }
                
                if (userState.selectedTranslationIndices.length > 0) {
                    const selectedTranslations = userState.selectedTranslationIndices
                        .map(index => userState.tempTranslations[index]);
                    translationMessage += `\n\n✅ Уже выбрано: ${selectedTranslations.join(', ')}`;
                }
                
                translationMessage += '\n\n💡 Ваш перевод будет добавлен к выбранным вариантам';
                
                await bot.deleteMessage(chatId, callbackQuery.message.message_id);
                
                await showMainMenu(chatId, translationMessage);
            } catch (error) {
                console.error('Error in custom_translation:', error);
                await bot.sendMessage(chatId, '❌ Ошибка при обработке запроса');
            }
        }
    }
    else if (data === 'cancel_translation') {
        if (userState) {
            try {
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
                await showMainMenu(chatId);
            } catch (error) {
                console.error('Error canceling translation:', error);
                await bot.sendMessage(chatId, '❌ Ошибка при отмене');
            }
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

console.log('🤖 Бот запущен с новой логикой примеров из FreeDict');


