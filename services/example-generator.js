import axios from "axios";

export class ExampleGeneratorService {
  constructor() {
    this.openaiApiKey = process.env.OPENAI_API_KEY;
    this.huggingfaceApiKey = process.env.HUGGINGFACE_API_KEY;
    this.wordsApiKey = process.env.WORDS_API_KEY;
    this.merriamWebsterApiKey = process.env.MERRIAM_WEBSTER_API_KEY;
  }

  async generateExamples(word, translation = null) {
    try {
      console.log(`🤖 Generating examples for: "${word}"`);

      // Приоритеты API
      if (this.openaiApiKey) {
        const examples = await this.generateWithOpenAI(word, translation);
        if (examples.length > 0) return examples;
      }

      if (this.wordsApiKey) {
        const examples = await this.generateWithWordsAPI(word);
        if (examples.length > 0) return examples;
      }

      if (this.merriamWebsterApiKey) {
        const examples = await this.generateWithMerriamWebster(word);
        if (examples.length > 0) return examples;
      }

      if (this.huggingfaceApiKey) {
        const examples = await this.generateWithHuggingFace(word, translation);
        if (examples.length > 0) return examples;
      }

      // Fallback на базовые примеры
      console.log("🔧 No API keys found or all failed, using basic examples");
      return this.generateBasicExamples(word);
    } catch (error) {
      console.error("❌ Error generating examples:", error.message);
      return this.generateBasicExamples(word);
    }
  }

  async generateWithOpenAI(word, translation) {
    try {
      // Динамический импорт чтобы избежать зависимостей если API ключа нет
      const { OpenAI } = await import("openai");
      const openai = new OpenAI({
        apiKey: this.openaiApiKey,
      });

      const prompt = translation
        ? `Generate 3 natural English example sentences using the word "${word}" (which means "${translation}"). Make them diverse, practical for language learning, and suitable for different contexts. Return only the examples, one per line, without numbering.`
        : `Generate 3 natural English example sentences using the word "${word}". Make them diverse, practical for language learning, and suitable for different contexts. Return only the examples, one per line, without numbering.`;

      const completion = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content:
              "You are a helpful English language teacher that creates practical example sentences.",
          },
          { role: "user", content: prompt },
        ],
        max_tokens: 150,
        temperature: 0.7,
      });

      const examplesText = completion.choices[0].message.content;
      const examples = this.parseExamples(examplesText);

      console.log(`✅ OpenAI generated ${examples.length} examples`);
      return examples.length > 0 ? examples : [];
    } catch (error) {
      console.error("❌ OpenAI error:", error.message);
      return [];
    }
  }

  async generateWithWordsAPI(word) {
    try {
      const response = await axios.get(
        `https://wordsapiv1.p.rapidapi.com/words/${word}/examples`,
        {
          headers: {
            "X-RapidAPI-Key": this.wordsApiKey,
            "X-RapidAPI-Host": "wordsapiv1.p.rapidapi.com",
          },
          timeout: 5000,
        }
      );

      if (response.data.examples && response.data.examples.length > 0) {
        const examples = response.data.examples.slice(0, 3);
        console.log(`✅ WordsAPI found ${examples.length} examples`);
        return examples;
      }

      return [];
    } catch (error) {
      console.error("❌ WordsAPI error:", error.message);
      return [];
    }
  }

  async generateWithMerriamWebster(word) {
    try {
      const response = await axios.get(
        `https://www.dictionaryapi.com/api/v3/references/collegiate/json/${word}`,
        {
          params: {
            key: this.merriamWebsterApiKey,
          },
          timeout: 5000,
        }
      );

      if (
        response.data &&
        Array.isArray(response.data) &&
        response.data[0] &&
        response.data[0].shortdef
      ) {
        const examples = response.data[0].shortdef.slice(0, 3);
        console.log(`✅ Merriam-Webster found ${examples.length} examples`);
        return examples;
      }

      return [];
    } catch (error) {
      console.error("❌ Merriam-Webster error:", error.message);
      return [];
    }
  }

  async generateWithHuggingFace(word, translation) {
    try {
      const response = await axios.post(
        "https://api-inference.huggingface.co/models/gpt2",
        {
          inputs: `The word "${word}" can be used in sentences like: 1.`,
          parameters: {
            max_length: 100,
            num_return_sequences: 1,
            temperature: 0.9,
            do_sample: true,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${this.huggingfaceApiKey}`,
            "Content-Type": "application/json",
          },
          timeout: 10000,
        }
      );

      if (
        response.data &&
        response.data[0] &&
        response.data[0].generated_text
      ) {
        const text = response.data[0].generated_text;
        const examples = this.parseGeneratedText(text, word);

        if (examples.length > 0) {
          console.log(`✅ Hugging Face generated ${examples.length} examples`);
          return examples;
        }
      }

      return [];
    } catch (error) {
      console.error("❌ Hugging Face error:", error.message);
      return [];
    }
  }

  parseExamples(text) {
    return text
      .split("\n")
      .filter(
        (line) =>
          line.trim() &&
          !line.toLowerCase().includes("example") &&
          !line.toLowerCase().includes("sentence") &&
          line.length > 10
      )
      .map((line) => line.replace(/^[\d\-\*•]\.?\s*/, "").trim())
      .filter((line) => line.length > 0 && line.length < 200)
      .slice(0, 3);
  }

  parseGeneratedText(text, word) {
    const lines = text
      .split("\n")
      .filter((line) => line.toLowerCase().includes(word.toLowerCase()))
      .map((line) => line.replace(/^[\d\-\*•]\.?\s*/, "").trim())
      .filter((line) => line.length > 10 && line.length < 200);

    return lines.slice(0, 3);
  }

  generateBasicExamples(word) {
    const basicExamples = [
      `I need to use the word "${word}" in my essay.`,
      `Can you explain the meaning of "${word}"?`,
      `The word "${word}" is commonly used in everyday conversation.`,
      `She used the word "${word}" correctly in her sentence.`,
      `Learning how to use "${word}" properly is important for English learners.`,
      `In this context, the word "${word}" has a specific meaning.`,
      `Could you give me an example with the word "${word}"?`,
    ];

    // Выбираем случайные 3 примера
    const shuffled = [...basicExamples].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, 3);
  }

  // Метод для проверки доступности API
  async checkApisAvailability() {
    const availableApis = [];

    if (this.openaiApiKey) availableApis.push("OpenAI");
    if (this.wordsApiKey) availableApis.push("WordsAPI");
    if (this.merriamWebsterApiKey) availableApis.push("Merriam-Webster");
    if (this.huggingfaceApiKey) availableApis.push("Hugging Face");

    console.log(
      `🔧 Available example generation APIs: ${
        availableApis.join(", ") || "None"
      }`
    );
    return availableApis;
  }
}
