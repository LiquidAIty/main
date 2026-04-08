import { ChatOpenAI } from "@langchain/openai";
import { StateGraph, Annotation } from "@langchain/langgraph";
import { knowledgeGraphTool, knowledgeGraphQueryTool } from "./tools/knowledgeGraphTools";
import { getMcpTools } from "../mcp/mcpClient";

type Msg = { role: "user" | "assistant" | "tool"; content: string };

const StateAnnotation = Annotation.Root({
  threadId: Annotation<string>,
  messages: Annotation<Msg[]>({
    reducer: (x, y) => x.concat(y),
    default: () => []
  }),
  plan: Annotation<string | undefined>,
  status: Annotation<"idle"|"awaiting_approval"|"running"|"done"|"error">({
    reducer: (x, y) => y,
    default: () => "idle" as const
  }),
  loops: Annotation<number>({
    reducer: (x, y) => y,
    default: () => 0
  }),
  result: Annotation<string | undefined>
});

// Build model with both local Zod tools and MCP tools
async function buildModelWithTools() {
  let mcpTools: any[] = [];
  try {
    mcpTools = await getMcpTools();   // MCP => LangChain tools (already structured)
  } catch (e) {
    console.warn('[orchestratorGraph] Failed to load MCP tools, continuing without them:', e instanceof Error ? e.message : e);
  }
  const localTools = [knowledgeGraphTool, knowledgeGraphQueryTool];
  
  const model = new ChatOpenAI({ 
    model: "gpt-4o-mini", 
    temperature: 0,
    openAIApiKey: process.env.OPENAI_API_KEY,
    timeout: 30000
  }).bindTools([...localTools, ...mcpTools]);
  return model;
}

function lastUser(s: typeof StateAnnotation.State) { 
  return [...s.messages].reverse().find(m=>m.role==="user")?.content ?? ""; 
}
function lastAssistant(s: typeof StateAnnotation.State) { 
  return [...s.messages].reverse().find(m=>m.role==="assistant")?.content ?? ""; 
}

async function reason(s: typeof StateAnnotation.State) {
  const model = await buildModelWithTools();
  const sys = "Planner. Produce a short actionable plan. If missing info, include token NEEDS_MORE.";
  const rsp = await model.invoke([{ role: "user", content: `${sys}\n\nUser: ${lastUser(s)}`  }]);
  const plan = String(rsp.content ?? "");
  return { plan, messages: [{ role: "assistant" as const, content: plan }] };
}

async function code(s: typeof StateAnnotation.State) {
  const model = await buildModelWithTools();
  const prompt = `Follow plan:\n${s.plan ?? ""}\nUse tools if needed (including MCP tools like filesystem). If more info needed, output NEEDS_MORE. User: ${lastUser(s)}` ;
  const rsp = await model.invoke([{ role: "user", content: prompt }]);
  const text = String(rsp.content ?? "");
  return { messages: [{ role: "assistant" as const, content: text }], status: "awaiting_approval" as const };
}

async function hitl_wait(_: typeof StateAnnotation.State) {
  return { status: "awaiting_approval" as const };
}

async function route(s: typeof StateAnnotation.State) {
  const feedback = lastUser(s).toLowerCase();
  if (feedback.includes("ship") || feedback.includes("approve") || feedback.includes("looks good")) {
    return { result: lastAssistant(s), status: "done" as const };
  }
  return { loops: s.loops + 1, status: "running" as const };
}

async function aggregate(s: typeof StateAnnotation.State) {
  return { result: lastAssistant(s), status: "done" as const };
}

function loopOrEnd(s: typeof StateAnnotation.State) {
  if (s.loops >= 3) return "aggregate";
  return s.status === "running" ? "code" : "aggregate";
}

const graph = new StateGraph(StateAnnotation)
  .addNode("reason", reason)
  .addNode("code", code)
  .addNode("hitl_wait", hitl_wait)
  .addNode("route", route)
  .addNode("aggregate", aggregate)
  .addEdge("__start__", "reason")
  .addEdge("reason", "code")
  .addEdge("code", "hitl_wait")
  .addEdge("hitl_wait", "route")
  .addConditionalEdges("route", loopOrEnd, { code: "code", aggregate: "aggregate" })
  .addEdge("aggregate", "__end__");

export const orchestratorApp = graph.compile();

export async function runOrchestrator(threadId: string, messages: Msg[]) {
  const init = { threadId, messages, status: "running" as const, loops: 0 };
  return await orchestratorApp.invoke(init);
}
