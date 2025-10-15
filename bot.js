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

// Клавиатура для ручного ввода перевода
function getManualTranslationKeyboard() {
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: '💾 Сохранить перевод', callback_data: 'save_manual_translation' }],
                [{ text: '🔙 Назад к выбору', callback_data: 'back_to_selection' }]
            ]
        }
    };
}

// Функция для принудительного показа меню
function showMainMenu(chatId, text = '') {
    if (text && text.trim() !== '') {
        return bot.sendMessage(chatId, text, getMainMenu());
    } else {
        return bot.sendMessage(chatId, ' ', getMainMenu());
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

// Функция для сохранения слова с переводом
async function saveWordWithTranslation(chatId, userState, translation) {
    let success = true;
    
    if (sheetsService.initialized) {
        const existingWords = await sheetsService.getUserWords(chatId);
        const isDuplicate = existingWords.some(word => 
            word.english.toLowerCase() === userState.tempWord.toLowerCase()
        );
        
        if (isDuplicate) {
            showMainMenu(chatId, 
                `❌ Слово "${userState.tempWord}" уже было добавлено в словарь!\n\n` +
                'Пожалуйста, начните заново.'
            );
            userStates.delete(chatId);
            return;
        }
        
        success = await sheetsService.addWord(
            chatId, 
            userState.tempWord, 
            userState.tempTranscription,
            translation,
            userState.tempAudioUrl
        );
    }
    
    userStates.delete(chatId);
    
    if (success) {
        const transcriptionText = userState.tempTranscription ? ` [${userState.tempTranscription}]` : '';
        
        showMainMenu(chatId, 
            '✅ Слово добавлено в словарь!\n\n' +
            `💬 ${userState.tempWord}${transcriptionText} - ${translation}\n\n` +
            'Теперь оно будет доступно для повторения.'
        );
    } else {
        showMainMenu(chatId, 
            '❌ Ошибка сохранения\n\nНе удалось сохранить слово в словарь. Попробуйте еще раз.'
        );
    }
}

// Команда /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    showMainMenu(chatId, 
        '📚 Англо-русский словарь\n' +
        '🔤 С транскрипцией и произношением\n' +
        '🇬🇧 Британский вариант'
    );
});

// Обработка сообщений
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (text.startsWith('/')) return;

    const userState = userStates.get(chatId);

    if (text === '➕ Добавить новое слово') {
        userStates.set(chatId, { state: 'waiting_english' });
        showMainMenu(chatId, '🇬🇧 Введите английское слово:');
    }
    else if (userState?.state === 'waiting_english') {
        const englishWord = text.trim().toLowerCase();
        
        // Проверяем что это английское слово
        if (!/^[a-zA-Z\s\-']+$/.test(englishWord)) {
            showMainMenu(chatId, 
                '❌ Это не похоже на английское слово.\n' +
                'Пожалуйста, введите слово на английском:'
            );
            return;
        }
        
        // ПРОВЕРКА GOOGLE SHEETS И ДУБЛИКАТОВ
        if (!sheetsService.initialized) {
            showMainMenu(chatId, 
                '❌ Сервис словаря временно недоступен\n\n' +
                'Попробуйте позже или продолжите без проверки дубликатов.'
            );
            // Пропускаем проверку дубликатов и продолжаем
        } else {
            const existingWords = await sheetsService.getUserWords(chatId);
            const isDuplicate = existingWords.some(word => 
                word.english.toLowerCase() === englishWord.toLowerCase()
            );
            
            if (isDuplicate) {
                showMainMenu(chatId, 
                    `❌ Слово "${englishWord}" уже есть в вашем словаре!\n\n` +
                    'Пожалуйста, введите другое слово:'
                );
                return;
            }
        }
        
        showMainMenu(chatId, '🔍 Ищу транскрипцию, произношение и варианты перевода...');
        
        const result = await transcriptionService.getUKTranscription(englishWord);
        
        let audioId = null;
        if (result.audioUrl) {
            audioId = Date.now().toString();
        }
        
        userStates.set(chatId, {
            state: 'showing_transcription',
            tempWord: englishWord,
            tempTranscription: result.transcription,
            tempAudioUrl: result.audioUrl,
            tempAudioId: audioId,
            tempTranslations: result.translations || [],
            selectedTranslationIndices: [] // Новое поле для хранения выбранных вариантов
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
        
        message += `\n\nВыберите действие:`;
        
        await bot.sendMessage(chatId, message, getListeningKeyboard(audioId));
        showMainMenu(chatId);
    }
    else if (userState?.state === 'waiting_manual_translation') {
        const translation = text.trim();
        
        if (!translation) {
            showMainMenu(chatId, '❌ Перевод не может быть пустым. Введите перевод:');
            return;
        }
        
        // Сохраняем ручной перевод
        await saveWordWithTranslation(chatId, userState, translation);
    }
    else {
        showMainMenu(chatId);
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
                
                showMainMenu(chatId);
                
            } catch (error) {
                console.error('Error sending audio:', error);
            }
        }
    }
    else if (data === 'enter_translation') {
        if (userState?.state === 'showing_transcription') {
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
                
                translationMessage += '\n\n💡 Можно ввести несколько вариантов через запятую\nНапример: солнце, светило, солнечный свет';
                
                showMainMenu(chatId, translationMessage);
            }
        }
    }
    else if (data.startsWith('toggle_translation_')) {
        const translationIndex = parseInt(data.replace('toggle_translation_', ''));
        
        if (userState?.state === 'choosing_translation' && userState.tempTranslations[translationIndex]) {
            let selectedIndices = [...(userState.selectedTranslationIndices || [])];
            
            // Переключаем выбор
            if (selectedIndices.includes(translationIndex)) {
                // Убираем из выбранных
                selectedIndices = selectedIndices.filter(idx => idx !== translationIndex);
            } else {
                // Добавляем в выбранные
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
        }
    }
    else if (data === 'save_selected_translations') {
        if (userState?.state === 'choosing_translation' && userState.selectedTranslationIndices.length > 0) {
            // Получаем выбранные переводы
            const selectedTranslations = userState.selectedTranslationIndices
                .map(index => userState.tempTranslations[index]);
            
            // Объединяем через запятую для сохранения в таблице
            const translationToSave = selectedTranslations.join(', ');
            
            // Сохраняем слово
            await saveWordWithTranslation(chatId, userState, translationToSave);
            
            // Удаляем сообщение с выбором переводов
            await bot.deleteMessage(chatId, callbackQuery.message.message_id);
        }
    }
    else if (data === 'custom_translation') {
        if (userState?.state === 'choosing_translation') {
            userStates.set(chatId, {
                ...userState,
                state: 'waiting_manual_translation'
            });
            
            let translationMessage = '✏️ Введите свой вариант перевода:\n\n' +
                `🇬🇧 ${userState.tempWord}`;
            
            if (userState.tempTranscription) {
                translationMessage += `\n🔤 Транскрипция: ${userState.tempTranscription}`;
            }
            
            translationMessage += '\n\n💡 Можно ввести несколько вариантов через запятую\nНапример: солнце, светило, солнечный свет';
            
            // Удаляем предыдущее сообщение с выбором
            await bot.deleteMessage(chatId, callbackQuery.message.message_id);
            
            showMainMenu(chatId, translationMessage);
        }
    }
    else if (data === 'save_manual_translation') {
        // Эта кнопка теперь не используется, так как ручной перевод сохраняется автоматически при отправке сообщения
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Просто отправьте перевод сообщением' });
    }
    else if (data === 'back_to_selection') {
        if (userState?.state === 'waiting_manual_translation' && userState.tempTranslations.length > 0) {
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
            showMainMenu(chatId);
        }
    }
    else if (data === 'cancel_translation') {
        if (userState) {
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
            showMainMenu(chatId);
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

console.log('🤖 Бот запущен с улучшенной системой выбора переводов');
