import axios from "axios";

export class TranscriptionService {
  async getUKTranscription(word) {
    try {
      console.log(`🔍 Searching UK transcription for: "${word}"`);

      const response = await axios.get(
        `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(
          word.toLowerCase()
        )}`,
        { timeout: 5000 }
      );

      if (response.data && response.data[0]) {
        const wordData = response.data[0];

        // Ищем UK транскрипцию
        if (wordData.phonetics) {
          const ukPhonetic = wordData.phonetics.find(
            (p) => p.audio && p.audio.includes("/uk/")
          );
          if (ukPhonetic && ukPhonetic.text) {
            console.log(`✅ UK transcription found: ${ukPhonetic.text}`);
            return ukPhonetic.text;
          }

          // Любая транскрипция если UK нет
          const anyPhonetic = wordData.phonetics.find((p) => p.text);
          if (anyPhonetic) {
            console.log(
              `✅ Using available transcription: ${anyPhonetic.text}`
            );
            return anyPhonetic.text;
          }
        }

        // Общая транскрипция
        if (wordData.phonetic) {
          console.log(`✅ Using phonetic: ${wordData.phonetic}`);
          return wordData.phonetic;
        }
      }

      console.log("❌ No transcription found");
      return "";
    } catch (error) {
      if (error.response?.status === 404) {
        console.log("❌ Word not found in dictionary");
      } else {
        console.error("❌ Dictionary API error:", error.message);
      }
      return "";
    }
  }
}
