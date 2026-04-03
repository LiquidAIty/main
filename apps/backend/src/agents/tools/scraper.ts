import { ToolResult } from '../../types/agent';

export const scraperTool = {
  id: 'scraper',
  name: 'Scraper',
  kind: 'external',
  endpoint: 'internal:/api/tools/scraper',
  enabled: true,
  match: { keywords: ['scrape', 'crawl', 'extract', 'page'], weight: 1 },
  async run(_params: any): Promise<ToolResult> {
    return { 
      jobId: 'stub-scraper', 
      status: 'ok', 
      events: [{type:'info', data:{message:'Scraper stub'}}], 
      artifacts: [] 
    };
  }
};
