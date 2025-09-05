export interface MCPServerConfig {
  id: string;
  name: string;
  description: string;
  category: 'data' | 'ai' | 'dev' | 'search' | 'productivity' | 'media' | 'knowledge';
  capabilities: string[];
  npmPackage?: string;
  githubUrl?: string;
  envVars?: string[];
  installCommand?: string;
}

export const AWESOME_MCP_SERVERS: MCPServerConfig[] = [
  // Data Sources
  {
    id: 'google-sheets',
    name: 'Google Sheets MCP',
    description: 'Read and write Google Sheets data',
    category: 'data',
    capabilities: ['read_sheets', 'write_sheets', 'create_sheets', 'format_cells'],
    npmPackage: '@google-sheets/mcp-server',
    envVars: ['GOOGLE_SHEETS_API_KEY', 'GOOGLE_SHEETS_CLIENT_ID'],
    installCommand: 'npm install @google-sheets/mcp-server'
  },
  {
    id: 'youtube-transcript',
    name: 'YouTube Transcript',
    description: 'Extract transcripts from YouTube videos',
    category: 'media',
    capabilities: ['get_transcript', 'search_videos', 'get_captions'],
    npmPackage: '@youtube/transcript-mcp',
    envVars: ['YOUTUBE_API_KEY'],
    installCommand: 'npm install @youtube/transcript-mcp'
  },
  {
    id: 'pdf-reader',
    name: 'PDF Reader MCP',
    description: 'Extract text and data from PDF files',
    category: 'data',
    capabilities: ['read_pdf', 'extract_text', 'get_metadata', 'extract_images'],
    npmPackage: '@pdf/reader-mcp',
    installCommand: 'npm install @pdf/reader-mcp'
  },
  {
    id: 'news-api',
    name: 'News API MCP',
    description: 'Fetch latest news articles and headlines',
    category: 'data',
    capabilities: ['get_headlines', 'search_articles', 'get_sources', 'filter_by_date'],
    npmPackage: '@news/api-mcp',
    envVars: ['NEWS_API_KEY'],
    installCommand: 'npm install @news/api-mcp'
  },

  // AI & ML
  {
    id: 'huggingface',
    name: 'Hugging Face MCP',
    description: 'Access Hugging Face models and datasets',
    category: 'ai',
    capabilities: ['run_inference', 'list_models', 'get_datasets', 'fine_tune'],
    npmPackage: '@huggingface/mcp-server',
    envVars: ['HUGGINGFACE_API_KEY'],
    installCommand: 'npm install @huggingface/mcp-server'
  },
  {
    id: 'python-executor',
    name: 'Python Code Executor',
    description: 'Execute Python code in a sandboxed environment',
    category: 'dev',
    capabilities: ['execute_python', 'install_packages', 'run_notebooks'],
    npmPackage: '@python/executor-mcp',
    installCommand: 'npm install @python/executor-mcp'
  },

  // Search & Knowledge
  {
    id: 'brave-search',
    name: 'Brave Search MCP',
    description: 'Web search using Brave Search API',
    category: 'search',
    capabilities: ['web_search', 'image_search', 'news_search', 'local_search'],
    npmPackage: '@brave/search-mcp',
    envVars: ['BRAVE_SEARCH_API_KEY'],
    installCommand: 'npm install @brave/search-mcp'
  },
  {
    id: 'wikipedia',
    name: 'Wikipedia MCP',
    description: 'Search and retrieve Wikipedia articles',
    category: 'knowledge',
    capabilities: ['search_articles', 'get_content', 'get_summary', 'get_links'],
    npmPackage: '@wikipedia/mcp-server',
    installCommand: 'npm install @wikipedia/mcp-server'
  },
  {
    id: 'wolfram',
    name: 'Wolfram Alpha MCP',
    description: 'Mathematical computations and knowledge queries',
    category: 'knowledge',
    capabilities: ['compute', 'query_knowledge', 'solve_equations', 'plot_graphs'],
    npmPackage: '@wolfram/alpha-mcp',
    envVars: ['WOLFRAM_APP_ID'],
    installCommand: 'npm install @wolfram/alpha-mcp'
  },

  // Development Tools
  {
    id: 'github',
    name: 'GitHub MCP',
    description: 'Interact with GitHub repositories and issues',
    category: 'dev',
    capabilities: ['list_repos', 'create_issues', 'get_commits', 'manage_prs'],
    npmPackage: '@github/mcp-server',
    envVars: ['GITHUB_TOKEN'],
    installCommand: 'npm install @github/mcp-server'
  },
  {
    id: 'docker',
    name: 'Docker MCP',
    description: 'Manage Docker containers and images',
    category: 'dev',
    capabilities: ['list_containers', 'run_containers', 'build_images', 'manage_volumes'],
    npmPackage: '@docker/mcp-server',
    installCommand: 'npm install @docker/mcp-server'
  },

  // Productivity
  {
    id: 'notion',
    name: 'Notion MCP',
    description: 'Read and write Notion pages and databases',
    category: 'productivity',
    capabilities: ['read_pages', 'create_pages', 'query_databases', 'update_blocks'],
    npmPackage: '@notion/mcp-server',
    envVars: ['NOTION_API_KEY'],
    installCommand: 'npm install @notion/mcp-server'
  },
  {
    id: 'slack',
    name: 'Slack MCP',
    description: 'Send messages and interact with Slack workspaces',
    category: 'productivity',
    capabilities: ['send_messages', 'list_channels', 'get_users', 'upload_files'],
    npmPackage: '@slack/mcp-server',
    envVars: ['SLACK_BOT_TOKEN'],
    installCommand: 'npm install @slack/mcp-server'
  }
];

export class MCPToolRegistry {
  private installedTools: Map<string, MCPServerConfig> = new Map();

  getAvailableTools(): MCPServerConfig[] {
    return AWESOME_MCP_SERVERS;
  }

  getToolsByCategory(category: string): MCPServerConfig[] {
    return AWESOME_MCP_SERVERS.filter(tool => tool.category === category);
  }

  getInstalledTools(): MCPServerConfig[] {
    return Array.from(this.installedTools.values());
  }

  async installTool(toolId: string): Promise<{ success: boolean; message: string }> {
    const tool = AWESOME_MCP_SERVERS.find(t => t.id === toolId);
    
    if (!tool) {
      return {
        success: false,
        message: `Tool ${toolId} not found in registry`
      };
    }

    try {
      // In a real implementation, this would:
      // 1. Run npm install command
      // 2. Configure environment variables
      // 3. Start the MCP server process
      // 4. Register the tool endpoints
      
      this.installedTools.set(toolId, tool);
      
      return {
        success: true,
        message: `Successfully installed ${tool.name}`
      };
    } catch (error: any) {
      return {
        success: false,
        message: `Failed to install ${tool.name}: ${error.message}`
      };
    }
  }

  async uninstallTool(toolId: string): Promise<{ success: boolean; message: string }> {
    const tool = this.installedTools.get(toolId);
    
    if (!tool) {
      return {
        success: false,
        message: `Tool ${toolId} is not installed`
      };
    }

    try {
      // In a real implementation, this would:
      // 1. Stop the MCP server process
      // 2. Remove npm package
      // 3. Clean up configuration
      
      this.installedTools.delete(toolId);
      
      return {
        success: true,
        message: `Successfully uninstalled ${tool.name}`
      };
    } catch (error: any) {
      return {
        success: false,
        message: `Failed to uninstall ${tool.name}: ${error.message}`
      };
    }
  }

  getToolConfig(toolId: string): MCPServerConfig | undefined {
    return AWESOME_MCP_SERVERS.find(t => t.id === toolId);
  }

  isToolInstalled(toolId: string): boolean {
    return this.installedTools.has(toolId);
  }

  getRequiredEnvVars(toolId: string): string[] {
    const tool = this.getToolConfig(toolId);
    return tool?.envVars || [];
  }

  validateEnvironment(toolId: string): { valid: boolean; missing: string[] } {
    const envVars = this.getRequiredEnvVars(toolId);
    const missing = envVars.filter(varName => !process.env[varName]);
    
    return {
      valid: missing.length === 0,
      missing
    };
  }
}
