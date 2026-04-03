import { ToolResult } from '../../types/agent';

export const uiTool = {
  id: 'ui',
  name: 'UI',
  kind: 'internal',
  endpoint: 'internal:/api/tools/ui',
  enabled: true,
  match: { keywords: ['ui', 'interface', 'screen', 'render'], weight: 1 },
  async run(_params: any): Promise<ToolResult> {
    return {
      jobId: 'stub-ui',
      status: 'ok',
      events: [{ type: 'info', data: { message: 'UI stub - not implemented' } }],
      artifacts: []
    };
  }
};
