export type PlanAgentType =
  | "kg_ingest"
  | "knowgraph"
  | "neo4j"
  | "research_agent"
  | "agent_builder"
  | "llm_chat";

export type PlanReportNode = {
  id?: string | null;
};

export type AssistPlanState = {
  report_nodes?: PlanReportNode[];
  [key: string]: unknown;
};
