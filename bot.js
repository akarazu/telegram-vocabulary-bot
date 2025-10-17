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
    // Создаем заглушки чтобы бот не падал
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

// Клавиатура действий после прослушивания
function getAfterAudioKeyboard() {
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: '✏️ Выбрать перевод', callback_data: 'enter_translation' }]
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

// Клавиатура для выбора переводов с кнопкой "Подробнее" для всех переводов
function getTranslationSelectionKeyboard(translations, meanings, selectedIndices = []) {
    const translationButtons = [];

    translations.forEach((translation, index) => {
        const isSelected = selectedIndices.includes(index);
        
        let numberEmoji;
        if (index < 9) {
            numberEmoji = `${index + 1}️⃣`;
        } else {
            const number = index + 1;
            const digits = number.toString().split('');
            numberEmoji = digits.map(digit => {
                const digitEmojis = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];
                return digitEmojis[parseInt(digit)];
            }).join('');
        }
        
        const emoji = isSelected ? '✅' : numberEmoji;
        
        // Находим английское значение для этого перевода
        const meaningForTranslation = meanings.find(meaning => meaning.translation === translation);
        const englishDefinition = meaningForTranslation?.englishDefinition || '';
        
        // Основная кнопка с переводом
        const mainButtonText = `${emoji} ${translation}`;
        
        // Всегда создаем две кнопки: основную и "Подробнее"
        const row = [
            { 
                text: mainButtonText, 
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
    try {
        if (text && text.trim() !== '') {
            return await bot.sendMessage(chatId, text, getMainMenu());
        } else {
            return await bot.sendMessage(chatId, 'Выберите действие:', getMainMenu());
        }
    } catch (error) {
        console.error('❌ Error showing main menu:', error);
        // Пытаемся отправить простой текст если клавиатура не работает
        try {
            await bot.sendMessage(chatId, text || 'Выберите действие из меню:');
        } catch (e) {
            console.error('❌ Critical error sending message:', e);
        }
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
            // Продолжаем сохранение даже если проверка дубликатов не удалась
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

// Команда для сброса состояния (для отладки)
bot.onText(/\/reset/, async (msg) => {
    const chatId = msg.chat.id;
    userStates.delete(chatId);
    await bot.sendMessage(chatId, '✅ Состояние сброшено. Вы можете начать заново.');
    await showMainMenu(chatId);
});

// Команда для проверки состояния
bot.onText(/\/state/, async (msg) => {
    const chatId = msg.chat.id;
    const userState = userStates.get(chatId);
    await bot.sendMessage(chatId, `📊 Текущее состояние: ${userState ? userState.state : 'нет состояния'}`);
});

// Команда для миграции данных
bot.onText(/\/migrate/, async (msg) => {
    const chatId = msg.chat.id;
    
    if (sheetsService.initialized) {
        await bot.sendMessage(chatId, '🔄 Миграция данных в новый формат...');
        
        const success = await sheetsService.migrateOldDataToNewFormat(chatId);
        
        if (success) {
            await bot.sendMessage(chatId, '✅ Миграция завершена! Теперь все слова в новом формате.');
        } else {
            await bot.sendMessage(chatId, '❌ Ошибка при миграции данных.');
        }
    } else {
        await bot.sendMessage(chatId, '❌ Google Sheets не инициализирован.');
    }
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
        
        console.log(`🔍 Обработка слова: "${englishWord}"`);
        
        // Проверяем доступность сервисов
        if (!cambridgeService || !yandexService) {
            console.error('❌ Сервисы не инициализированы');
            await showMainMenu(chatId, 
                '❌ Сервисы временно недоступны. Попробуйте позже.'
            );
            userStates.delete(chatId);
            return;
        }
        
        // Более гибкая проверка на английское слово
        if (!/^[a-zA-Z\s\-'\.]+$/.test(englishWord)) {
            await showMainMenu(chatId, 
                '❌ Это не похоже на английское слово.\n' +
                'Пожалуйста, введите слово на английском:'
            );
            return;
        }
        
        // Временно убираем проверку дубликатов для отладки
        // if (sheetsService.initialized) {
        //     try {
        //         const existingWords = await sheetsService.getUserWords(chatId);
        //         const isDuplicate = existingWords.some(word => 
        //             word.english.toLowerCase() === englishWord.toLowerCase()
        //         );
        //         
        //         if (isDuplicate) {
        //             await showMainMenu(chatId, 
        //                 `❌ Слово "${englishWord}" уже есть в вашем словаре!\n\n` +
        //                 'Пожалуйста, введите другое слово:'
        //             );
        //             return;
        //         }
        //     } catch (error) {
        //         console.error('Error checking duplicates:', error);
        //     }
        // }
        
        await showMainMenu(chatId, '🔍 Ищу перевод, транскрипцию, произношение и примеры...');
        
        try {
            console.log(`🎯 Начинаем поиск для: "${englishWord}"`);
            
            let audioId = null;
            let transcription = '';
            let audioUrl = '';
            let meanings = [];
            let translations = [];

            // ✅ 1. ПОЛУЧАЕМ ПЕРЕВОДЫ ИЗ CAMBRIDGE
            console.log(`📚 Запрашиваем Cambridge Dictionary...`);
            const cambridgeData = await cambridgeService.getWordData(englishWord);
            
            if (cambridgeData.meanings && cambridgeData.meanings.length > 0) {
                console.log(`✅ Cambridge успешно: ${cambridgeData.meanings.length} значений`);
                meanings = cambridgeData.meanings;
                translations = meanings.map(m => m.translation).filter((t, i, arr) => arr.indexOf(t) === i);
                
                // Логируем найденные переводы для отладки
                console.log(`📝 Найдены переводы:`, translations);
            } else {
                console.log(`❌ Cambridge не вернул переводы`);
                // Создаем пустой массив, чтобы перейти к ручному вводу
                meanings = [];
                translations = [];
            }

            // ✅ 2. ПОЛУЧАЕМ ТРАНСКРИПЦИЮ И АУДИО ОТ ЯНДЕКСА
            console.log(`🔤 Запрашиваем транскрипцию у Яндекс...`);
            try {
                const yandexData = await yandexService.getTranscriptionAndAudio(englishWord);
                transcription = yandexData.transcription || '';
                audioUrl = yandexData.audioUrl || '';
                
                if (audioUrl) {
                    audioId = Date.now().toString();
                }
                console.log(`✅ Яндекс транскрипция: ${transcription}`);
            } catch (yandexError) {
                console.log(`❌ Яндекс не сработал: ${yandexError.message}`);
                // Fallback для аудио
                audioUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(englishWord)}&tl=en-gb&client=tw-ob`;
                audioId = Date.now().toString();
            }

            // ✅ 3. СОХРАНЯЕМ РЕЗУЛЬТАТЫ
            userStates.set(chatId, {
                state: 'showing_transcription',
                tempWord: englishWord,
                tempTranscription: transcription,
                tempAudioUrl: audioUrl,
                tempAudioId: audioId,
                tempTranslations: translations,
                meanings: meanings,
                selectedTranslationIndices: []
            });
            
            // ✅ 4. ФОРМИРУЕМ СООБЩЕНИЕ ДЛЯ ПОЛЬЗОВАТЕЛЯ
            let message = `📝 Слово: ${englishWord}`;
            
            if (transcription) {
                message += `\n🔤 Транскрипция: ${transcription}`;
            } else {
                message += `\n❌ Транскрипция не найдена`;
            }
            
            if (audioUrl) {
                message += `\n\n🎵 Доступно аудио произношение`;
            } else {
                message += `\n\n❌ Аудио произношение не найдено`;
            }

            if (translations.length > 0) {
                message += `\n\n🎯 Найдено ${translations.length} вариантов перевода из Cambridge Dictionary`;
                
                // ✅ ПОКАЗЫВАЕМ НАЙДЕННЫЕ ПРИМЕРЫ
                const totalExamples = meanings.reduce((total, meaning) => 
                    total + (meaning.examples ? meaning.examples.length : 0), 0
                );
                if (totalExamples > 0) {
                    message += `\n📝 Найдено ${totalExamples} примеров использования`;
                }
            } else {
                message += `\n\n❌ Переводы не найдены в Cambridge Dictionary\n✏️ Вы можете добавить свой перевод`;
            }
            
            message += `\n\nВыберите действие:`;
            
            await bot.sendMessage(chatId, message, getListeningKeyboard(audioId));
            await showMainMenu(chatId);
            
        } catch (error) {
            console.error('Error getting word data:', error);
            await showMainMenu(chatId, 
                '❌ Ошибка при поиске слова\n\nПопробуйте другое слово или повторите позже.'
            );
            // Очищаем состояние при ошибке
            userStates.delete(chatId);
        }
    }
    // ИЗМЕНЕНО: Новая логика добавления своего перевода
    else if (userState?.state === 'waiting_custom_translation') {
        const customTranslation = text.trim();
        
        if (!customTranslation) {
            await showMainMenu(chatId, '❌ Перевод не может быть пустым. Введите перевод:');
            return;
        }
        
        // Сохраняем введенный перевод и переходим к вводу примера
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
    else if (userState?.state === 'waiting_manual_translation') {
        const translation = text.trim();
        
        if (!translation) {
            await showMainMenu(chatId, '❌ Перевод не может быть пустым. Введите перевод:');
            return;
        }
        
        await saveWordWithMeanings(chatId, userState, [translation]);
    }
    else if (userState?.state === 'waiting_custom_translation_with_selected') {
        const customTranslation = text.trim();
        
        if (!customTranslation) {
            await showMainMenu(chatId, '❌ Перевод не может быть пустым. Введите перевод:');
            return;
        }
        
        // ✅ ИСПРАВЛЕНИЕ: Получаем выбранные переводы из состояния
        const selectedTranslations = userState.selectedTranslationIndices
            .map(index => userState.tempTranslations[index]);
        
        // ✅ ИСПРАВЛЕНИЕ: Добавляем ручной перевод к выбранным
        const allTranslations = [...selectedTranslations, customTranslation];
        
        console.log(`📝 Сохраняем переводы: выбранные = ${selectedTranslations.join(', ')}, ручной = ${customTranslation}, все = ${allTranslations.join(', ')}`);
        
        await saveWordWithMeanings(chatId, userState, allTranslations);
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

                await bot.sendAudio(chatId, audioUrl, {
                    caption: `🔊 Британское произношение: ${englishWord}`
                });
                
                await bot.sendMessage(chatId, 
                    '🎵 Вы прослушали произношение. Хотите выбрать перевод?',
                    getAfterAudioKeyboard()
                );
                
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

                // ✅ ИЗМЕНЕНИЕ: Проверяем есть ли переводы от Cambridge
                if (userState.tempTranslations && userState.tempTranslations.length > 0) {
                    userStates.set(chatId, {
                        ...userState,
                        state: 'choosing_translation',
                        selectedTranslationIndices: []
                    });

                    let translationMessage = '🎯 **Выберите переводы из Cambridge Dictionary:**\n\n' +
                        `🇬🇧 ${userState.tempWord}`;
                    
                    if (userState.tempTranscription) {
                        translationMessage += `\n🔤 Транскрипция: ${userState.tempTranscription}`;
                    }

                    translationMessage += '\n\n💡 Нажмите "🔍 Подробнее" чтобы увидеть английское определение и примеры';

                    await bot.sendMessage(chatId, translationMessage, 
                        getTranslationSelectionKeyboard(userState.tempTranslations, userState.meanings, [])
                    );
                    
                } else {
                    // ✅ ИЗМЕНЕНИЕ: Если переводов нет, сразу переходим к добавлению своего перевода
                    userStates.set(chatId, {
                        ...userState,
                        state: 'waiting_custom_translation'
                    });
                    
                    let translationMessage = '✏️ Cambridge Dictionary не нашел переводов\n\n' +
                        'Добавьте свой перевод для слова:\n\n' +
                        `🇬🇧 ${userState.tempWord}`;
                    
                    if (userState.tempTranscription) {
                        translationMessage += `\n🔤 Транскрипция: ${userState.tempTranscription}`;
                    }
                    
                    translationMessage += '\n\n💡 После ввода перевода вы сможете добавить пример использования';
                    
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
                    getTranslationSelectionKeyboard(userState.tempTranslations, userState.meanings, selectedIndices).reply_markup,
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
    else if (data.startsWith('details_')) {
        const translationIndex = parseInt(data.replace('details_', ''));
        
        if (userState?.state === 'choosing_translation' && userState.tempTranslations[translationIndex]) {
            try {
                const translation = userState.tempTranslations[translationIndex];
                const meaning = userState.meanings.find(m => m.translation === translation);
                
                if (meaning) {
                    let detailsMessage = `🔍 **Подробности перевода:**\n\n`;
                    detailsMessage += `🇬🇧 **Слово:** ${userState.tempWord}\n`;
                    detailsMessage += `🇷🇺 **Перевод:** ${translation}\n\n`;
                    
                    if (meaning.englishDefinition) {
                        detailsMessage += `📖 **Английское определение:**\n${meaning.englishDefinition}\n\n`;
                    }
                    
                    if (meaning.examples && meaning.examples.length > 0) {
                        detailsMessage += `📝 **Примеры использования:**\n`;
                        meaning.examples.forEach((example, index) => {
                            if (index < 3) { // Показываем максимум 3 примера
                                detailsMessage += `\n${index + 1}. ${example.english}`;
                                if (example.russian) {
                                    detailsMessage += `\n   ${example.russian}`;
                                }
                            }
                        });
                    }
                    
                    await bot.sendMessage(chatId, detailsMessage, {
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '🔙 Назад к выбору переводов', callback_data: 'back_to_translations' }]
                            ]
                        }
                    });
                } else {
                    await bot.sendMessage(chatId, '❌ Информация о переводе не найдена');
                }
                
            } catch (error) {
                console.error('Error showing details:', error);
                await bot.sendMessage(chatId, '❌ Ошибка при показе подробностей');
            }
        }
    }
    else if (data === 'back_to_translations') {
        if (userState?.state === 'choosing_translation') {
            try {
                await bot.deleteMessage(chatId, callbackQuery.message.message_id);
                // Сообщение с переводами остается активным
            } catch (error) {
                console.error('Error going back:', error);
            }
        }
    }
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
    else if (data === 'custom_translation') {
        if (userState?.state === 'choosing_translation') {
            try {
                // ИЗМЕНЕНО: Новая логика - переходим к вводу перевода
                userStates.set(chatId, {
                    ...userState,
                    state: 'waiting_custom_translation'
                });
                
                let translationMessage = '✏️ Введите свой вариант перевода:\n\n' +
                    `🇬🇧 ${userState.tempWord}`;
                
                if (userState.tempTranscription) {
                    translationMessage += `\n🔤 Транскрипция: ${userState.tempTranscription}`;
                }
                
                translationMessage += '\n\n💡 После ввода перевода вы сможете добавить пример использования';
                
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

// Обработка необработанных исключений
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
});

console.log('🤖 Бот запущен: Исправленная версия');
