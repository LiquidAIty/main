# Testing the MCP-Based Agent System

## 🚀 Quick Start Testing

### 1. Start the Backend Server
```bash
cd apps/backend
npm run dev
# Server should start on http://localhost:3000
```

### 2. Start the Frontend
```bash
cd client
npm run dev
# Frontend should start on http://localhost:5173
```

### 3. Access the Agent Manager
Navigate to: `http://localhost:5173/agent-manager`

## 🧪 Backend API Testing

### Test Available MCP Tools
```bash
curl -X GET http://localhost:3000/api/mcp/available-tools
```

Expected response:
```json
{
  "ok": true,
  "tools": [
    {
      "name": "Google Sheets MCP",
      "description": "Read and write Google Sheets data",
      "capabilities": ["read_sheets", "write_sheets", "create_sheets"],
      "category": "data"
    }
  ]
}
```

### Test Tool Installation
```bash
curl -X POST http://localhost:3000/api/mcp/install-tool \
  -H "Content-Type: application/json" \
  -d '{"toolId": "youtube-transcript"}'
```

### Test Knowledge Graph Retrieval
```bash
curl -X GET http://localhost:3000/api/mcp/knowledge-graph
```

### Test Hallucination Detection
```bash
curl -X POST http://localhost:3000/api/mcp/check-hallucination \
  -H "Content-Type: application/json" \
  -d '{"content": "The moon is made of cheese and orbits Mars"}'
```

### Test YouTube Transcript Collection
```bash
curl -X POST http://localhost:3000/api/mcp/collect-youtube \
  -H "Content-Type: application/json" \
  -d '{"videoUrl": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}'
```

### Test Code Execution
```bash
curl -X POST http://localhost:3000/api/artifacts/execute \
  -H "Content-Type: application/json" \
  -d '{"code": "console.log(\"Hello from MCP system!\"); return 42;", "language": "javascript"}'
```

## 🎨 Frontend Testing Workflow

### 1. Test Agent Manager Dashboard
- Navigate to `/agent-manager`
- Verify agent performance metrics display
- Test the "Run Tests" button
- Check hallucination alerts appear

### 2. Test Agent Creation
- Go to "Agents" tab
- Create a new agent with custom parameters
- Verify agent appears in the list
- Test agent selection and testing

### 3. Test Canvas Visualization
- Go to "Canvas" tab
- Verify agent workflow visualization
- Test node interactions and connections

### 4. Test Parameters Configuration
- Go to "Parameters" tab
- Adjust temperature, max tokens, model selection
- Test system prompt input
- Verify knowledge graph visualization

### 5. Test MCP Tools Management
- Go to "Tools" tab
- Verify available tools list loads
- Test tool installation
- Configure data collection sources

### 6. Test Knowledge Graph
- Add YouTube URLs, news queries
- Click "Start Data Collection"
- Verify knowledge graph updates
- Test node interactions in D3 visualization

## 🔧 Environment Setup for Full Testing

### Required Environment Variables
Create `.env` file in `apps/backend/`:
```env
# Core API Keys
OPENAI_API_KEY=your_openai_key_here
HUGGINGFACE_API_KEY=your_hf_key_here

# Data Collection APIs
YOUTUBE_API_KEY=your_youtube_key_here
NEWS_API_KEY=your_news_api_key_here
BRAVE_SEARCH_API_KEY=your_brave_key_here

# Google Services
GOOGLE_SHEETS_API_KEY=your_sheets_key_here
GOOGLE_SHEETS_CLIENT_ID=your_client_id_here

# Development Tools
GITHUB_TOKEN=your_github_token_here
SLACK_BOT_TOKEN=your_slack_token_here
NOTION_API_KEY=your_notion_key_here

# Mathematical/Scientific
WOLFRAM_APP_ID=your_wolfram_id_here

# Default Configuration
DEFAULT_MODEL=gpt-4
NODE_ENV=development
```

## 🧪 Unit Testing

### Run Backend Tests
```bash
cd apps/backend
npm test
```

### Test Specific Components
```bash
# Test MCP controller
npm test -- mcp-controller.test.ts

# Test agent orchestrator
npm test -- agent.test.ts

# Test tool registry
npm test -- mcp-tool-registry.test.ts
```

## 🐛 Common Issues & Solutions

### Issue: MCP Tools Not Installing
**Solution**: Check if the MCP server packages are available:
```bash
# Install MCP server dependencies
npm install @modelcontextprotocol/sdk
```

### Issue: Knowledge Graph Not Displaying
**Solution**: Install D3.js dependencies:
```bash
cd client
npm install d3 @types/d3
```

### Issue: API Keys Not Working
**Solution**: Verify environment variables are loaded:
```bash
# Check if .env is in the right location
ls apps/backend/.env

# Test environment loading
node -e "console.log(process.env.OPENAI_API_KEY?.substring(0, 10))"
```

### Issue: CORS Errors
**Solution**: Ensure backend CORS is configured:
```typescript
// In apps/backend/src/main.ts
app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true
}));
```

## 📊 Performance Testing

### Load Testing with Artillery
```bash
npm install -g artillery

# Test MCP endpoints
artillery quick --count 10 --num 5 http://localhost:3000/api/mcp/available-tools
```

### Memory Usage Testing
```bash
# Monitor Node.js memory usage
node --inspect apps/backend/src/main.ts
# Open Chrome DevTools -> Memory tab
```

## 🔍 Debugging Tips

### Enable Debug Logging
```bash
# Set debug environment
DEBUG=mcp:* npm run dev
```

### Test Individual MCP Servers
```bash
# Test MCP server directly
npx @youtube/transcript-mcp --help
```

### Verify Database Connections
```bash
# Check artifacts storage
ls -la .data/artifacts/

# Check knowledge graph data
curl http://localhost:3000/api/mcp/knowledge-graph | jq .
```

## ✅ Testing Checklist

- [ ] Backend server starts without errors
- [ ] Frontend loads Agent Manager interface
- [ ] MCP tools list loads successfully
- [ ] Tool installation works
- [ ] Knowledge graph visualization renders
- [ ] Agent creation and testing functions
- [ ] Hallucination detection responds
- [ ] Code execution works
- [ ] Data collection from external sources
- [ ] Canvas workflow visualization
- [ ] Parameters configuration saves
- [ ] All API endpoints return expected responses

## 🚀 Next Steps After Testing

1. **Install Real MCP Servers**: Replace mock implementations with actual MCP server packages
2. **Configure API Keys**: Add real API keys for external services
3. **Set Up Data Sources**: Connect to actual YouTube, news, and document sources
4. **Deploy Knowledge Graph**: Set up persistent storage for knowledge nodes
5. **Add Mathematical Models**: Integrate actual ML/statistical models
6. **Connect n8n**: Set up n8n workflow visualization
7. **Enable LangGraph**: Implement full LangGraph workflow orchestration
