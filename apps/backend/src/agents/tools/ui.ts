import { ToolResult } from '../../types/agent';

export const uiTool = {
  async run(_params: any): Promise<ToolResult> {
    return {
      jobId: 'stub-ui',
      status: 'ok',
      events: [{ type: 'info', data: { message: 'UI stub - not implemented' } }],
      artifacts: []
    };
  }
};
