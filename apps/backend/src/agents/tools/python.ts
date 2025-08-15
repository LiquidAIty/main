import { ToolResult } from '../../types/agent';

export const pythonTool = {
  async run(_params: any): Promise<ToolResult> {
    return { 
      jobId: 'stub-python', 
      status: 'ok', 
      events: [{type:'info', data:{message:'Python stub'}}], 
      artifacts: [] 
    };
  }
};
