import { StateGraph, MessagesAnnotation, START, END } from '@langchain/langgraph';
import { ChatAnthropic } from '@langchain/anthropic';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { agentTools } from './tools.js';
import { ToolNode } from '@langchain/langgraph/prebuilt';

const SYSTEM_PROMPT = 'You are Passus, a friendly accountability coach. Keep responses concise.';

function createModel() {
  return new ChatAnthropic({
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 1024,
  }).bindTools(agentTools);
}

async function agentNode(state: typeof MessagesAnnotation.State) {
  const model = createModel();
  const response = await model.invoke([
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

const toolNode = new ToolNode(agentTools);

const workflow = new StateGraph(MessagesAnnotation)
  .addNode('agent', agentNode)
  .addNode('tools', toolNode)
  .addEdge(START, 'agent')
  .addConditionalEdges('agent', shouldContinue, ['tools', END])
  .addEdge('tools', 'agent');

export async function createAgent(dbUrl: string) {
  const checkpointer = PostgresSaver.fromConnString(dbUrl);
  await checkpointer.setup();

  const agent = workflow.compile({ checkpointer });
  return { agent, checkpointer };
}

export type Agent = Awaited<ReturnType<typeof createAgent>>['agent'];
