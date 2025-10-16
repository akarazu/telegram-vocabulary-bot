import TelegramBot from 'node-telegram-bot-api';
import { GoogleSheetsService } from './services/google-sheets.js';
import { YandexDictionaryService } from './services/yandex-dictionary-service.js';

const bot = new TelegramBot(process.env.BOT_TOKEN, { 
    polling: true 
});

const sheetsService = new GoogleSheetsService();
const yandexService = new YandexDictionaryService();

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

// Функция для сохранения слова с переводом и примерами
async function saveWordWithTranslation(chatId, userState, translation) {
    console.log(`💾 START Saving word:`, {
        chatId,
        word: userState.tempWord,
        translation: translation
    });
    
    let success = true;
    
    if (sheetsService.initialized) {
        console.log('✅ Google Sheets service is initialized');
        
        // Проверяем дубликаты
        try {
            console.log('🔍 Checking for duplicates...');
            const existingWords = await sheetsService.getUserWords(chatId);
            const isDuplicate = existingWords.some(word => 
                word.english.toLowerCase() === userState.tempWord.toLowerCase()
            );
            
            if (isDuplicate) {
                console.log('❌ Duplicate word found, not saving');
                await showMainMenu(chatId, 
                    `❌ Слово "${userState.tempWord}" уже было добавлено в словарь!\n\n` +
                    'Пожалуйста, начните заново.'
                );
                userStates.delete(chatId);
                return;
            }
            console.log('✅ No duplicates found');
        } catch (error) {
            console.error('❌ Error checking duplicates:', error);
        }
        
        // ✅ ИСПОЛЬЗУЕМ ПРИМЕРЫ ИЗ YANDEX ВМЕСТО ГЕНЕРАЦИИ
        console.log('🔄 Getting examples from Yandex data...');
        
        let examplesText = '';
        
        // ✅ ЕСЛИ ЕСТЬ ВЫБРАННЫЕ ЗНАЧЕНИЯ - ИСПОЛЬЗУЕМ ИХ ПРИМЕРЫ
        if (userState.selectedTranslationIndices && userState.selectedTranslationIndices.length > 0) {
            const selectedExamples = [];
            
            userState.selectedTranslationIndices.forEach(index => {
                if (userState.meanings && userState.meanings[index]) {
                    const meaning = userState.meanings[index];
                    if (meaning.examples && meaning.examples.length > 0) {
                        // ✅ БЕРЕМ ПЕРВЫЙ ПРИМЕР ИЗ КАЖДОГО ВЫБРАННОГО ЗНАЧЕНИЯ
                        const firstExample = meaning.examples[0];
                        if (firstExample.full) {
                            selectedExamples.push(firstExample.full);
                        } else if (firstExample.english) {
                            selectedExamples.push(firstExample.english);
                        }
                    }
                }
            });
            
            examplesText = selectedExamples.join(' | ');
            console.log(`✅ Using examples from selected meanings: ${examplesText}`);
            
        } 
        // ✅ ЕСЛИ НЕТ ВЫБРАННЫХ ЗНАЧЕНИЙ, ИСПОЛЬЗУЕМ ЛЮБЫЕ ДОСТУПНЫЕ ПРИМЕРЫ
        else if (userState.meanings && userState.meanings.length > 0) {
            const allExamples = [];
            
            userState.meanings.forEach(meaning => {
                if (meaning.examples && meaning.examples.length > 0) {
                    meaning.examples.slice(0, 1).forEach(example => {
                        if (example.full) {
                            allExamples.push(example.full);
                        } else if (example.english) {
                            allExamples.push(example.english);
                        }
                    });
                }
            });
            
            examplesText = allExamples.slice(0, 2).join(' | ');
            console.log(`✅ Using first available examples: ${examplesText}`);
        }
        
        // ✅ ЕСЛИ ПРИМЕРОВ ВООБЩЕ НЕТ - СОЗДАЕМ ПУСТУЮ СТРОКУ
        if (!examplesText) {
            examplesText = '';
            console.log('ℹ️ No examples available');
        }
        
        console.log(`📝 Final examples for storage: "${examplesText}"`);
        
        // Сохраняем слово с примерами
        console.log('💾 Saving to Google Sheets...');
        success = await sheetsService.addWordWithExamples(
            chatId, 
            userState.tempWord, 
            userState.tempTranscription,
            translation,
            userState.tempAudioUrl,
            examplesText
        );
        
        console.log(`📊 Save result: ${success ? 'SUCCESS' : 'FAILED'}`);
    } else {
        console.log('❌ Google Sheets service NOT initialized');
        success = false;
    }
    
    // Очищаем состояние пользователя
    userStates.delete(chatId);
    
    if (success) {
        const transcriptionText = userState.tempTranscription ? ` [${userState.tempTranscription}]` : '';
        
        let successMessage = '✅ Слово добавлено в словарь!\n\n' +
            `💬 ${userState.tempWord}${transcriptionText} - ${translation}\n\n`;
        
        // ✅ ПОКАЗЫВАЕМ ПРИМЕРЫ ИЗ СОХРАНЕННЫХ ДАННЫХ
        if (examplesText) {
            successMessage += '📝 Примеры использования:\n';
            const examplesArray = examplesText.split(' | ');
            examplesArray.forEach((ex, index) => {
                successMessage += `${index + 1}. ${ex}\n`;
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
    console.log(`🚀 Bot started by user ${chatId}`);
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

    console.log(`📨 Received message from ${chatId}: "${text}"`);

    if (!text || text.startsWith('/')) {
        return;
    }

    const userState = userStates.get(chatId);

    if (text === '➕ Добавить новое слово') {
        userStates.set(chatId, { state: 'waiting_english' });
        console.log(`🔄 User ${chatId} state: waiting_english`);
        await showMainMenu(chatId, '🇬🇧 Введите английское слово:');
    }
    else if (userState?.state === 'waiting_english') {
        const englishWord = text.trim().toLowerCase();
        console.log(`🔍 User ${chatId} entered word: "${englishWord}"`);
        
        if (!/^[a-zA-Z\s\-']+$/.test(englishWord)) {
            console.log(`❌ Invalid English word: "${englishWord}"`);
            await showMainMenu(chatId, 
                '❌ Это не похоже на английское слово.\n' +
                'Пожалуйста, введите слово на английском:'
            );
            return;
        }
        
        if (sheetsService.initialized) {
            try {
                console.log(`🔍 Checking duplicates for: "${englishWord}"`);
                const existingWords = await sheetsService.getUserWords(chatId);
                const isDuplicate = existingWords.some(word => 
                    word.english.toLowerCase() === englishWord.toLowerCase()
                );
                
                if (isDuplicate) {
                    console.log(`❌ Duplicate found: "${englishWord}"`);
                    await showMainMenu(chatId, 
                        `❌ Слово "${englishWord}" уже есть в вашем словаре!\n\n` +
                        'Пожалуйста, введите другое слово:'
                    );
                    return;
                }
                console.log(`✅ No duplicates found for: "${englishWord}"`);
            } catch (error) {
                console.error('❌ Error checking duplicates:', error);
            }
        }
        
        await showMainMenu(chatId, '🔍 Ищу транскрипцию, произношение, переводы...');
        
        try {
            console.log(`🚀 Calling YandexService for: "${englishWord}"`);
            // ✅ ИСПОЛЬЗУЕМ YANDEX SERVICE ВМЕСТО TRANSCRIPTION SERVICE
            const result = await yandexService.getWordWithAutoExamples(englishWord);
            console.log(`✅ YandexService returned data for: "${englishWord}"`);
            
            let audioId = null;
            if (result.audioUrl) {
                audioId = Date.now().toString();
                console.log(`🎵 Audio URL found: ${result.audioUrl}`);
            }
            
            userStates.set(chatId, {
                state: 'showing_transcription',
                tempWord: englishWord,
                tempTranscription: result.transcription || '',
                tempAudioUrl: result.audioUrl || '',
                tempAudioId: audioId,
                tempTranslations: result.translations || [],
                meanings: result.meanings || [], // ✅ СОХРАНЯЕМ ДЕТАЛЬНЫЕ ЗНАЧЕНИЯ
                selectedTranslationIndices: []
            });

            console.log(`📊 User state updated with ${result.translations?.length || 0} translations and ${result.meanings?.length || 0} meanings`);
            
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
            } else {
                message += `\n\n❌ Переводы не найдены`;
            }
            
            message += `\n\nВыберите действие:`;
            
            await bot.sendMessage(chatId, message, getListeningKeyboard(audioId));
            await showMainMenu(chatId);
            
        } catch (error) {
            console.error('❌ Error getting word data:', error);
            await showMainMenu(chatId, 
                '❌ Ошибка при поиске слова\n\nПопробуйте другое слово или повторите позже.'
            );
        }
    }
    else if (userState?.state === 'waiting_manual_translation') {
        const translation = text.trim();
        console.log(`✏️ User ${chatId} entered manual translation: "${translation}"`);
        
        if (!translation) {
            await showMainMenu(chatId, '❌ Перевод не может быть пустым. Введите перевод:');
            return;
        }
        
        await saveWordWithTranslation(chatId, userState, translation);
    }
    else if (userState?.state === 'waiting_custom_translation_with_selected') {
        const customTranslation = text.trim();
        console.log(`✏️ User ${chatId} entered custom translation: "${customTranslation}"`);
        
        if (!customTranslation) {
            await showMainMenu(chatId, '❌ Перевод не может быть пустым. Введите перевод:');
            return;
        }
        
        const selectedTranslations = userState.selectedTranslationIndices
            .map(index => userState.tempTranslations[index]);
        
        const allTranslations = [...selectedTranslations, customTranslation];
        const translationToSave = allTranslations.join(', ');
        
        console.log(`💾 Saving combined translation: "${translationToSave}"`);
        await saveWordWithTranslation(chatId, userState, translationToSave);
    }
    else {
        console.log(`ℹ️ User ${chatId} sent unexpected message: "${text}"`);
        await showMainMenu(chatId, 'Выберите действие из меню:');
    }
});

// Обработка inline кнопок
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;
    const userState = userStates.get(chatId);

    console.log(`🔘 Callback from ${chatId}: ${data}`);

    await bot.answerCallbackQuery(callbackQuery.id);

    if (data.startsWith('audio_')) {
        const audioId = data.replace('audio_', '');
        const audioUrl = userState?.tempAudioUrl;
        const englishWord = userState?.tempWord;
        
        console.log(`🎵 Audio button clicked: ${audioId}, word: ${englishWord}`);
        
        if (audioUrl && englishWord) {
            try {
                await bot.editMessageReplyMarkup(
                    { inline_keyboard: [] },
                    { chat_id: chatId, message_id: callbackQuery.message.message_id }
                );

                addAudioToHistory(chatId, audioUrl, englishWord);
                const hasPrevious = hasPreviousAudios(chatId, audioUrl);
                
                console.log(`🎵 Sending audio: ${audioUrl}`);
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
                console.error('❌ Error sending audio:', error);
                await bot.sendMessage(chatId, '❌ Ошибка при воспроизведении аудио. Возможно, аудиофайл недоступен.');
            }
        } else {
            console.log(`❌ Audio not available for word: ${englishWord}`);
            await bot.sendMessage(chatId, '❌ Аудио произношение недоступно для этого слова.');
        }
    }
    else if (data === 'enter_translation') {
        console.log(`✏️ Enter translation clicked by ${chatId}`);
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

                    console.log(`🎯 Showing ${userState.tempTranslations.length} translations for selection`);

                    let translationMessage = '🎯 Выберите варианты перевода (можно несколько):\n\n' +
                        `🇬🇧 ${userState.tempWord}`;
                    
                    if (userState.tempTranscription) {
                        translationMessage += `\n🔤 Транскрипция: ${userState.tempTranscription}`;
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
                    
                    console.log(`✏️ No translations found, asking for manual input`);
                    
                    let translationMessage = '✏️ Введите перевод для слова:\n\n' +
                        `🇬🇧 ${userState.tempWord}`;
                    
                    if (userState.tempTranscription) {
                        translationMessage += `\n🔤 Транскрипция: ${userState.tempTranscription}`;
                    }
                    
                    await showMainMenu(chatId, translationMessage);
                }
            } catch (error) {
                console.error('❌ Error in enter_translation:', error);
                await bot.sendMessage(chatId, '❌ Ошибка при обработке запроса');
            }
        }
    }
    else if (data.startsWith('toggle_translation_')) {
        const translationIndex = parseInt(data.replace('toggle_translation_', ''));
        console.log(`🔘 Toggle translation ${translationIndex} by ${chatId}`);
        
        if (userState?.state === 'choosing_translation' && userState.tempTranslations[translationIndex]) {
            try {
                let selectedIndices = [...(userState.selectedTranslationIndices || [])];
                
                if (selectedIndices.includes(translationIndex)) {
                    selectedIndices = selectedIndices.filter(idx => idx !== translationIndex);
                    console.log(`➖ Deselected translation ${translationIndex}`);
                } else {
                    selectedIndices.push(translationIndex);
                    console.log(`➕ Selected translation ${translationIndex}`);
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
                console.error('❌ Error toggling translation:', error);
            }
        }
    }
    else if (data === 'save_selected_translations') {
        console.log(`💾 Save selected translations by ${chatId}`);
        if (userState?.state === 'choosing_translation' && userState.selectedTranslationIndices.length > 0) {
            try {
                const selectedTranslations = userState.selectedTranslationIndices
                    .map(index => userState.tempTranslations[index]);
                
                const translationToSave = selectedTranslations.join(', ');
                console.log(`💾 Saving selected translations: "${translationToSave}"`);
                await saveWordWithTranslation(chatId, userState, translationToSave);
                
                await bot.deleteMessage(chatId, callbackQuery.message.message_id);
            } catch (error) {
                console.error('❌ Error saving translations:', error);
                await bot.sendMessage(chatId, '❌ Ошибка при сохранении слова');
            }
        }
    }
    else if (data === 'custom_translation') {
        console.log(`✏️ Custom translation clicked by ${chatId}`);
        if (userState?.state === 'choosing_translation') {
            try {
                userStates.set(chatId, {
                    ...userState,
                    state: 'waiting_custom_translation_with_selected'
                });

                console.log(`🔄 User state changed to waiting_custom_translation_with_selected`);
                
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
                console.error('❌ Error in custom_translation:', error);
                await bot.sendMessage(chatId, '❌ Ошибка при обработке запроса');
            }
        }
    }
    else if (data === 'cancel_translation') {
        console.log(`🔙 Cancel translation by ${chatId}`);
        if (userState) {
            try {
                await bot.editMessageReplyMarkup(
                    { inline_keyboard: [] },
                    { chat_id: chatId, message_id: callbackQuery.message.message_id }
                );

                userStates.set(chatId, { ...userState, state: 'showing_transcription' });
                
                console.log(`🔄 User state reset to showing_transcription`);
                
                let message = `📝 Слово: ${userState.tempWord}`;
                
                if (userState.tempTranscription) {
                    message += `\n🔤 Транскрипция: ${userState.tempTranscription}`;
                }
                
                message += '\n\n🎵 Доступно аудио произношение\n\nВыберите действие:';
                
                await bot.sendMessage(chatId, message, getListeningKeyboard(userState.tempAudioId));
                await showMainMenu(chatId);
            } catch (error) {
                console.error('❌ Error canceling translation:', error);
                await bot.sendMessage(chatId, '❌ Ошибка при отмене');
            }
        }
    }
});

// Обработка ошибок
bot.on('error', (error) => {
    console.error('❌ Bot error:', error);
});

bot.on('polling_error', (error) => {
    console.error('❌ Polling error:', error);
});

console.log('🤖 Бот запущен с исправленной логикой сохранения и Яндекс API');
