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
// Функция для определения части речи по переводу
async function detectPartOfSpeechFromYandex(word, translation) {
    if (!process.env.YANDEX_DICTIONARY_API_KEY) {
        return detectPartOfSpeech(translation); // fallback на локальную функцию
    }
    
    try {
        const response = await axios.get('https://dictionary.yandex.net/api/v1/dicservice.json/lookup', {
            params: {
                key: process.env.YANDEX_DICTIONARY_API_KEY,
                lang: 'en-ru',
                text: word,
                ui: 'ru'
            },
            timeout: 5000
        });

        if (response.data && response.data.def && response.data.def.length > 0) {
            const firstDefinition = response.data.def[0];
            // Яндекс возвращает часть речи в поле "pos"
            if (firstDefinition.pos) {
                console.log(`✅ Yandex part of speech: ${firstDefinition.pos}`);
                return firstDefinition.pos.toLowerCase();
            }
        }
    } catch (error) {
        console.log('❌ Yandex part of speech detection failed, using fallback');
    }
    
    return detectPartOfSpeech(translation);
}

// Функция для сохранения слова с переводом и примерами
async function saveWordWithTranslation(chatId, userState, translation) {
    console.log(`💾 START Saving word:`, {
        chatId,
        word: userState.tempWord,
        translation: translation,
        partOfSpeech: userState.tempPartOfSpeech // ✅ ЧАСТЬ РЕЧИ ИЗ YANDEX
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
        
        // Генерируем примеры
        console.log('🔄 Generating examples...');
        
        // ✅ ИСПОЛЬЗУЕМ ЧАСТЬ РЕЧИ ИЗ YANDEX (без detectPartOfSpeech)
        const examples = await exampleGenerator.generateExamples(
            userState.tempWord, 
            translation, 
            userState.tempPartOfSpeech // ✅ ПЕРЕДАЕМ ЧАСТЬ РЕЧИ ИЗ YANDEX
        );
        
        console.log(`✅ Generated examples:`, examples);
        
        // ✅ ПРАВИЛЬНО ОБРАБАТЫВАЕМ ПРИМЕРЫ ДЛЯ СОХРАНЕНИЯ
        let examplesText = '';
        if (Array.isArray(examples)) {
            examplesText = examples.join(' | ');
        } else if (typeof examples === 'string') {
            examplesText = examples;
        } else {
            examplesText = examples.map(ex => {
                if (typeof ex === 'string') return ex;
                if (ex.english && ex.russian) return `${ex.english} - ${ex.russian}`;
                return JSON.stringify(ex);
            }).join(' | ');
        }
        
        console.log(`📝 Formatted examples for storage: "${examplesText}"`);
        
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
        
        // ✅ ПРАВИЛЬНО ФОРМАТИРУЕМ ПРИМЕРЫ ДЛЯ ОТОБРАЖЕНИЯ
        // Используем ту же часть речи что и для сохранения
        const examples = await exampleGenerator.generateExamples(
            userState.tempWord, 
            translation, 
            userState.tempPartOfSpeech
        );
        
        if (examples && examples.length > 0) {
            successMessage += '📝 Примеры:\n';
            
            if (Array.isArray(examples)) {
                examples.forEach((ex, index) => {
                    if (typeof ex === 'string') {
                        successMessage += `${index + 1}. ${ex}\n`;
                    } else if (ex.english && ex.russian) {
                        successMessage += `${index + 1}. ${ex.english} - ${ex.russian}\n`;
                    }
                });
            }
            successMessage += '\n';
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
            
            userStates.set(chatId, {
    state: 'showing_transcription',
    tempWord: englishWord,
    tempTranscription: result.transcription || '',
    tempAudioUrl: result.audioUrl || '',
    tempAudioId: audioId,
    tempTranslations: result.translations || [],
    tempPartOfSpeech: result.partOfSpeech || '', // ✅ СОХРАНЯЕМ ЧАСТЬ РЕЧИ
    tempExamples: [],
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
            } else {
                message += `\n\n❌ Переводы не найдены`;
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
                
                // ✅ ПРОВЕРЯЕМ ЧТО АУДИО URL ДОСТУПЕН
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
                console.error('Error sending audio:', error);
                await bot.sendMessage(chatId, '❌ Ошибка при воспроизведении аудио. Возможно, аудиофайл недоступен.');
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

console.log('🤖 Бот запущен с исправленной логикой сохранения');







