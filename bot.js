import TelegramBot from 'node-telegram-bot-api';
import { GoogleSheetsService } from './services/google-sheets.js';
import { TranscriptionService } from './services/transcription-service.js';
import { ExampleGeneratorService } from './services/example-generator.js';

const bot = new TelegramBot(process.env.BOT_TOKEN, { 
    polling: true 
});

const sheetsService = new GoogleSheetsService();
const transcriptionService = new TranscriptionService();
const exampleGenerator = new ExampleGeneratorService();

// Хранилище состояний пользователей
const userStates = new Map();

// Хранилище для отслеживания отправленных аудио в каждом чате
const sentAudios = new Map();

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

// Клавиатура для выбора переводов с возможностью множественного выбора
function getTranslationSelectionKeyboard(translations, selectedIndices = []) {
    const translationButtons = translations.map((translation, index) => {
        const isSelected = selectedIndices.includes(index);
        const emoji = isSelected ? '✅' : `${index + 1}️⃣`;
        return [
            { 
                text: `${emoji} ${translation}`, 
                callback_data: `toggle_translation_${index}` 
            }
        ];
    });

    const actionButtons = [];
    
    // Кнопка сохранения показывается только если есть выбранные варианты
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

// Функция для генерации и показа примеров при выборе перевода
async function generateAndShowExamples(chatId, userState) {
    if (userState.selectedTranslationIndices.length === 0) {
        return;
    }

    const selectedTranslations = userState.selectedTranslationIndices
        .map(index => userState.tempTranslations[index]);
    const mainTranslation = selectedTranslations[0];

    if (!mainTranslation) {
        return;
    }

    try {
        console.log(`🔄 Generating examples for selected translation: "${mainTranslation}"`);
        const contextExamples = await exampleGenerator.generateExamples(userState.tempWord, mainTranslation);
        
        if (contextExamples && contextExamples.length > 0) {
            // Обновляем примеры в состоянии
            userState.tempExamples = contextExamples;
            
            let examplesMessage = `📝 Примеры использования для перевода "${mainTranslation}":\n\n`;
            contextExamples.forEach((example, index) => {
                examplesMessage += `${index + 1}️⃣ ${example}\n\n`;
            });
            
            await bot.sendMessage(chatId, examplesMessage);
        }
    } catch (error) {
        console.error('Error generating examples:', error);
    }
}

// Функция для сохранения слова с переводом
async function saveWordWithTranslation(chatId, userState, translation) {
    let success = true;
    
    if (sheetsService.initialized) {
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
        
        // Сохраняем слово с примерами использования
        success = await sheetsService.addWord(
            chatId, 
            userState.tempWord, 
            userState.tempTranscription,
            translation,
            userState.tempAudioUrl,
            userState.tempExamples?.join(' | ') // Сохраняем примеры через разделитель
        );
    }
    
    userStates.delete(chatId);
    
    if (success) {
        const transcriptionText = userState.tempTranscription ? ` [${userState.tempTranscription}]` : '';
        
        let successMessage = '✅ Слово добавлено в словарь!\n\n' +
            `💬 ${userState.tempWord}${transcriptionText} - ${translation}\n\n`;
        
        // Показываем примеры в сообщении об успехе
        if (userState.tempExamples && userState.tempExamples.length > 0) {
            successMessage += '📝 Примеры использования:\n';
            userState.tempExamples.forEach((example, index) => {
                successMessage += `\n${index + 1}️⃣ ${example}`;
            });
            successMessage += '\n\n';
        }
        
        successMessage += 'Теперь оно будет доступно для повторения.';
        
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
        '🤖 С контекстными примерами использования'
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
        
        await showMainMenu(chatId, '🔍 Ищу транскрипцию, произношение, переводы...');
        
        try {
            const result = await transcriptionService.getUKTranscription(englishWord);
            
            let audioId = null;
            if (result.audioUrl) {
                audioId = Date.now().toString();
            }
            
            // ✅ НЕ ГЕНЕРИРУЕМ ПРИМЕРЫ ПРИ ДОБАВЛЕНИИ СЛОВА - только при выборе перевода
            userStates.set(chatId, {
                state: 'showing_transcription',
                tempWord: englishWord,
                tempTranscription: result.transcription || '',
                tempAudioUrl: result.audioUrl || '',
                tempAudioId: audioId,
                tempTranslations: result.translations || [],
                tempExamples: [], // Пустой массив - примеры будут сгенерированы позже
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
            }

            if (result.translations && result.translations.length > 0) {
                message += `\n\n🎯 Найдено ${result.translations.length} вариантов перевода`;
            }
            
            // ✅ НЕ ПОКАЗЫВАЕМ ИНФОРМАЦИЮ О ПРИМЕРАХ - их еще нет
            message += `\n\nВыберите действие:`;
            
            await bot.sendMessage(chatId, message, getListeningKeyboard(audioId));
            await showMainMenu(chatId);
            
        } catch (error) {
            console.error('Error getting transcription:', error);
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
        
        // Генерируем примеры на основе введенного перевода
        console.log('🔄 Generating examples based on manual translation...');
        const contextExamples = await exampleGenerator.generateExamples(userState.tempWord, translation);
        userState.tempExamples = contextExamples;
        
        await saveWordWithTranslation(chatId, userState, translation);
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
        const translationToSave = allTranslations.join(', ');
        
        // Генерируем примеры на основе основного перевода
        const mainTranslation = selectedTranslations[0] || customTranslation;
        console.log('🔄 Generating examples based on selected translation...');
        const contextExamples = await exampleGenerator.generateExamples(userState.tempWord, mainTranslation);
        userState.tempExamples = contextExamples;
        
        await saveWordWithTranslation(chatId, userState, translationToSave);
    }
    else {
        await showMainMenu(chatId, 'Выберите действие из меню:');
    }
});

// Обработка inline кнопок
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;
    const userState = userStates.get(chatId);

    await bot.answerCallbackQuery(callbackQuery.id);

    if (data.startsWith('audio_')) {
        // ... (код обработки аудио без изменений)
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

                    let translationMessage = '🎯 Выберите варианты перевода (можно несколько):\n\n' +
                        `🇬🇧 ${userState.tempWord}`;
                    
                    if (userState.tempTranscription) {
                        translationMessage += `\n🔤 Транскрипция: ${userState.tempTranscription}`;
                    }

                    // ✅ ПОКАЗЫВАЕМ ПРИМЕРЫ ТОЛЬКО ЕСЛИ ОНИ УЖЕ ЕСТЬ (после выбора перевода)
                    if (userState.tempExamples && userState.tempExamples.length > 0) {
                        translationMessage += '\n\n📝 Примеры использования:\n';
                        userState.tempExamples.forEach((example, index) => {
                            translationMessage += `\n${index + 1}️⃣ ${example}`;
                        });
                    }

                    translationMessage += '\n\n💡 Нажимайте на варианты для выбора, затем нажмите "Сохранить"';

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

                // ✅ ГЕНЕРИРУЕМ И ПОКАЗЫВАЕМ ПРИМЕРЫ ПОСЛЕ ВЫБОРА ПЕРЕВОДА
                if (selectedIndices.length > 0) {
                    await generateAndShowExamples(chatId, userState);
                }
                
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
                
                // ✅ УБЕЖДАЕМСЯ ЧТО ПРИМЕРЫ СГЕНЕРИРОВАНЫ ПЕРЕД СОХРАНЕНИЕМ
                if (!userState.tempExamples || userState.tempExamples.length === 0) {
                    const mainTranslation = selectedTranslations[0];
                    console.log('🔄 Generating final examples before saving...');
                    const contextExamples = await exampleGenerator.generateExamples(userState.tempWord, mainTranslation);
                    userState.tempExamples = contextExamples;
                }
                
                const translationToSave = selectedTranslations.join(', ');
                await saveWordWithTranslation(chatId, userState, translationToSave);
                
                await bot.deleteMessage(chatId, callbackQuery.message.message_id);
            } catch (error) {
                console.error('Error saving translations:', error);
                await bot.sendMessage(chatId, '❌ Ошибка при сохранении слова');
            }
        }
    }
    else if (data === 'custom_translation') {
        // ... (код custom_translation без изменений)
    }
    else if (data === 'cancel_translation') {
        // ... (код cancel_translation без изменений)
    }
});

// Обработка ошибок
bot.on('error', (error) => {
    console.error('Bot error:', error);
});

bot.on('polling_error', (error) => {
    console.error('Polling error:', error);
});

console.log('🤖 Бот запущен с отложенной генерацией примеров');
