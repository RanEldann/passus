import { eq, and, desc } from 'drizzle-orm';
import type { Db } from './index.js';
import { telegramMessages } from './schema.js';

export function createTelegramMessageRepository(db: Db) {
  return {
    async save(telegramMessageId: string, chatId: string, threadId: string) {
      const [row] = await db
        .insert(telegramMessages)
        .values({ telegramMessageId, chatId, threadId })
        .returning();
      return row;
    },

    async findThreadByMessage(telegramMessageId: string, chatId: string) {
      return db.query.telegramMessages.findFirst({
        where: and(
          eq(telegramMessages.telegramMessageId, telegramMessageId),
          eq(telegramMessages.chatId, chatId),
        ),
      });
    },

    async findLatestThread(chatId: string) {
      return db.query.telegramMessages.findFirst({
        where: eq(telegramMessages.chatId, chatId),
        orderBy: desc(telegramMessages.createdAt),
      });
    },
  };
}
