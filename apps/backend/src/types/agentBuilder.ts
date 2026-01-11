export interface AgentCard {
  id: string;
  name: string;
  slug?: string | null;
  status?: string | null;
  hasAgentConfig: boolean;
}

export interface AgentConfig {
  id: string;
  name: string;
  agent_model: string | null;
  agent_prompt_template: string | null;
  agent_tools: string[];
  agent_io_schema: Record<string, unknown>;
  agent_temperature: number | null;
  agent_max_tokens: number | null;
  agent_permissions: Record<string, unknown>;
}
