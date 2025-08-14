import { ToolResult } from '../../types/agent';

export const ragTool = {
  async run(_params: any): Promise<ToolResult> {
    return { 
      jobId: 'stub-rag', 
      status: 'ok', 
      events: [{type:'info', data:{message:'RAG stub'}}], 
      artifacts: [] 
    };
  }
};
