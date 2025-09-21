type ToolCall = { kind: "mcp" | "n8n" | "internal"; name: string; args?: any };

import { generateReport } from '../services/reportGenerationService.js';

export async function dispatchTool(call: ToolCall) {
  switch (call.kind) {
    case "mcp":
      return { ok: true, via: "mcp", ...call }; // stub
    case "n8n":
      return { ok: true, via: "n8n", ...call }; // stub
    case "internal":
      if (call.name === "sum") return { result: call.args.a + call.args.b };
      
      // Report generation tool
      if (call.name === "generate_report") {
        try {
          const report = await generateReport({
            topic: call.args.topic,
            title: call.args.title || `Report on ${call.args.topic}`,
            timeframe: call.args.timeframe || "1m",
            includeInfographic: call.args.includeInfographic !== false,
            infographicStyle: call.args.style || "modern",
            format: call.args.format || "markdown"
          });
          
          return { 
            ok: true, 
            via: "internal", 
            result: report,
            summary: `Generated a report on "${report.title}" with ${report.sections.length} sections.`
          };
        } catch (error) {
          console.error("Error generating report:", error);
          return { 
            ok: false, 
            via: "internal", 
            error: error instanceof Error ? error.message : "Unknown error in report generation"
          };
        }
      }
      
      return { ok: true, via: "internal", ...call };
    default:
      throw new Error(`Bad tool kind: ${(call as any).kind}`);
  }
}
