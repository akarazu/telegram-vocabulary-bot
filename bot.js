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
                ['➕ Добавить слово']
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

// Клавиатура действий после прослушивания (без кнопки "Вернуться к слову")
function getAfterAudioKeyboard() {
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: '✏️ Ввести перевод', callback_data: 'enter_translation' }]
            ]
        }
    };
}

// Функция для проверки, есть ли предыдущие аудио в чате
function hasPreviousAudios(chatId, currentAudioUrl) {
    if (!sentAudios.has(chatId)) {
        console.log(`❌ No audio history for chat ${chatId}`);
        return false;
    }
    
    const chatAudios = sentAudios.get(chatId);
    console.log(`📊 Audio history for chat ${chatId}:`, chatAudios);
    
    // Ищем аудио, которые НЕ являются текущим
    const previousAudios = chatAudios.filter(audio => audio.url !== currentAudioUrl);
    console.log(`🔍 Previous audios (excluding current):`, previousAudios);
    
    // Если есть хотя бы одно другое аудио - возвращаем true
    const hasPrevious = previousAudios.length > 0;
    console.log(`🎯 Has previous audios: ${hasPrevious}`);
    
    return hasPrevious;
}

// Функция для добавления аудио в историю чата
function addAudioToHistory(chatId, audioUrl, word) {
    if (!sentAudios.has(chatId)) {
        sentAudios.set(chatId, []);
        console.log(`🆕 Created audio history for chat ${chatId}`);
    }
    
    const chatAudios = sentAudios.get(chatId);
    
    // Проверяем, нет ли уже такого аудио в истории
    const existingAudioIndex = chatAudios.findIndex(audio => audio.url === audioUrl);
    if (existingAudioIndex !== -1) {
        // Обновляем существующее аудио
        chatAudios[existingAudioIndex] = {
            url: audioUrl,
            word: word,
            timestamp: Date.now()
        };
        console.log(`🔄 Updated existing audio in history: ${word}`);
    } else {
        // Добавляем новое аудио
        chatAudios.push({
            url: audioUrl,
            word: word,
            timestamp: Date.now()
        });
        console.log(`✅ Added new audio to history: ${word}`);
    }
    
    // Ограничиваем историю последними 10 аудио (чтобы не накапливать)
    if (chatAudios.length > 10) {
        chatAudios.shift();
        console.log(`🧹 Trimmed audio history to 10 items`);
    }
    
    console.log(`📋 Current history size for chat ${chatId}: ${chatAudios.length}`);
}

// Команда /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, 
        '📚 Англо-русский словарь\n' +
        '🔤 С транскрипцией и произношением\n' +
        '🇬🇧 Британский вариант',
        getMainMenu()
    );
});

// Обработка сообщений
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // Игнорируем команды
    if (text.startsWith('/')) return;

    const userState = userStates.get(chatId);

    if (text === '➕ Добавить слово') {
        userStates.set(chatId, { state: 'waiting_english' });
        bot.sendMessage(chatId, '🇬🇧 Введите английское слово:');
    }
    else if (userState?.state === 'waiting_english') {
        const englishWord = text.trim();
        
        // Проверяем что это английское слово
        if (!/^[a-zA-Z\s\-']+$/.test(englishWord)) {
            bot.sendMessage(chatId, 
                '❌ Это не похоже на английское слово.\n' +
                'Пожалуйста, введите слово на английском:'
            );
            return;
        }
        
        bot.sendMessage(chatId, '🔍 Ищу транскрипцию и произношение...');
        
        const result = await transcriptionService.getUKTranscription(englishWord);
        
        // Сохраняем audioUrl во временное хранилище
        let audioId = null;
        if (result.audioUrl) {
            audioId = Date.now().toString();
        }
        
        // СОХРАНЯЕМ ВСЕ ДАННЫЕ В СОСТОЯНИИ
        userStates.set(chatId, {
            state: 'showing_transcription',
            tempWord: englishWord,
            tempTranscription: result.transcription,
            tempAudioUrl: result.audioUrl,
            tempAudioId: audioId
        });
        
        let message = `📝 Слово: <b>${englishWord}</b>`;
        
        if (result.transcription) {
            message += `\n🔤 Транскрипция: <code>${result.transcription}</code>`;
        } else {
            message += `\n❌ Транскрипция не найдена`;
        }
        
        if (result.audioUrl) {
            message += `\n\n🎵 Доступно аудио произношение`;
        }
        
        message += `\n\nВыберите действие:`;
        
        await bot.sendMessage(chatId, message, {
            parse_mode: 'HTML',
            ...getListeningKeyboard(audioId)
        });
    }
    else if (userState?.state === 'waiting_translation') {
        // Пользователь вводит перевод
        const translation = text.trim();
        
        if (!translation) {
            bot.sendMessage(chatId, '❌ Перевод не может быть пустым. Введите перевод:');
            return;
        }
        
        // ИСПОЛЬЗУЕМ СОХРАНЕННУЮ ТРАНСКРИПЦИЮ ИЗ СОСТОЯНИЯ
        const success = await sheetsService.addWord(
            chatId, 
            userState.tempWord, 
            userState.tempTranscription,
            translation,
            userState.tempAudioUrl
        );
        
        // Очищаем состояние ПОСЛЕ успешного сохранения
        userStates.delete(chatId);
        
        if (success) {
            // ИСПОЛЬЗУЕМ ТУ ЖЕ ТРАНСКРИПЦИЮ ДЛЯ СООБЩЕНИЯ
            const transcriptionText = userState.tempTranscription ? ` [${userState.tempTranscription}]` : '';
            
            // Отправляем сообщение об успешном добавлении
            await bot.sendMessage(chatId, 
                `✅ <b>Слово добавлено в словарь!</b>\n\n` +
                `💬 ${userState.tempWord}${transcriptionText} - <b>${translation}</b>\n\n` +
                `Теперь оно будет доступно для повторения.`,
                { 
                    parse_mode: 'HTML',
                    ...getMainMenu() 
                }
            );
        } else {
            await bot.sendMessage(chatId, 
                '❌ <b>Ошибка сохранения</b>\n\nНе удалось сохранить слово в словарь. Попробуйте еще раз.',
                { 
                    parse_mode: 'HTML',
                    ...getMainMenu() 
                }
            );
        }
    }
    else {
        // Если нет активного состояния И сообщение не команда, показываем главное меню
        await bot.sendMessage(chatId, 'Выберите действие:', getMainMenu());
    }
});

// Обработка inline кнопок
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;
    const userState = userStates.get(chatId);

    // Всегда подтверждаем callback без текста
    await bot.answerCallbackQuery(callbackQuery.id);

    if (data.startsWith('audio_')) {
        const audioId = data.replace('audio_', '');
        const audioUrl = userState?.tempAudioUrl;
        const englishWord = userState?.tempWord;
        
        if (audioUrl && englishWord) {
            try {
                console.log(`🎵 Processing audio for: ${englishWord}`);
                console.log(`🔗 Audio URL: ${audioUrl}`);
                
                // Убираем кнопки из исходного сообщения
                await bot.editMessageReplyMarkup(
                    { inline_keyboard: [] },
                    {
                        chat_id: chatId,
                        message_id: callbackQuery.message.message_id
                    }
                );

                // ✅ СНАЧАЛА добавляем аудио в историю (перед проверкой!)
                console.log(`📥 Adding audio to history...`);
                addAudioToHistory(chatId, audioUrl, englishWord);
                
                // ✅ ТЕПЕРЬ проверяем, есть ли предыдущие аудио
                console.log(`🔍 Checking for previous audios...`);
                const hasPrevious = hasPreviousAudios(chatId, audioUrl);
                
                // Отправляем аудио сообщение
                await bot.sendAudio(chatId, audioUrl, {
                    caption: `🔊 Британское произношение: ${englishWord}`
                });

                // ✅ ЕСЛИ ЕСТЬ ПРЕДЫДУЩИЕ АУДИО - показываем инструкцию
                if (hasPrevious) {
                    console.log(`⚠️ Showing warning for previous audios`);
                    await bot.sendMessage(chatId,
                        '⚠️ **Чтобы избежать автовоспроизведения старых аудио:**\n\n' +
                        '📱 **На Android:**\n' +
                        '• Нажмите кнопку "Назад" после прослушивания\n' +
                        '• Или закройте плеер свайпом вниз\n\n' +
                        '📱 **На iOS:**\n' +
                        '• Свайпните плеер вниз\n' +
                        '• Или нажмите "Закрыть"\n\n' +
                        '💡 *Это нужно сделать только если начали играть старые слова*',
                        { parse_mode: 'Markdown' }
                    );
                } else {
                    console.log(`✅ No previous audios, skipping warning`);
                }
                
                // Отправляем сообщение с кнопками действий после аудио
                await bot.sendMessage(chatId, 
                    '🎵 Вы прослушали произношение. Хотите ввести перевод?',
                    getAfterAudioKeyboard()
                );
                
            } catch (error) {
                console.error('Error sending audio:', error);
            }
        }
    }
    else if (data === 'enter_translation') {
        if (userState?.state === 'showing_transcription') {
            // Убираем кнопки из исходного сообщения
            await bot.editMessageReplyMarkup(
                { inline_keyboard: [] },
                {
                    chat_id: chatId,
                    message_id: callbackQuery.message.message_id
                }
            );

            // Переходим к вводу перевода - СОХРАНЯЕМ ВСЕ ДАННЫЕ
            userStates.set(chatId, {
                ...userState,
                state: 'waiting_translation'
            });
            
            // Отправляем новое сообщение с запросом перевода
            let translationMessage = `✏️ <b>Введите перевод для слова:</b>\n\n` +
                `🇬🇧 <b>${userState.tempWord}</b>`;
            
            if (userState.tempTranscription) {
                translationMessage += `\n🔤 Транскрипция: <code>${userState.tempTranscription}</code>`;
            }
            
            translationMessage += `\n\n📝 <i>Напишите перевод и отправьте сообщением</i>`;
            
            await bot.sendMessage(chatId, translationMessage, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔙 Отменить', callback_data: 'cancel_translation' }]
                    ]
                }
            });
        }
    }
    else if (data === 'cancel_translation') {
        // Отмена ввода перевода
        if (userState) {
            // Убираем кнопки из сообщения с запросом перевода
            await bot.editMessageReplyMarkup(
                { inline_keyboard: [] },
                {
                    chat_id: chatId,
                    message_id: callbackQuery.message.message_id
                }
            );

            // Возвращаемся к состоянию показа транскрипции
            userStates.set(chatId, {
                ...userState,
                state: 'showing_transcription'
            });
            
            const message = `📝 Слово: <b>${userState.tempWord}</b>\n` +
                (userState.tempTranscription ? `🔤 Транскрипция: <code>${userState.tempTranscription}</code>\n\n` : '\n') +
                '🎵 Доступно аудио произношение\n\n' +
                'Выберите действие:';
            
            await bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
                ...getListeningKeyboard(userState.tempAudioId)
            });
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

console.log('🤖 Бот запущен с отладочной информацией по аудио истории');
