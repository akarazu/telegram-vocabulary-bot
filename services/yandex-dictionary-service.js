import axios from "axios";

export class YandexDictionaryService {
  constructor() {
    this.apiKey = process.env.YANDEX_DICTIONARY_API_KEY;
    this.baseUrl =
      "https://dictionary.yandex.net/api/v1/dicservice.json/lookup";
  }

  async getTranscription(word) {
    try {
      console.log(`🔍 Yandex: Searching for "${word}"`);

      const response = await axios.get(this.baseUrl, {
        params: {
          key: this.apiKey,
          lang: "en-ru", // Английский -> Русский
          text: word.toLowerCase(),
          ui: "ru",
        },
        timeout: 5000,
      });

      if (response.data && response.data.def && response.data.def.length > 0) {
        const transcription = this.extractTranscription(response.data);
        const audioUrl = await this.getAudioUrl(word);

        console.log(`✅ Yandex transcription: ${transcription}`);

        return {
          transcription: transcription,
          audioUrl: audioUrl,
        };
      }

      console.log("❌ Yandex: No transcription found");
      return { transcription: "", audioUrl: "" };
    } catch (error) {
      console.error(
        "❌ Yandex API error:",
        error.response?.status,
        error.message
      );
      return { transcription: "", audioUrl: "" };
    }
  }

  extractTranscription(data) {
    try {
      const definition = data.def[0];

      // Yandex хранит транскрипцию в поле "ts"
      if (definition.ts) {
        return `/${definition.ts}/`;
      }

      return "";
    } catch (error) {
      console.error("Error extracting Yandex transcription:", error);
      return "";
    }
  }

  // Получаем аудио произношение через внешний сервис
  async getAudioUrl(word) {
    try {
      // Используем Forvo API как резерв для аудио
      const forvoResponse = await axios.get(
        `https://apifree.forvo.com/key/${
          process.env.FORVO_API_KEY
        }/format/json/action/word-pronunciations/word/${encodeURIComponent(
          word
        )}/language/en`,
        { timeout: 3000 }
      );

      if (
        forvoResponse.data &&
        forvoResponse.data.items &&
        forvoResponse.data.items.length > 0
      ) {
        // Ищем UK произношение
        const ukPronunciation = forvoResponse.data.items.find(
          (item) => item.country && item.country.toLowerCase().includes("uk")
        );

        if (ukPronunciation && ukPronunciation.pathmp3) {
          return ukPronunciation.pathmp3;
        }

        // Любое английское произношение
        const anyPronunciation = forvoResponse.data.items.find(
          (item) =>
            item.langname && item.langname.toLowerCase().includes("english")
        );

        if (anyPronunciation && anyPronunciation.pathmp3) {
          return anyPronunciation.pathmp3;
        }
      }
    } catch (error) {
      console.log("Forvo API not available, trying alternative...");
    }

    // Альтернатива: Google TTS
    try {
      const googleTtsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(
        word
      )}&tl=en-gb&client=tw-ob`;
      return googleTtsUrl;
    } catch (error) {
      console.error("Audio URL generation failed");
      return "";
    }
  }
}
