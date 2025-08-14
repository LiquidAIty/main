import { ToolResult } from '../../types/agent';

export const scraperTool = {
  async run(_params: any): Promise<ToolResult> {
    return { 
      jobId: 'stub-scraper', 
      status: 'ok', 
      events: [{type:'info', data:{message:'Scraper stub'}}], 
      artifacts: [] 
    };
  }
};
