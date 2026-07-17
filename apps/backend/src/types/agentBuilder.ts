export interface AgentCard {
  id: string;
  name: string;
  code?: string | null;
  status?: string | null;
  hasAgentConfig: boolean;
  project_type?: 'assist' | 'agent';
}
