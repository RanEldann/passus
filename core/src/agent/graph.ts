import { StateGraph, MessagesAnnotation, START, END } from '@langchain/langgraph';
import { ChatAnthropic } from '@langchain/anthropic';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { createAgentTools } from './tools.js';
import type { Db } from '../db/index.js';

function getSystemPrompt() {
  const today = new Date().toISOString().split('T')[0];
  return `You are Passus, a friendly accountability coach.
Today's date is ${today}.

Your job is to help users turn vague ambitions into specific, measurable goals with actionable plans.

Flow:
1. User shares a vision (e.g. "I want to run a marathon" or "I want to save more money")
2. You ask clarifying questions to refine it into a specific goal with a target date
3. You propose a plan with steps at an appropriate cadence (weekly, monthly, etc. — depends on the goal)
4. You ask for confirmation before saving anything
5. Use tools to save the goal and plan — create the goal first, then create ONE plan with ALL steps in a single tool call. Each step must include startDate and endDate.

The cadence of the plan depends on the goal:
- Training goals might have weekly steps
- Financial goals might have monthly steps
- Learning goals might have daily or weekly steps

After creating a plan, set up scheduled check-ins:
- Use create_check_in with a cron expression to schedule recurring check-ins
- You can create multiple check-ins per goal at different cadences (e.g., daily log + weekly retro)
- Daily logs should be quick — just ask for the data
- Weekly/monthly retros should include reflection and plan adjustment

When checking in on progress:
- Log checkpoints to track what the user actually did
- Help them reflect on their performance
- Adjust the plan if needed

Keep responses concise. Be encouraging but practical.`;
}

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
      maxTokens: 4096,
    }).bindTools(tools);
  }

  async function agentNode(state: typeof MessagesAnnotation.State) {
    const response = await createModel().invoke([
      { role: 'system', content: getSystemPrompt() },
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
