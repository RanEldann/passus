import { Bot, InlineKeyboard } from 'grammy';
import { HumanMessage } from '@langchain/core/messages';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import {
  createDb,
  createAgent,
  createUserRepository,
  createThreadRepository,
  createGoalRepository,
  createTelegramMessageRepository,
  createScheduler,
} from '@passus/core';
import type { Agent, Transport } from '@passus/core';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN environment variable is required');
  process.exit(1);
}

const DB_URL = process.env.DATABASE_URL ?? 'postgresql://localhost:5432/passus';

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return (content as { type: string; text?: string }[])
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text)
      .join('');
  }
  return '';
}

function splitMessage(text: string): string[] {
  const MAX_LENGTH = 4096;
  if (text.length <= MAX_LENGTH) return [text];

  const chunks: string[] = [];
  const paragraphs = text.split(/\n\n/);
  let current = '';

  for (const paragraph of paragraphs) {
    if (paragraph.length > MAX_LENGTH) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      // Split long paragraph at sentence boundaries
      const sentences = paragraph.match(/[^.!?]+[.!?]+\s*/g) ?? [paragraph];
      for (const sentence of sentences) {
        if (current.length + sentence.length > MAX_LENGTH) {
          if (current) chunks.push(current);
          current = sentence;
        } else {
          current += sentence;
        }
      }
    } else if (current.length + (current ? '\n\n' : '').length + paragraph.length > MAX_LENGTH) {
      if (current) chunks.push(current);
      current = paragraph;
    } else {
      current = current ? current + '\n\n' + paragraph : paragraph;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

async function main() {
  const { db, close: closeDb } = createDb(DB_URL);
  const userRepo = createUserRepository(db);
  const threadRepo = createThreadRepository(db);
  const goalRepo = createGoalRepository(db);
  const telegramMsgRepo = createTelegramMessageRepository(db);

  const bot = new Bot(BOT_TOKEN!);

  const checkpointer = PostgresSaver.fromConnString(DB_URL);
  await checkpointer.setup();

  const agentCache = new Map<string, Agent>();

  async function getAgent(userId: string): Promise<Agent> {
    const cached = agentCache.get(userId);
    if (cached) return cached;
    const { agent } = await createAgent({ dbUrl: DB_URL, db, userId, checkpointer });
    agentCache.set(userId, agent);
    return agent;
  }

  // Buffer sent messages from transport so onCheckInStarted can save thread mappings
  const pendingSentMessages: { telegramMessageId: string; chatId: string }[] = [];

  const transport: Transport = {
    async sendMessage(userId: string, text: string) {
      const user = await userRepo.findById(userId);
      if (!user) return;
      const chatId = user.name.replace('telegram-', '');
      const chunks = splitMessage(text);
      for (const chunk of chunks) {
        const sent = await bot.api.sendMessage(chatId, chunk);
        pendingSentMessages.push({ telegramMessageId: String(sent.message_id), chatId });
      }
    },
    onMessage() {},
  };

  const scheduler = createScheduler({
    db,
    resolveAgent: getAgent,
    transport,
    onCheckInStarted(_userId: string, threadId: string) {
      // Save buffered sent messages with the check-in thread so replies route correctly
      const messages = pendingSentMessages.splice(0);
      if (messages.length > 0) {
        Promise.all(
          messages.map((m) => telegramMsgRepo.save(m.telegramMessageId, m.chatId, threadId)),
        ).catch((err) => {
          console.error('[telegram] Error saving check-in message mappings:', err);
        });
      }
      console.log(`[telegram] Check-in started on thread: ${threadId}`);
    },
  });

  async function resolveThread(
    chatId: string,
    userId: string,
    replyToMessageId?: number,
  ): Promise<string> {
    if (replyToMessageId) {
      const mapping = await telegramMsgRepo.findThreadByMessage(
        String(replyToMessageId),
        chatId,
      );
      if (mapping) return mapping.threadId;
    }

    const latest = await telegramMsgRepo.findLatestThread(chatId);
    if (latest) return latest.threadId;

    const thread = await threadRepo.create(userId);
    return thread.id;
  }

  async function invokeAndReply(
    chatId: string,
    userId: string,
    threadId: string,
    text: string,
    replyToMessageId?: number,
  ) {
    const agent = await getAgent(userId);
    const config = { configurable: { thread_id: threadId }, recursionLimit: 50 };
    const result = await agent.invoke({ messages: [new HumanMessage(text)] }, config);

    const lastMessage = result.messages[result.messages.length - 1];
    const responseText = extractText(lastMessage.content);

    if (responseText) {
      const chunks = splitMessage(responseText);
      for (const chunk of chunks) {
        const sent = await bot.api.sendMessage(chatId, chunk, {
          reply_to_message_id: replyToMessageId,
        });
        await telegramMsgRepo.save(String(sent.message_id), chatId, threadId);
      }
    }

    await scheduler.sync();
  }

  async function sendGoalMenu(chatId: string, userId: string) {
    const userGoals = await goalRepo.getGoalsByUser(userId);
    const activeGoals = userGoals.filter((g) => g.active);

    const keyboard = new InlineKeyboard();
    for (const goal of activeGoals) {
      const status = goal.status.replace(/_/g, ' ');
      keyboard.text(`${goal.title} [${status}]`, goal.id).row();
    }
    keyboard.text('+ New goal', 'new_goal').row();

    const text =
      activeGoals.length > 0
        ? 'Your goals — pick one to continue, or create a new one:'
        : 'No goals yet. Create your first one:';

    await bot.api.sendMessage(chatId, text, { reply_markup: keyboard });
  }

  // /start and /goals commands
  bot.command('start', async (ctx) => {
    const chatId = String(ctx.chat.id);
    const user = await userRepo.findOrCreate(`telegram-${chatId}`);
    await sendGoalMenu(chatId, user.id);
  });

  bot.command('goals', async (ctx) => {
    const chatId = String(ctx.chat.id);
    const user = await userRepo.findOrCreate(`telegram-${chatId}`);
    await sendGoalMenu(chatId, user.id);
  });

  // Goal selection via inline keyboard
  bot.on('callback_query:data', async (ctx) => {
    const chatId = String(ctx.chat!.id);
    const user = await userRepo.findOrCreate(`telegram-${chatId}`);
    const data = ctx.callbackQuery.data;

    await ctx.answerCallbackQuery();

    const thread = await threadRepo.create(user.id);

    if (data === 'new_goal') {
      await invokeAndReply(chatId, user.id, thread.id, 'I want to create a new goal.');
      return;
    }

    // data is a goal ID
    const fullGoal = await goalRepo.getFullGoal(data);
    if (!fullGoal) {
      await bot.api.sendMessage(chatId, 'Goal not found.');
      return;
    }

    const livePlan = fullGoal.plans.find((p) => p.status === 'live');
    const recentCheckpoints = fullGoal.checkpoints.slice(-3);

    let context = `[CONTEXT] The user selected their goal: "${fullGoal.title}".\n`;
    context += `Goal ID: ${fullGoal.id}\n`;
    context += `Status: ${fullGoal.status}\n`;
    if (fullGoal.startDate) context += `Start: ${fullGoal.startDate}\n`;
    if (fullGoal.targetDate) context += `Target: ${fullGoal.targetDate}\n`;
    if (fullGoal.description) context += `Description: ${fullGoal.description}\n`;
    if (livePlan) {
      context += `\nPlan (v${livePlan.version}): ${livePlan.description}\n`;
      context += `Steps: ${JSON.stringify(livePlan.steps)}\n`;
    }
    if (recentCheckpoints.length > 0) {
      context += `\nRecent checkpoints: ${JSON.stringify(recentCheckpoints)}\n`;
    }
    context += `\nGreet the user briefly and ask how they'd like to work on this goal today.`;

    await invokeAndReply(chatId, user.id, thread.id, context);
  });

  // Regular messages
  bot.on('message:text', async (ctx) => {
    const chatId = String(ctx.chat.id);
    const user = await userRepo.findOrCreate(`telegram-${chatId}`);

    await ctx.replyWithChatAction('typing');

    const replyToMessageId = ctx.message.reply_to_message?.message_id;
    const threadId = await resolveThread(chatId, user.id, replyToMessageId);

    try {
      await invokeAndReply(chatId, user.id, threadId, ctx.message.text, replyToMessageId);
    } catch (err) {
      console.error('[telegram] Error:', err instanceof Error ? err.message : err);
      await ctx.reply('Something went wrong. Please try again.');
    }
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[telegram] Shutting down...');
    scheduler.stop();
    bot.stop();
    await checkpointer.end();
    await closeDb();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Start
  await scheduler.start();
  console.log('[telegram] Bot started');
  bot.start();
}

main().catch((err) => {
  console.error('[telegram] Fatal error:', err);
  process.exit(1);
});
