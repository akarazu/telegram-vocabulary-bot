// ✅ ФУНКЦИЯ: Получение слов для повторения с FSRS данными
async getWordsForReview(userId) {
    if (!this.initialized) {
        return [];
    }
    try {
        const userWords = await this.getUserWords(userId);
        const now = new Date();
        
        return userWords.filter(word => {
            if (!word.nextReview || word.status !== 'active') return false;
            const reviewDate = new Date(word.nextReview);
            return reviewDate <= now;
        });
    } catch (error) {
        console.error('❌ Error getting words for review:', error.message);
        return [];
    }
}

// ✅ ФУНКЦИЯ: Обновление карточки после повторения
async updateCardAfterReview(userId, english, fsrsData, rating) {
    if (!this.initialized) {
        return false;
    }
    try {
        // Находим строку для обновления
        const response = await this.sheets.spreadsheets.values.get({
            spreadsheetId: this.spreadsheetId,
            range: 'Words!A:I',
        });
        
        const rows = response.data.values || [];
        let rowIndex = -1;
        
        for (let i = 0; i < rows.length; i++) {
            if (rows[i][0] === userId.toString() && 
                rows[i][1].toLowerCase() === english.toLowerCase() && 
                rows[i][8] === 'active') {
                rowIndex = i + 1;
                break;
            }
        }

        if (rowIndex === -1) {
            console.error('❌ Word not found for review update:', english);
            return false;
        }

        // Обновляем интервал и дату следующего повторения
        await this.sheets.spreadsheets.values.update({
            spreadsheetId: this.spreadsheetId,
            range: `Words!G${rowIndex}:I${rowIndex}`,
            valueInputOption: 'RAW',
            resource: {
                values: [[
                    fsrsData.card.interval,
                    fsrsData.card.due.toISOString(),
                    'active'
                ]]
            }
        });

        console.log(`✅ Updated FSRS data for word "${english}": ${rating}, next review in ${fsrsData.card.interval} days`);
        return true;
    } catch (error) {
        console.error('❌ Error updating card after review:', error.message);
        return false;
    }
}
