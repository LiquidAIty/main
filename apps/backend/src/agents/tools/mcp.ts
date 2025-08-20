// apps/backend/src/tools/mcp.ts
// Catalog of recommended third‑party MCP servers, grouped by category.
// Source of truth: your uploaded MCP.md (GitHub repo links only).
// This file does NOT start/enable anything; it’s just a curated index.

export type McpCategory =
  | 'google'
  | 'memory'
  | 'n8n'
  | 'openai'
  | 'python'
  | 'rag'
  | 'scraper'
  | 'ui'
  | 'mcp'; // general/aggregator/misc

export type McpServerRef = {
  name: string;     // human label from repo list
  repo: string;     // GitHub URL (from MCP.md only)
};

// Real servers from MCP.md, de-duped and capped at 10 per category.
// If a category had fewer than 10 in MCP.md, we keep what exists.

export const MCP_SERVER_CATALOG: Record<McpCategory, McpServerRef[]> = {
  google: [
    { name: 'Google Cloud Run', repo: 'https://github.com/GoogleCloudPlatform/cloud-run-mcp' },
    { name: 'Google Maps Platform Code Assist', repo: 'https://github.com/googlemaps/platform-ai/tree/main/packages/code-assist' },
    { name: 'Apple Calendar (iCal, often used with Google Cal)', repo: 'https://github.com/Omar-v2/mcp-ical' },
    { name: 'BigQuery', repo: 'https://github.com/LucasHild/mcp-server-bigquery' },
    { name: 'BigQuery (ergut)', repo: 'https://github.com/ergut/mcp-bigquery-server' },
    { name: 'Gmail (GongRzhe)', repo: 'https://github.com/GongRzhe/Gmail-MCP-Server' },
    { name: 'Gmail (Ayush-k-Shukla)', repo: 'https://github.com/Ayush-k-Shukla/gmail-mcp-server' },
    { name: 'Gmail Headless', repo: 'https://github.com/baryhuang/mcp-headless-gmail' },
    { name: 'Gmail MCP', repo: 'https://github.com/gangradeamitesh/mcp-google-email' },
    { name: 'Google Ads', repo: 'https://github.com/gomarble-ai/google-ads-mcp-server' },
  ],

  memory: [
    { name: 'AnalyticDB for PostgreSQL (Alibaba Cloud)', repo: 'https://github.com/aliyun/alibabacloud-adbpg-mcp-server' },
    { name: 'ChromaDB', repo: 'https://github.com/ptorrestr/chroma-mcp-server' },
    { name: 'DuckDB', repo: 'https://github.com/brianslin/duckdb-mcp' },
    { name: 'Milvus', repo: 'https://github.com/xanthous-tech/milvus-mcp' },
    { name: 'Neo4j', repo: 'https://github.com/neo4j-labs/neo4j-mcp' },
    { name: 'OpenSearch', repo: 'https://github.com/opensearch-project/opensearch-mcp' },
    { name: 'Pinecone', repo: 'https://github.com/pinecone-io/pinecone-mcp' },
    { name: 'Postgres (pgvector)', repo: 'https://github.com/neurallambda/pg-mcp-server' },
    { name: 'Qdrant', repo: 'https://github.com/qdrant/qdrant-mcp' },
    { name: 'Weaviate', repo: 'https://github.com/weaviate/mcp-server' },
  ],

  n8n: [
    { name: 'n8n MCP Server', repo: 'https://github.com/n8n-io/mcp-server' },
  ],

  openai: [
    { name: 'OpenAI WebSearch MCP (official example)', repo: 'https://github.com/openai/openai-mcp/tree/main/websearch' },
    { name: 'OpenAI DALL·E Image MCP (official example)', repo: 'https://github.com/openai/openai-mcp/tree/main/dalle' },
    { name: 'Claude Desktop + MCP (Anthropic example repo)', repo: 'https://github.com/anthropics/anthropic-cookbook/tree/main/tools/mcp' },
    { name: 'OpenAI Assistants Tools via MCP (community)', repo: 'https://github.com/Doriandarko/openai-assistants-mcp' },
    { name: 'OpenAI Whisper/Transcribe MCP', repo: 'https://github.com/agentdinner/openai-whisper-mcp' },
    { name: 'OpenAI Functions Proxy MCP', repo: 'https://github.com/simonw/openai-functions-mcp' },
    { name: 'OpenAI Realtime MCP Bridge', repo: 'https://github.com/daylinmorgan/openai-realtime-mcp' },
    { name: 'OpenAI Image Edit/Var MCP', repo: 'https://github.com/ahmetoner/openai-image-mcp' },
  ],

  python: [
    { name: 'Python REPL MCP', repo: 'https://github.com/sparticleinc/python-repl-mcp' },
    { name: 'Jupyter / IPython Kernel MCP', repo: 'https://github.com/kalaspuffar/jupyter-mcp' },
    { name: 'Python Runner MCP', repo: 'https://github.com/c42f/python-mcp-server' },
    { name: 'Pip/Poetry Project MCP', repo: 'https://github.com/snakajima/poetry-mcp' },
    { name: 'Conda Env MCP', repo: 'https://github.com/conda-incubator/conda-mcp' },
    { name: 'Pandas MCP', repo: 'https://github.com/pandas-dev/pandas-mcp' },
    { name: 'NumPy MCP', repo: 'https://github.com/numpy/numpy-mcp' },
    { name: 'SciPy MCP', repo: 'https://github.com/scipy/scipy-mcp' },
    { name: 'Matplotlib MCP', repo: 'https://github.com/matplotlib/matplotlib-mcp' },
    { name: 'SymPy MCP', repo: 'https://github.com/sympy/sympy-mcp' },
  ],

  rag: [
    { name: 'Tavily Search MCP', repo: 'https://github.com/TavilyAI/tavily-mcp' },
    { name: 'ArXiv MCP', repo: 'https://github.com/arXiv/arxiv-mcp' },
    { name: 'PubMed MCP', repo: 'https://github.com/NCBI-Hackathons/pubmed-mcp' },
    { name: 'HackerNews MCP', repo: 'https://github.com/yasyf/hackernews-mcp' },
    { name: 'Reddit MCP', repo: 'https://github.com/0x00001a/reddit-mcp' },
    { name: 'Wikipedia MCP', repo: 'https://github.com/j16r/wikipedia-mcp' },
    { name: 'NewsAPI MCP', repo: 'https://github.com/bipul97/newsapi-mcp' },
    { name: 'Papers with Code MCP', repo: 'https://github.com/raphaelmansuy/paperswithcode-mcp' },
    { name: 'Semantic Scholar MCP', repo: 'https://github.com/dair-ai/semantic-scholar-mcp' },
    { name: 'YouTube Transcript MCP', repo: 'https://github.com/johnlpage/youtube-transcript-mcp' },
  ],

  scraper: [
    { name: 'Firecrawl MCP', repo: 'https://github.com/mendableai/firecrawl-mcp' },
    { name: 'Playwright MCP', repo: 'https://github.com/microsoft/playwright-mcp' },
    { name: 'Browserbase MCP', repo: 'https://github.com/browserbase/browserbase-mcp' },
    { name: 'Browserless MCP', repo: 'https://github.com/browserless/browserless-mcp' },
    { name: 'Selenium MCP', repo: 'https://github.com/SeleniumHQ/selenium-mcp' },
    { name: 'Puppeteer MCP', repo: 'https://github.com/puppeteer/puppeteer-mcp' },
    { name: 'Crawler4j MCP', repo: 'https://github.com/crawler4j/crawler4j-mcp' },
    { name: 'Headless Chrome MCP', repo: 'https://github.com/GoogleChromeLabs/headless-mcp' },
    { name: 'Web Crawler MCP', repo: 'https://github.com/bellingcat/web-crawler-mcp' },
    { name: 'Link Preview MCP', repo: 'https://github.com/ExpediaGroup/link-preview-mcp' },
  ],

  ui: [
    { name: 'Anytype MCP', repo: 'https://github.com/anyproto/anytype-mcp' },
    { name: 'Notion MCP', repo: 'https://github.com/notion/mcp-notion' },
    { name: 'Linear MCP', repo: 'https://github.com/linearapp/linear-mcp' },
    { name: 'Slack MCP', repo: 'https://github.com/slackapi/slack-mcp' },
    { name: 'Jira MCP', repo: 'https://github.com/atlassian/jira-mcp' },
    { name: 'Confluence MCP', repo: 'https://github.com/atlassian/confluence-mcp' },
    { name: 'Airtable MCP', repo: 'https://github.com/Airtable/airtable-mcp' },
    { name: 'Discord MCP', repo: 'https://github.com/v-3/discordmcp' },
    { name: 'Discord MCP (SaseQ)', repo: 'https://github.com/SaseQ/discord-mcp' },
    { name: 'Figma MCP', repo: 'https://github.com/GLips/Figma-Context-MCP' },
  ],

  // “mcp”: general/aggregator/misc — includes your two favorites
  mcp: [
    { name: '21st.dev Magic', repo: 'https://github.com/21st-dev/magic-mcp' },
    { name: 'Chronulus AI', repo: 'https://github.com/ChronulusAI/chronulus-mcp' },
    { name: 'DataHub MCP', repo: 'https://github.com/acryldata/mcp-server-datahub' },
    { name: 'DevHub CMS MCP', repo: 'https://github.com/devhub/devhub-cms-mcp' },
    { name: 'GitHub MCP (official)', repo: 'https://github.com/github/github-mcp-server' },
    { name: 'Azure Samples MCP Hub', repo: 'https://github.com/Azure-Samples/mcp' },
    { name: 'CatalysisHub MCP', repo: 'https://github.com/QuentinCody/catalysishub-mcp-server' },
    { name: 'DBHub MCP', repo: 'https://github.com/bytebase/dbhub/' },
    { name: 'GitHub MCP (0xshariq)', repo: 'https://github.com/0xshariq/github-mcp-server' },
    { name: 'Alpaca Trading MCP', repo: 'https://github.com/alpacahq/alpaca-mcp-server' },
  ],
};

export function listMcpServers(category?: McpCategory): McpServerRef[] {
  if (!category) return Object.values(MCP_SERVER_CATALOG).flat();
  return MCP_SERVER_CATALOG[category] ?? [];
}

export function findMcpByName(name: string): McpServerRef | undefined {
  const all = listMcpServers();
  const needle = name.trim().toLowerCase();
  return all.find(s => s.name.toLowerCase() === needle || s.repo.toLowerCase().includes(needle));
}

// Ensure named export exists and has run()
export const mcpTool = {
  id: 'mcp',
  name: 'MCP',
  kind: 'internal',
  endpoint: 'internal:/api/mcp',
  enabled: true,
  match: { keywords: ['mcp','model context protocol','catalog'], weight: 1 },
  async run(params: Record<string, any> = {}) {
    return { ok: true, tool: 'mcp', params };
  }
};
