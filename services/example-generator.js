import axios from 'axios';

export class ExampleGeneratorService {
    constructor() {
        this.yandexApiKey = process.env.YANDEX_DICTIONARY_API_KEY;
    }

    async generateExamples(word, translation) {
        try {
            console.log(`🤖 Generating examples for: "${word}" with translation: "${translation}"`);
            
            if (!translation) {
                console.log('❌ No translation provided, skipping examples');
                return [];
            }
            
            // Генерируем контекстные примеры на основе перевода
            const examples = this.generateContextualExamples(word, translation);
            
            console.log(`📝 Generated ${examples.length} examples`);
            return examples;
            
        } catch (error) {
            console.error('❌ Error generating examples:', error.message);
            return this.generateBasicExamples(word, translation);
        }
    }

    generateContextualExamples(word, translation) {
        const examples = [];
        
        // Определяем тип слова по переводу
        const isVerb = translation.includes('глагол') || translation.match(/\b(verb|to\s+\w+)\b/i);
        const isNoun = translation.includes('существительное') || translation.match(/\b(noun|the\s+\w+)\b/i);
        const isAdjective = translation.includes('прилагательное') || translation.match(/\b(adjective)\b/i);
        const isAdverb = translation.includes('наречие') || translation.match(/\b(adverb)\b/i);
        
        if (isVerb) {
            examples.push(
                `You should ${word} regularly to maintain good habits.`,
                `She will ${word} the proposal before the meeting.`,
                `They have ${word}ed together on many projects.`,
                `I need to ${word} more carefully next time.`,
                `Can you show me how to ${word} correctly?`
            );
        } 
        else if (isNoun) {
            examples.push(
                `The ${word} was placed on the shelf.`,
                `We need to discuss this ${word} in detail.`,
                `Her favorite ${word} is the one she bought yesterday.`,
                `The ${word} plays a crucial role in the process.`,
                `I'm looking for a specific ${word} for my collection.`
            );
        }
        else if (isAdjective) {
            examples.push(
                `It was a ${word} experience that I'll never forget.`,
                `She has such a ${word} personality that everyone likes her.`,
                `The solution seems ${word} at first glance.`,
                `This is the most ${word} thing I've ever seen.`,
                `He felt ${word} after hearing the news.`
            );
        }
        else if (isAdverb) {
            examples.push(
                `She spoke ${word} during the presentation.`,
                `He worked ${word} to finish the project on time.`,
                `They arrived ${word} for the meeting.`,
                `The team performed ${word} under pressure.`,
                `You should act ${word} in such situations.`
            );
        }
        else {
            // Общие контекстные примеры
            examples.push(
                `When "${word}" means "${translation}", it can be used like this.`,
                `In the context of "${translation}", here's an example with "${word}".`,
                `For the meaning "${translation}", consider this usage of "${word}".`,
                `As "${translation}", "${word}" commonly appears in such contexts.`,
                `If you understand "${word}" as "${translation}", this example will be helpful.`
            );
        }
        
        // Выбираем 3 случайных примера
        const shuffled = [...examples].sort(() => 0.5 - Math.random());
        return shuffled.slice(0, 3);
    }

    generateBasicExamples(word, translation = null) {
        let basicExamples = [];
        
        if (translation) {
            basicExamples = [
                `When "${word}" means "${translation}", it can be used in various contexts.`,
                `In the sense of "${translation}", here's how "${word}" might be used.`,
                `For the meaning "${translation}", consider this example with "${word}".`
            ];
        } else {
            basicExamples = [
                `I need to use the word "${word}" in my writing.`,
                `Can you explain how to use "${word}" correctly?`,
                `The word "${word}" appears frequently in English texts.`
            ];
        }
        
        const shuffled = [...basicExamples].sort(() => 0.5 - Math.random());
        return shuffled.slice(0, 3);
    }

    async checkApisAvailability() {
        console.log('🔧 Example generator: Contextual examples available');
        return ['Contextual examples'];
    }
}
