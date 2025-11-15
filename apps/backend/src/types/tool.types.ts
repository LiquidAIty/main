/**
 * Tool Configuration Types
 * Defines the shape of tool definitions for REST and MCP integration
 */

export interface ToolParamDef {
  type: string;
  required?: boolean;
  description?: string;
  default?: any;
  items?: any;
  properties?: Record<string, any>;
  minimum?: number;
  maximum?: number;
}

export interface ToolOutputDef {
  type: string;
  description?: string;
  optional?: boolean;
  items?: any;
  properties?: Record<string, any>;
}

export interface ToolConfig<TParams = any, TResponse = any> {
  id: string;
  name: string;
  description: string;
  version: string;

  params: Record<string, ToolParamDef>;

  request: {
    url: () => string;
    method: "GET" | "POST" | "PUT" | "DELETE";
    headers?: () => Record<string, string>;
    body?: (params: TParams) => any;
  };

  transformResponse: (response: Response) => Promise<TResponse>;

  outputs: Record<string, ToolOutputDef>;
}
