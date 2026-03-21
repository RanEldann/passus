import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export const mockGetGoals = tool(
  async () => {
    return 'No goals yet. Try creating one!';
  },
  {
    name: 'get_goals',
    description: 'Get the current goals for the user',
    schema: z.object({}),
  },
);

export const agentTools = [mockGetGoals];
