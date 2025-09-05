import { ToolResult } from '../../types/agent';
import config from '../../config/sol.config.json';
import fetch from "node-fetch";

export const kimiTool = {
  async run(_params: any): Promise<ToolResult> {
    if (!config.tools?.kimi?.enabled) {
      return {
        jobId: 'stub-kimi',
        status: 'error',
        events: [{ type: 'error', data: { message: 'Kimi tool disabled in config' } }],
        artifacts: []
      };
    }
    
    const query = _params.query;
    const response = await kimiRun(query);

    return {
      jobId: 'stub-kimi',
      status: 'ok',
      events: [{ type: 'info', data: { message: response } }],
      artifacts: []
    };
  }
};

export async function kimiRun(query: string) {
  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "moonshotai/kimi-k2:free",
      messages: [{ role: "user", content: query }]
    })
  });

  if (!resp.ok) {
    throw new Error(`Kimi API error: ${resp.statusText}`);
  }

  const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content || "No response from Kimi.";
}
