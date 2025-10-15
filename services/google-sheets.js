import { GoogleSpreadsheet } from 'google-spreadsheet';

export class GoogleSheetsService {
    constructor() {
        this.sheetId = process.env.GOOGLE_SHEET_ID;
        this.clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
        this.privateKey = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
    }

    // Существующий метод addWord
    async addWord(chatId, englishWord, transcription, translation, audioUrl) {
        try {
            const doc = new GoogleSpreadsheet(this.sheetId);
            await doc.useServiceAccountAuth({
                client_email: this.clientEmail,
                private_key: this.privateKey,
            });
            await doc.loadInfo();
            
            const sheet = doc.sheetsByTitle['Words'];
            await sheet.addRow({
                chat_id: chatId,
                english_word: englishWord,
                transcription: transcription,
                translation: translation,
                audio_url: audioUrl,
                created_at: new Date().toISOString()
            });
            
            return true;
        } catch (error) {
            console.error('Error adding word to sheet:', error);
            return false;
        }
    }

    // ✅ НОВЫЙ МЕТОД: Получение слов пользователя для проверки дубликатов
    async getUserWords(chatId) {
        try {
            const doc = new GoogleSpreadsheet(this.sheetId);
            await doc.useServiceAccountAuth({
                client_email: this.clientEmail,
                private_key: this.privateKey,
            });
            await doc.loadInfo();
            
            const sheet = doc.sheetsByTitle['Words'];
            const rows = await sheet.getRows();
            
            // Фильтруем слова по chat_id и возвращаем массив английских слов
            const userWords = rows
                .filter(row => row.get('chat_id') === chatId.toString())
                .map(row => ({
                    english: row.get('english_word'),
                    transcription: row.get('transcription'),
                    translation: row.get('translation'),
                    audio: row.get('audio_url')
                }));
                
            return userWords;
        } catch (error) {
            console.error('Error getting user words from sheet:', error);
            return [];
        }
    }
}
