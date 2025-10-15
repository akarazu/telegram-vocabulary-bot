import axios from 'axios';

export class ExampleGeneratorService {
    constructor() {
        this.yandexApiKey = process.env.YANDEX_DICTIONARY_API_KEY;
    }

    async generateExamples(word, selectedTranslation = null) {
        try {
            console.log(`🤖 Generating examples for: "${word}" with translation: "${selectedTranslation}"`);
            
            // Если есть выбранный перевод, генерируем контекстные примеры
            if (selectedTranslation) {
                console.log(`🔧 Generating contextual examples for: "${selectedTranslation}"`);
                return this.generateContextualExamples(word, selectedTranslation);
            }
            
            // Если нет перевода, возвращаем пустой массив - примеры не показываем
            console.log('🔧 No translation selected, skipping examples');
            return [];
            
        } catch (error) {
            console.error('❌ Error generating examples:', error.message);
            return [];
        }
    }

    generateContextualExamples(word, translation) {
        // Генерируем контекстные примеры на основе перевода
        const examples = [];
        
        // Определяем тип слова по переводу
        const isVerb = translation.includes('глагол') || translation.match(/\b(verb|to\s+\w+)\b/i);
        const isNoun = translation.includes('существительное') || translation.match(/\b(noun|the\s+\w+)\b/i);
        const isAdjective = translation.includes('прилагательное') || translation.match(/\b(adjective)\b/i);
        
        if (isVerb) {
            examples.push(
                `You should ${word} regularly to maintain good habits.`,
                `She will ${word} the proposal before the meeting.`,
                `They have ${word}ed together on many projects.`
            );
        } 
        else if (isNoun) {
            examples.push(
                `The ${word} was placed on the shelf.`,
                `We need to discuss this ${word} in detail.`,
                `Her favorite ${word} is the one she bought yesterday.`
            );
        }
        else if (isAdjective) {
            examples.push(
                `It was a ${word} experience that I'll never forget.`,
                `She has such a ${word} personality that everyone likes her.`,
                `The solution seems ${word} at first glance.`
            );
        }
        else {
            // Общие контекстные примеры
            examples.push(
                `When "${word}" means "${translation}", it can be used like this.`,
                `In the context of "${translation}", here's an example with "${word}".`,
                `For the meaning "${translation}", consider this usage of "${word}".`
            );
        }
        
        console.log(`📝 Generated ${examples.length} contextual examples`);
        return examples.slice(0, 3);
    }
}
