import { ToolResult } from '../../types/agent';
import config from '../../config/sol.config.json';

export const kimiTool = {
  async run(_params: any): Promise<ToolResult> {
    if (!config.tools?.kimi?.enabled) {
      return {
        jobId: 'stub-kimi',
        status: 'error',
        events: [{ type: 'error', data: { message: 'Kimi tool disabled in config' } }],
        artifacts: []
      };
    }
    
    return {
      jobId: 'stub-kimi',
      status: 'ok',
      events: [{ type: 'info', data: { message: 'Kimi tool stub response' } }],
      artifacts: []
    };
  }
};
