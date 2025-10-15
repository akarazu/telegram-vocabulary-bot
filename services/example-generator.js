import axios from 'axios';

export class ExampleGeneratorService {
    constructor() {
        console.log('🔧 ExampleGeneratorService initialized - Using Free Dictionary API + Part-of-Speech Examples');
    }

    async generateExamples(word, translation, partOfSpeech = '') {
        console.log(`\n🔄 ========== GENERATING EXAMPLES ==========`);
        console.log(`🔄 Input: word="${word}", translation="${translation}", partOfSpeech="${partOfSpeech}"`);
        
        // ✅ ПЕРВОЕ: пробуем Free Dictionary API
        try {
            console.log('🔍 PRIMARY: Trying Free Dictionary API for examples...');
            const freeDictExamples = await this.getFreeDictionaryExamples(word);
            if (freeDictExamples && freeDictExamples.length > 0) {
                console.log(`✅ PRIMARY SUCCESS: Found ${freeDictExamples.length} examples from Free Dictionary`);
                return freeDictExamples;
            } else {
                console.log('❌ PRIMARY FAILED: No examples found in Free Dictionary');
                return this.generatePartOfSpeechExamples(word, translation, partOfSpeech);
            }
        } catch (error) {
            console.log('❌ PRIMARY ERROR: Free Dictionary API failed:', error.message);
            return this.generatePartOfSpeechExamples(word, translation, partOfSpeech);
        }
    }

    async getFreeDictionaryExamples(word) {
        try {
            console.log(`🔍 Free Dictionary API call for: "${word}"`);
            
            const encodedWord = encodeURIComponent(word.toLowerCase());
            const response = await axios.get(
                `https://api.dictionaryapi.dev/api/v2/entries/en/${encodedWord}`,
                { timeout: 5000 }
            );

            console.log('✅ Free Dictionary API response received');
            return this.extractExamplesFromFreeDictionary(response.data, word);
            
        } catch (error) {
            if (error.response && error.response.status === 404) {
                console.log(`❌ Free Dictionary: Word "${word}" not found (404)`);
            } else {
                console.error('❌ Free Dictionary API error:', error.message);
            }
            return [];
        }
    }

    extractExamplesFromFreeDictionary(data, originalWord) {
        if (!data || !Array.isArray(data) || data.length === 0) {
            console.log('❌ No entries found in Free Dictionary response');
            return [];
        }

        console.log(`📊 Found ${data.length} entry/entries`);

        const examples = [];
        let exampleCount = 0;

        data.forEach((entry) => {
            if (entry.meanings && Array.isArray(entry.meanings)) {
                entry.meanings.forEach((meaning) => {
                    if (meaning.definitions && Array.isArray(meaning.definitions)) {
                        meaning.definitions.forEach((definition) => {
                            if (exampleCount >= 3) return;
                            
                            if (definition.example && definition.example.trim()) {
                                const englishExample = definition.example.trim();
                                const formattedExample = `${englishExample} - Пример использования`;
                                examples.push(formattedExample);
                                exampleCount++;
                                console.log(`✅ Free Dictionary example: "${formattedExample}"`);
                            }
                        });
                    }
                });
            }
        });

        console.log(`📊 Extracted ${examples.length} examples from Free Dictionary`);
        return examples;
    }

    generatePartOfSpeechExamples(word, translation, partOfSpeech = '') {
        console.log(`✏️ Generating part-of-speech examples for: "${partOfSpeech}"`);
        
        const lowerWord = word.toLowerCase();
        const lowerPOS = partOfSpeech.toLowerCase();
        
        // ✅ ПРИМЕРЫ В ЗАВИСИМОСТИ ОТ ЧАСТИ РЕЧИ
        if (this.isNoun(lowerPOS)) {
            return this.generateNounExamples(word, translation);
        } else if (this.isVerb(lowerPOS)) {
            return this.generateVerbExamples(word, translation);
        } else if (this.isAdjective(lowerPOS)) {
            return this.generateAdjectiveExamples(word, translation);
        } else if (this.isAdverb(lowerPOS)) {
            return this.generateAdverbExamples(word, translation);
        } else {
            // Если часть речи не определена, используем общие примеры
            return this.generateGeneralExamples(word, translation);
        }
    }

    // ✅ СУЩЕСТВИТЕЛЬНЫЕ (nouns)
    generateNounExamples(word, translation) {
        console.log('📘 Generating noun examples');
        
        return [
            `I bought a new ${word} yesterday. - Я купил новый ${translation} вчера.`,
            `The ${word} is on the table. - ${this.capitalizeFirst(translation)} на столе.`,
            `This ${word} is very expensive. - Этот ${translation} очень дорогой.`,
            `She has three ${word}s. - У нее три ${translation}.`,
            `I need to find my ${word}. - Мне нужно найти мой ${translation}.`
        ].slice(0, 3);
    }

    // ✅ ГЛАГОЛЫ (verbs)
    generateVerbExamples(word, translation) {
        console.log('📗 Generating verb examples');
        
        return [
            `I need to ${word} every day. - Мне нужно ${translation} каждый день.`,
            `Can you ${word} this for me? - Ты можешь ${translation} это для меня?`,
            `She will ${word} tomorrow. - Она будет ${translation} завтра.`,
            `They like to ${word} together. - Они любят ${translation} вместе.`,
            `I can ${word} very well. - Я умею ${translation} очень хорошо.`
        ].slice(0, 3);
    }

    // ✅ ПРИЛАГАТЕЛЬНЫЕ (adjectives)
    generateAdjectiveExamples(word, translation) {
        console.log('📙 Generating adjective examples');
        
        return [
            `This is a very ${word} book. - Это очень ${translation} книга.`,
            `She looks ${word} today. - Она выглядит ${translation} сегодня.`,
            `The weather is ${word}. - Погода ${translation}.`,
            `He seems ${word}. - Он кажется ${translation}.`,
            `It's ${word} outside. - На улице ${translation}.`
        ].slice(0, 3);
    }

    // ✅ НАРЕЧИЯ (adverbs)
    generateAdverbExamples(word, translation) {
        console.log('📒 Generating adverb examples');
        
        return [
            `He speaks ${word}. - Он говорит ${translation}.`,
            `She works ${word}. - Она работает ${translation}.`,
            `They arrived ${word}. - Они прибыли ${translation}.`,
            `Please drive ${word}. - Пожалуйста, веди машину ${translation}.`,
            `He answered ${word}. - Он ответил ${translation}.`
        ].slice(0, 3);
    }

    // ✅ ОБЩИЕ ПРИМЕРЫ (когда часть речи не определена)
    generateGeneralExamples(word, translation) {
        console.log('📓 Generating general examples');
        
        // Проверяем специальные категории слов
        const lowerWord = word.toLowerCase();
        
        // Месяцы
        const months = ['january', 'february', 'march', 'april', 'may', 'june', 
                       'july', 'august', 'september', 'october', 'november', 'december'];
        if (months.includes(lowerWord)) {
            return [
                `My birthday is in ${word}. - Мой день рождения в ${translation}.`,
                `We are going on vacation in ${word}. - Мы едем в отпуск в ${translation}.`,
                `${word} is my favorite month. - ${this.capitalizeFirst(translation)} мой любимый месяц.`
            ];
        }
        
        // Дни недели
        const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        if (days.includes(lowerWord)) {
            return [
                `I have a meeting on ${word}. - У меня встреча в ${translation}.`,
                `See you next ${word}. - Увидимся в следующий ${translation}.`,
                `${word} is usually a busy day. - ${this.capitalizeFirst(translation)} обычно занятой день.`
            ];
        }
        
        // Общие примеры
        return [
            `I often use the word "${word}" in English. - Я часто использую слово "${translation}" в английском.`,
            `Can you explain "${word}"? - Можете объяснить "${translation}"?`,
            `This is an example of "${word}" usage. - Это пример использования "${translation}".`
        ];
    }

    // ✅ ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ ДЛЯ ОПРЕДЕЛЕНИЯ ЧАСТИ РЕЧИ
    isNoun(pos) {
        const nounIndicators = ['noun', 'существительное', 'n', 'сущ'];
        return nounIndicators.some(indicator => pos.includes(indicator));
    }

    isVerb(pos) {
        const verbIndicators = ['verb', 'глагол', 'v', 'гл'];
        return verbIndicators.some(indicator => pos.includes(indicator));
    }

    isAdjective(pos) {
        const adjectiveIndicators = ['adjective', 'прилагательное', 'adj', 'прил'];
        return adjectiveIndicators.some(indicator => pos.includes(indicator));
    }

    isAdverb(pos) {
        const adverbIndicators = ['adverb', 'наречие', 'adv', 'нар'];
        return adverbIndicators.some(indicator => pos.includes(indicator));
    }

    capitalizeFirst(string) {
        return string.charAt(0).toUpperCase() + string.slice(1);
    }

    formatExamplesForDisplay(examples) {
        if (!examples || !Array.isArray(examples) || examples.length === 0) {
            return 'Примеры не найдены';
        }
        return examples.map((example, index) => `${index + 1}. ${example}`).join('\n');
    }

    formatExamplesForStorage(examples) {
        if (!examples || !Array.isArray(examples) || examples.length === 0) {
            return '';
        }
        return examples.join(' | ');
    }
}
