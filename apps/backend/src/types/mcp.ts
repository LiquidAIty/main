// MCP service types

export interface GraphlitDocument {
  id: string;
  content: string;
  score: number;
  metadata?: Record<string, any>;
}

export interface InfranodusTopic {
  name: string;
  weight: number;
}

export interface InfraNodusGap {
  from: string;
  to: string;
  strength: number;
}
