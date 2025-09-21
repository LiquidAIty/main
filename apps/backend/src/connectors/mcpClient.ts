/**
 * MCP Client
 * Client for interacting with MCP servers
 */

import axios, { AxiosInstance } from 'axios';

// Environment variables
const MCP_BASE_URL = process.env.MCP_BASE_URL || 'http://localhost:8000';
const MCP_API_KEY = process.env.MCP_API_KEY;

/**
 * MCP execution response
 */
export interface MCPResponse<T = any> {
  ok: boolean;
  data?: T;
  error?: string;
}

/**
 * MCP Client for interacting with MCP servers
 */
export class MCPClient {
  private client: AxiosInstance;
  
  constructor(baseUrl: string = MCP_BASE_URL) {
    this.client = axios.create({
      baseURL: baseUrl,
      headers: {
        'Content-Type': 'application/json',
        ...(MCP_API_KEY ? { 'Authorization': `Bearer ${MCP_API_KEY}` } : {})
      }
    });
  }
  
  /**
   * Execute an MCP command
   * @param serverName Name of the MCP server
   * @param command Command to execute
   * @param params Parameters for the command
   * @returns Response from the MCP server
   */
  async execute<T = any>(
    serverName: string,
    command: string,
    params: Record<string, any> = {}
  ): Promise<MCPResponse<T>> {
    try {
      const response = await this.client.post(`/api/execute/${serverName}/${command}`, params);
      
      return {
        ok: true,
        data: response.data
      };
    } catch (error: any) {
      console.error(`MCP execution error (${serverName}/${command}):`, error.message);
      
      // Extract error message from response if available
      let errorMessage = 'MCP execution failed';
      
      if (error.response?.data?.error) {
        errorMessage = error.response.data.error;
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      return {
        ok: false,
        error: errorMessage
      };
    }
  }
  
  /**
   * List available MCP servers
   * @returns List of available MCP servers
   */
  async listServers(): Promise<MCPResponse<string[]>> {
    try {
      const response = await this.client.get('/api/servers');
      
      return {
        ok: true,
        data: response.data
      };
    } catch (error: any) {
      console.error('Error listing MCP servers:', error.message);
      
      return {
        ok: false,
        error: error.message
      };
    }
  }
  
  /**
   * Get information about an MCP server
   * @param serverName Name of the MCP server
   * @returns Server information
   */
  async getServerInfo(serverName: string): Promise<MCPResponse<any>> {
    try {
      const response = await this.client.get(`/api/servers/${serverName}`);
      
      return {
        ok: true,
        data: response.data
      };
    } catch (error: any) {
      console.error(`Error getting MCP server info (${serverName}):`, error.message);
      
      return {
        ok: false,
        error: error.message
      };
    }
  }
  
  /**
   * List available commands for an MCP server
   * @param serverName Name of the MCP server
   * @returns List of available commands
   */
  async listCommands(serverName: string): Promise<MCPResponse<string[]>> {
    try {
      const response = await this.client.get(`/api/servers/${serverName}/commands`);
      
      return {
        ok: true,
        data: response.data
      };
    } catch (error: any) {
      console.error(`Error listing MCP commands (${serverName}):`, error.message);
      
      return {
        ok: false,
        error: error.message
      };
    }
  }
}
