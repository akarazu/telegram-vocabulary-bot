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

// Функция для показа примеров при выборе перевода
async function showExamplesForSelectedTranslation(chatId, userState) {
    if (userState.selectedTranslationIndices.length === 0) {
        return;
    }

    const selectedTranslations = userState.selectedTranslationIndices
        .map(index => userState.tempTranslations[index]);
    const mainTranslation = selectedTranslations[0];

    try {
        console.log(`🔄 Generating examples for selected translation: "${mainTranslation}"`);
        const contextExamples = await exampleGenerator.generateExamples(userState.tempWord, mainTranslation);
        
        if (contextExamples && contextExamples.length > 0) {
            let examplesMessage = `📝 Примеры использования для перевода "${mainTranslation}":\n\n`;
            contextExamples.forEach((example, index) => {
                examplesMessage += `${index + 1}️⃣ ${example}\n\n`;
            });
            
            examplesMessage += '💾 Нажмите "Сохранить" чтобы добавить слово в словарь';
            
            await bot.sendMessage(chatId, examplesMessage);
            userState.tempExamples = contextExamples; // Обновляем примеры в состоянии
        }
    } catch (error) {
        console.error('Error showing examples for translation:', error);
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
    
    // Проверяем доступные API при старте
    await exampleGenerator.checkApisAvailability();
    
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

    // Игнорируем служебные сообщения и команды
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
        
        // Проверяем что это английское слово
        if (!/^[a-zA-Z\s\-']+$/.test(englishWord)) {
            await showMainMenu(chatId, 
                '❌ Это не похоже на английское слово.\n' +
                'Пожалуйста, введите слово на английском:'
            );
            return;
        }
        
        // ПРОВЕРКА GOOGLE SHEETS И ДУБЛИКАТОВ
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
                // Продолжаем без проверки дубликатов
            }
        }
        
        await showMainMenu(chatId, '🔍 Ищу транскрипцию, произношение, переводы...\n🤖 Генерирую примеры использования...');
        
        try {
            // Получаем данные о слове
            const result = await transcriptionService.getUKTranscription(englishWord);
            
            let audioId = null;
            if (result.audioUrl) {
                audioId = Date.now().toString();
            }
            
            // Генерируем общие примеры (без конкретного перевода)
            const generalExamples = await exampleGenerator.generateExamples(englishWord);
            
            // Сохраняем ВСЕ данные включая примеры
            userStates.set(chatId, {
                state: 'showing_transcription',
                tempWord: englishWord,
                tempTranscription: result.transcription || '',
                tempAudioUrl: result.audioUrl || '',
                tempAudioId: audioId,
                tempTranslations: result.translations || [],
                tempExamples: generalExamples,
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

            // Показываем доступные варианты перевода
            if (result.translations && result.translations.length > 0) {
                message += `\n\n🎯 Найдено ${result.translations.length} вариантов перевода`;
            }

            // Показываем примеры использования
            if (generalExamples && generalExamples.length > 0) {
                message += `\n\n📝 Сгенерировано ${generalExamples.length} примеров использования`;
            }
            
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
        
        // Сохраняем ручной перевод
        await saveWordWithTranslation(chatId, userState, translation);
    }
    else if (userState?.state === 'waiting_custom_translation_with_selected') {
        const customTranslation = text.trim();
        
        if (!customTranslation) {
            await showMainMenu(chatId, '❌ Перевод не может быть пустым. Введите перевод:');
            return;
        }
        
        // Объединяем выбранные переводы с пользовательским
        const selectedTranslations = userState.selectedTranslationIndices
            .map(index => userState.tempTranslations[index]);
        
        // Добавляем пользовательский перевод к выбранным
        const allTranslations = [...selectedTranslations, customTranslation];
        const translationToSave = allTranslations.join(', ');
        
        // Генерируем контекстные примеры на основе основного перевода
    const mainTranslation = selectedTranslations[0] || customTranslation;
    console.log('🔄 Generating examples based on selected translation...');
    const contextExamples = await exampleGenerator.generateExamples(userState.tempWord, mainTranslation);
    userState.tempExamples = contextExamples;
            
        // Сохраняем слово
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
        const audioId = data.replace('audio_', '');
        const audioUrl = userState?.tempAudioUrl;
        const englishWord = userState?.tempWord;
        
        if (audioUrl && englishWord) {
            try {
                await bot.editMessageReplyMarkup(
                    { inline_keyboard: [] },
                    { chat_id: chatId, message_id: callbackQuery.message.message_id }
                );

                addAudioToHistory(chatId, audioUrl, englishWord);
                const hasPrevious = hasPreviousAudios(chatId, audioUrl);
                
                await bot.sendAudio(chatId, audioUrl, {
                    caption: `🔊 Британское произношение: ${englishWord}`
                });

                if (hasPrevious) {
                    await bot.sendMessage(chatId,
                        '⚠️ Чтобы избежать автовоспроизведения старых аудио:\n\n' +
                        '📱 На Android:\n' +
                        '• Нажмите кнопку "Назад" после прослушивания\n' +
                        '• Или закройте плеер свайпом вниз\n\n' +
                        '📱 На iOS:\n' +
                        '• Свайпните плеер вниз\n' +
                        '• Или нажмите "Закрыть"\n\n' +
                        '💡 Это нужно сделать только если начали играть старые слова'
                    );
                }
                
                await bot.sendMessage(chatId, 
                    '🎵 Вы прослушали произношение. Хотите ввести перевод?',
                    getAfterAudioKeyboard()
                );
                
                await showMainMenu(chatId);
                
            } catch (error) {
                console.error('Error sending audio:', error);
                await bot.sendMessage(chatId, '❌ Ошибка при воспроизведении аудио');
            }
        }
    }
    else if (data === 'enter_translation') {
        if (userState?.state === 'showing_transcription') {
            try {
                await bot.editMessageReplyMarkup(
                    { inline_keyboard: [] },
                    { chat_id: chatId, message_id: callbackQuery.message.message_id }
                );

                // ЕСЛИ ЕСТЬ ВАРИАНТЫ ПЕРЕВОДА - ПОКАЗЫВАЕМ ИХ С ВОЗМОЖНОСТЬЮ ВЫБОРА
                if (userState.tempTranslations && userState.tempTranslations.length > 0) {
                    userStates.set(chatId, {
                        ...userState,
                        state: 'choosing_translation',
                        selectedTranslationIndices: [] // Сбрасываем выбранные варианты
                    });

                    let translationMessage = '🎯 Выберите варианты перевода (можно несколько):\n\n' +
                        `🇬🇧 ${userState.tempWord}`;
                    
                    if (userState.tempTranscription) {
                        translationMessage += `\n🔤 Транскрипция: ${userState.tempTranscription}`;
                    }

                    // ДОБАВЛЯЕМ ПРИМЕРЫ ИСПОЛЬЗОВАНИЯ
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
                    // ЕСЛИ ВАРИАНТОВ НЕТ - ПРОСИМ ВВЕСТИ ВРУЧНУЮ
                    userStates.set(chatId, {
                        ...userState,
                        state: 'waiting_manual_translation'
                    });
                    
                    let translationMessage = '✏️ Введите перевод для слова:\n\n' +
                        `🇬🇧 ${userState.tempWord}`;
                    
                    if (userState.tempTranscription) {
                        translationMessage += `\n🔤 Транскрипция: ${userState.tempTranscription}`;
                    }
                    
                    // ДОБАВЛЯЕМ ПРИМЕРЫ ИСПОЛЬЗОВАНИЯ
                    if (userState.tempExamples && userState.tempExamples.length > 0) {
                        translationMessage += '\n\n📝 Примеры использования:\n';
                        userState.tempExamples.forEach((example, index) => {
                            translationMessage += `\n${index + 1}️⃣ ${example}`;
                        });
                    }
                    
                    translationMessage += '\n\n💡 Можно ввести несколько вариантов через запятую\nНапример: солнце, светило, солнечный свет';
                    
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
                
                // Переключаем выбор
                if (selectedIndices.includes(translationIndex)) {
                    // Убираем из выбранных
                    selectedIndices = selectedIndices.filter(idx => idx !== translationIndex);
                } else {
                    // Добавляем в выбранных
                    selectedIndices.push(translationIndex);
                }
                
                // Обновляем состояние
                userStates.set(chatId, {
                    ...userState,
                    selectedTranslationIndices: selectedIndices
                });
                
                // Обновляем сообщение с новой клавиатурой
                await bot.editMessageReplyMarkup(
                    getTranslationSelectionKeyboard(userState.tempTranslations, selectedIndices).reply_markup,
                    {
                        chat_id: chatId,
                        message_id: callbackQuery.message.message_id
                    }
                );

                        if (selectedIndices.length > 0) {
                await showExamplesForSelectedTranslation(chatId, userState);
            }
                
            } catch (error) {
                console.error('Error toggling translation:', error);
            }
        }
    }
    else if (data === 'save_selected_translations') {
        if (userState?.state === 'choosing_translation' && userState.selectedTranslationIndices.length > 0) {
            try {
                           // Получаем выбранные переводы
            const selectedTranslations = userState.selectedTranslationIndices
                .map(index => userState.tempTranslations[index]);
            
            // ✅ ДОБАВИТЬ ЭТИ СТРОКИ - генерируем примеры на основе выбранного перевода
            const mainTranslation = selectedTranslations[0];
            console.log('🔄 Generating final examples based on selected translation...');
            const contextExamples = await exampleGenerator.generateExamples(userState.tempWord, mainTranslation);
            userState.tempExamples = contextExamples;
            
            // Объединяем через запятую для сохранения в таблице
            const translationToSave = selectedTranslations.join(', ');
            
            // Сохраняем слово
            await saveWordWithTranslation(chatId, userState, translationToSave);
            
            // Удаляем сообщение с выбором переводов
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
                // Сохраняем выбранные варианты и переходим к вводу пользовательского перевода
                userStates.set(chatId, {
                    ...userState,
                    state: 'waiting_custom_translation_with_selected'
                });
                
                let translationMessage = '✏️ Введите свой вариант перевода:\n\n' +
                    `🇬🇧 ${userState.tempWord}`;
                
                if (userState.tempTranscription) {
                    translationMessage += `\n🔤 Транскрипция: ${userState.tempTranscription}`;
                }
                
                // Показываем уже выбранные варианты
                if (userState.selectedTranslationIndices.length > 0) {
                    const selectedTranslations = userState.selectedTranslationIndices
                        .map(index => userState.tempTranslations[index]);
                    translationMessage += `\n\n✅ Уже выбрано: ${selectedTranslations.join(', ')}`;
                }

                // ДОБАВЛЯЕМ ПРИМЕРЫ ИСПОЛЬЗОВАНИЯ
                if (userState.tempExamples && userState.tempExamples.length > 0) {
                    translationMessage += '\n\n📝 Примеры использования:\n';
                    userState.tempExamples.forEach((example, index) => {
                        translationMessage += `\n${index + 1}️⃣ ${example}`;
                    });
                }
                
                translationMessage += '\n\n💡 Ваш перевод будет добавлен к выбранным вариантам';
                
                // Удаляем предыдущее сообщение с выбором
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

// Проверяем доступные API при запуске
exampleGenerator.checkApisAvailability().then(availableApis => {
    console.log('🤖 Бот запущен с контекстной генерацией примеров');
    console.log(`🔧 Доступные API: ${availableApis.join(', ')}`);
});

