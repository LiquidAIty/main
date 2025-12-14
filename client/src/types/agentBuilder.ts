export type AgentMode = 'assist' | 'agents';

export interface AgentCard {
  id: string;
  name: string;
  slug?: string | null;
  status?: string | null;
  hasAgentConfig: boolean;
}

export interface AgentIOSchema {
  knowledge_tags?: string[];
  knowledge_mode?: 'none' | 'rag' | 'graph' | 'rag+graph';
  notes?: string;
}

export interface AgentConfig {
  id: string;
  name: string;
  agent_model: string | null;
  agent_prompt_template: string | null;
  agent_tools: string[];
  agent_io_schema: AgentIOSchema;
  agent_temperature: number | null;
  agent_max_tokens: number | null;
  agent_permissions: Record<string, unknown>;
}
