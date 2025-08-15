import { ToolResult } from '../../types/agent';

export const mcpTool = {
  async run(_params: any): Promise<ToolResult> {
    return {
      jobId: 'stub-mcp',
      status: 'ok',
      events: [{ type: 'info', data: { message: 'MCP stub - not implemented' } }],
      artifacts: []
    };
  }
};
