import { ToolResult } from '../../types/agent';

export const n8nTool = {
  async run(_params: any): Promise<ToolResult> {
    return {
      jobId: 'stub-' + Math.random().toString(36).substring(2),
      status: 'ok',
      events: [{ type: 'info', data: { message: 'n8n operation queued' } }],
      artifacts: []
    };
  }
};
