import { ToolResult } from '../../types/agent';
import config from '../../config/sol.config.json';

export const openai = {
  async run(input: any): Promise<ToolResult> {
    if (!config.tools?.openai?.enabled) {
      return {
        jobId: 'stub-openai',
        status: 'error',
        events: [{ type: 'error', data: { message: 'OpenAI tool disabled in config' } }],
        artifacts: []
      };
    }

    return {
      jobId: 'stub-openai',
      status: 'ok',
      events: [{
        type: 'info',
        data: { message: 'OpenAI stub response' }
      }],
      artifacts: []
    };
  }
};
