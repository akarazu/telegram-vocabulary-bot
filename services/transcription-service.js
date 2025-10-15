import { YandexDictionaryService } from "./yandex-dictionary-service.js";
import { BackupDictionaryService } from "./backup-dictionary-service.js";

export class TranscriptionService {
  constructor() {
    this.yandexService = new YandexDictionaryService();
    this.backupService = new BackupDictionaryService();
    this.useYandex = true;
  }

  async getUKTranscription(word) {
    // Сначала пробуем Yandex
    if (this.useYandex) {
      try {
        const yandexResult = await this.yandexService.getTranscription(word);
        if (yandexResult.transcription) {
          return yandexResult;
        }
      } catch (error) {
        console.log("🔄 Yandex failed, switching to backup...");
        this.useYandex = false;
      }
    }

    // Резерв: Free Dictionary API
    console.log("🔄 Using backup dictionary...");
    return await this.backupService.getTranscription(word);
  }
}
