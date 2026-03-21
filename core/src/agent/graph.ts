import { StateGraph, MessagesAnnotation, START, END } from '@langchain/langgraph';
import { ChatAnthropic } from '@langchain/anthropic';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { createAgentTools } from './tools.js';
import type { Db } from '../db/index.js';

const SYSTEM_PROMPT = `You are Passus, a friendly accountability coach.

Your job is to help users break down their ambitions into actionable plans using a fractal structure:
- Vision: the big-picture goal
- Milestones: major checkpoints toward the vision
- Weekly Strategies: what to focus on each week
- Daily Tasks: concrete actions for each day

When a user shares a goal:
1. Ask clarifying questions to understand what they really want
2. Propose a structured plan (vision → milestones → strategies → tasks)
3. Ask for confirmation before saving
4. Use the tools to save the plan to the database

Keep responses concise. Be encouraging but practical.`;

export interface CreateAgentOptions {
  dbUrl: string;
  db: Db;
  userId: string;
}

export async function createAgent({ dbUrl, db, userId }: CreateAgentOptions) {
  const tools = createAgentTools(db, userId);
  const toolNode = new ToolNode(tools);

  function createModel() {
    return new ChatAnthropic({
      model: 'claude-haiku-4-5-20251001',
      maxTokens: 1024,
    }).bindTools(tools);
  }

  async function agentNode(state: typeof MessagesAnnotation.State) {
    const response = await createModel().invoke([
      { role: 'system', content: SYSTEM_PROMPT },
      ...state.messages,
    ]);
    return { messages: [response] };
  }

  function shouldContinue(state: typeof MessagesAnnotation.State) {
    const lastMessage = state.messages[state.messages.length - 1];
    if (
      'tool_calls' in lastMessage &&
      Array.isArray(lastMessage.tool_calls) &&
      lastMessage.tool_calls.length > 0
    ) {
      return 'tools';
    }
    return END;
  }

  const workflow = new StateGraph(MessagesAnnotation)
    .addNode('agent', agentNode)
    .addNode('tools', toolNode)
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', shouldContinue, ['tools', END])
    .addEdge('tools', 'agent');

  const checkpointer = PostgresSaver.fromConnString(dbUrl);
  await checkpointer.setup();

  const agent = workflow.compile({ checkpointer });
  return { agent, checkpointer };
}

export type Agent = Awaited<ReturnType<typeof createAgent>>['agent'];
