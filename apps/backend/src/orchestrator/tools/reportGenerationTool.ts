/**
 * Report Generation Tool for LangGraph
 * Allows agents to generate reports and infographics using Gemini
 */

import { Tool } from "langchain/tools";
import { z } from "zod";
import { 
  generateReport, 
  ReportGenerationError 
} from "../../services/reportGenerationService.js";

// Define the schema for report parameters
const reportParamsSchema = z.object({
  topic: z.string().describe("The main topic for the report"),
  title: z.string().describe("Title for the report"),
  includeInfographic: z.boolean().optional().default(true).describe("Whether to generate an infographic"),
  style: z.enum(["modern", "corporate", "minimalist", "colorful"]).optional().default("modern").describe("Visual style for the infographic"),
  knowledgeGraphData: z.record(z.any()).optional().describe("Data from the knowledge graph to include in the report"),
  agentContext: z.string().optional().describe("Additional context from the agent about what to emphasize"),
  timeframe: z.enum(["1d", "1w", "1m", "3m", "6m", "1y"]).optional().default("1m").describe("Timeframe for data analysis")
});

/**
 * Tool for generating reports and infographics from LangGraph agents
 */
export class ReportGenerationTool extends Tool {
  name = "report_generation";
  description = "Generate comprehensive reports and infographics on any topic using Gemini. Useful for creating visual summaries of knowledge graph data.";

  constructor() {
    super();
  }

  /** @ignore */
  override async _call(arg: string | undefined): Promise<string> {
    try {
      if (!arg) {
        return JSON.stringify({
          success: false,
          error: "No input provided"
        });
      }
      
      // Parse the input JSON string
      const parsedInput = JSON.parse(arg);
      
      // Validate against our schema
      const validatedInput = reportParamsSchema.parse(parsedInput);
      
      // Convert the tool input to the report request format
      const reportRequest = {
        topic: validatedInput.topic,
        title: validatedInput.title,
        includeInfographic: validatedInput.includeInfographic ?? true,
        infographicStyle: validatedInput.style ?? "modern",
        knowledgeGraphData: validatedInput.knowledgeGraphData,
        agentContext: validatedInput.agentContext,
        timeframe: validatedInput.timeframe ?? "1m",
        format: "markdown" as const
      };

      // Generate the report
      const report = await generateReport(reportRequest);

      // Return a summary of the generated report
      return JSON.stringify({
        success: true,
        reportId: report.reportId,
        title: report.title,
        infographicUrl: report.infographicUrl,
        summary: `Generated a report on "${report.title}" with ${report.sections.length} sections. ${report.infographicUrl ? "An infographic was also created." : "No infographic was created."}`
      });
    } catch (error) {
      console.error("Error in report generation tool:", error);
      
      let errorMessage = "Unknown error in report generation";
      
      if (error instanceof ReportGenerationError) {
        errorMessage = error.message;
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }
      
      return JSON.stringify({
        success: false,
        error: errorMessage
      });
    }
  }
}

/**
 * Example usage in a LangGraph agent:
 * 
 * ```typescript
 * import { ReportGenerationTool } from "./tools/reportGenerationTool.js";
 * 
 * // Create the tool
 * const reportTool = new ReportGenerationTool();
 * 
 * // Add to agent tools
 * const tools = [reportTool, ...otherTools];
 * 
 * // Create the agent with tools
 * const agent = createAgent({
 *   llm,
 *   tools,
 *   // other configuration
 * });
 * ```
 */

/**
 * Example of how a boss agent might use this tool in a workflow:
 * 
 * 1. Knowledge graph is built and populated with data
 * 2. User asks a question that requires a comprehensive report
 * 3. Boss agent determines a report would be helpful
 * 4. Boss agent asks user: "Would you like me to generate a comprehensive report with an infographic on this topic?"
 * 5. If user confirms, boss agent calls the report generation tool
 * 6. Report is generated and presented to the user
 */

/**
 * Function to ask user if they want a report before generating one
 * This can be called from a LangGraph agent
 */
export async function askUserForReportConfirmation(
  topic: string,
  question: string,
  askFunction: (question: string) => Promise<string>
): Promise<boolean> {
  const confirmationQuestion = 
    `I've analyzed your question about "${topic}": "${question}"\n\n` +
    `Would you like me to generate a comprehensive report with an infographic? ` +
    `This will provide a visual summary of the key information. (yes/no)`;
  
  const response = await askFunction(confirmationQuestion);
  return response.toLowerCase().includes("yes");
}
