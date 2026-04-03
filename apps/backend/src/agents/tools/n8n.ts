import { ToolResult } from '../../types/agent';

export const n8nTool = {
  id: 'n8n',
  name: 'n8n',
  kind: 'external',
  endpoint: 'internal:/api/tools/n8n',
  enabled: true,
  match: { keywords: ['n8n', 'workflow', 'automation'], weight: 1 },
  async run(_params: any): Promise<ToolResult> {
    return {
      jobId: 'stub-' + Math.random().toString(36).substring(2),
      status: 'ok',
      events: [{ type: 'info', data: { message: 'n8n operation queued' } }],
      artifacts: []
    };
  }
};
