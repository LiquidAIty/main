# n8n Workflow Setup with MCP Integration

## 1. n8n Core Service Setup

### Installation
```bash
npm install -g n8n  # or npm install --save-dev n8n
```

### Configuration
Add to your project's `.env`:
```
N8N_BASIC_AUTH_ACTIVE=true
N8N_BASIC_AUTH_USER=admin
N8N_BASIC_AUTH_PASSWORD=yourpassword
N8N_PORT=5678
```

### Running n8n
```bash
npx n8n start --tunnel
```

### Import Workflow
```bash
npx n8n import:workflow --input=apps/backend/n8n-workflows/initial.json
```

Access at:
- Web UI: http://localhost:5678/workflows
- Webhook: http://localhost:5678/webhook/execute

## 2. n8n-mcp UI Integration

### Installation
```bash
git clone https://github.com/czlonkowski/n8n-mcp.git
cd n8n-mcp
npm install
```

### Configuration
Add to `.env`:
```
N8N_BASE_URL=http://localhost:5678
N8N_MCP_ENABLED=true
MCP_PORT=8080
```

Create `mcp-config.json`:
```json
{
  "apiUrl": "http://localhost:5678",
  "webhookPath": "/execute",
  "mcpPort": 8080
}
```

### Running Services
1. First terminal (n8n core):
```bash
npx n8n start --tunnel
```

2. Second terminal (MCP UI):
```bash
cd n8n-mcp
npm run start
```

Access MCP UI at: http://localhost:8080

## Important Notes
- Start n8n core before MCP UI
- Keep both services running during development
- Workflows are saved in this directory
