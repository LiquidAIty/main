import { ToolResult } from '../../types/agent';

export const pythonTool = {
  id: 'python',
  name: 'Python',
  kind: 'internal',
  endpoint: 'internal:/api/tools/python',
  enabled: true,
  match: { keywords: ['python', 'script', 'code', 'compute'], weight: 1 },
  async run(_params: any): Promise<ToolResult> {
    return { 
      jobId: 'stub-python', 
      status: 'ok', 
      events: [{type:'info', data:{message:'Python stub'}}], 
      artifacts: [] 
    };
  }
};
