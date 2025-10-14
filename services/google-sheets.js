import { google } from "googleapis";

export class GoogleSheetsService {
  constructor() {
    this.auth = new google.auth.GoogleAuth({
      credentials: {
        type: "service_account",
        project_id: process.env.GOOGLE_PROJECT_ID,
        private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
        private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        client_id: process.env.GOOGLE_CLIENT_ID,
      },
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    this.sheets = google.sheets({ version: "v4", auth: this.auth });
    this.spreadsheetId = process.env.GOOGLE_SHEET_ID;
  }

  async addWord(userId, word, translation) {
    try {
      await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: "Words!A:D",
        valueInputOption: "RAW",
        requestBody: {
          values: [
            [userId.toString(), word, translation, new Date().toISOString()],
          ],
        },
      });
      return true;
    } catch (error) {
      console.error("Error adding word:", error);
      return false;
    }
  }

  async getUserWords(userId) {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: "Words!A:D",
      });

      const rows = response.data.values || [];
      return rows
        .filter((row) => row[0] === userId.toString())
        .map((row) => ({
          word: row[1],
          translation: row[2],
        }));
    } catch (error) {
      console.error("Error getting words:", error);
      return [];
    }
  }
}
