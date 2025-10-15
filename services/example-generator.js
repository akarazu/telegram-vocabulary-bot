import axios from 'axios';

export class ExampleGeneratorService {
    constructor() {
        console.log('🔧 ExampleGeneratorService initialized - Using Yandex Part-of-Speech only');
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
                return this.generateYandexPartOfSpeechExamples(word, translation, partOfSpeech);
            }
        } catch (error) {
            console.log('❌ PRIMARY ERROR: Free Dictionary API failed:', error.message);
            return this.generateYandexPartOfSpeechExamples(word, translation, partOfSpeech);
        }
    }

    generateYandexPartOfSpeechExamples(word, translation, partOfSpeech = '') {
        console.log(`✏️ Generating examples using Yandex part of speech: "${partOfSpeech}"`);
        
        const lowerPOS = partOfSpeech.toLowerCase();
        
        // ✅ ИСПОЛЬЗУЕМ ТОЛЬКО ЧАСТЬ РЕЧИ ИЗ YANDEX
        if (this.isNoun(lowerPOS)) {
            console.log('📘 Using noun examples from Yandex');
            return this.generateNounExamples(word, translation);
        } else if (this.isVerb(lowerPOS)) {
            console.log('📗 Using verb examples from Yandex');
            return this.generateVerbExamples(word, translation);
        } else if (this.isAdjective(lowerPOS)) {
            console.log('📙 Using adjective examples from Yandex');
            return this.generateAdjectiveExamples(word, translation);
        } else if (this.isAdverb(lowerPOS)) {
            console.log('📒 Using adverb examples from Yandex');
            return this.generateAdverbExamples(word, translation);
        } else {
            // Если Яндекс не определил часть речи или она неизвестна
            console.log('❓ Yandex part of speech unknown or not detected, using general examples');
            return this.generateGeneralExamples(word, translation);
        }
    }

    // ✅ ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ ДЛЯ ОПРЕДЕЛЕНИЯ ЧАСТИ РЕЧИ ИЗ YANDEX
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

    // ✅ СУЩЕСТВИТЕЛЬНЫЕ (nouns)
    generateNounExamples(word, translation) {
        // Берем первый перевод для примеров
        const mainTranslation = translation.split(',')[0].trim();
        
        return [
            `The ${word} was unexpected. - ${this.capitalizeFirst(mainTranslation)} было неожиданным.`,
            `They investigated the ${word}. - Они расследовали ${mainTranslation}.`,
            `This ${word} caused many problems. - Это ${mainTranslation} вызвало много проблем.`
        ];
    }

    // ✅ ГЛАГОЛЫ (verbs)
    generateVerbExamples(word, translation) {
        // Берем первый перевод для примеров
        const mainTranslation = translation.split(',')[0].trim();
        
        return [
            `They will ${word} the car. - Они будут ${mainTranslation} машину.`,
            `Don't ${word} everything! - Не ${mainTranslation} всё!`,
            `He likes to ${word} old buildings. - Он любит ${mainTranslation} старые здания.`
        ];
    }

    // ✅ ПРИЛАГАТЕЛЬНЫЕ (adjectives)
    generateAdjectiveExamples(word, translation) {
        // Берем первый перевод для примеров
        const mainTranslation = translation.split(',')[0].trim();
        
        return [
            `This is a ${word} situation. - Это ${mainTranslation} ситуация.`,
            `She looks ${word} today. - Она выглядит ${mainTranslation} сегодня.`,
            `The weather is ${word}. - Погода ${mainTranslation}.`
        ];
    }

    // ✅ НАРЕЧИЯ (adverbs)
    generateAdverbExamples(word, translation) {
        // Берем первый перевод для примеров
        const mainTranslation = translation.split(',')[0].trim();
        
        return [
            `He speaks ${word}. - Он говорит ${mainTranslation}.`,
            `She works ${word}. - Она работает ${mainTranslation}.`,
            `They arrived ${word}. - Они прибыли ${mainTranslation}.`
        ];
    }

    // ✅ ОБЩИЕ ПРИМЕРЫ (когда часть речи не определена)
    generateGeneralExamples(word, translation) {
        // Берем первый перевод для примеров
        const mainTranslation = translation.split(',')[0].trim();
        
        return [
            `I often use the word "${word}" in English. - Я часто использую слово "${mainTranslation}" в английском.`,
            `Can you explain "${word}"? - Можете объяснить "${mainTranslation}"?`,
            `This is an example of "${word}" usage. - Это пример использования "${mainTranslation}".`
        ];
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
