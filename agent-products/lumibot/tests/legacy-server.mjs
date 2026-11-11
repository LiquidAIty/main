// Disposable protocol-v1 peer using the repository's existing JavaScript SDK.
import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

function createServer() {
  const server = new Server({ name: 'legacy-compatibility-peer', version: '1' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
    { name: 'multiply', description: 'Multiply two integers', inputSchema: { type: 'object', properties: {
      a: { type: 'integer' }, b: { type: 'integer' } }, required: ['a', 'b'], additionalProperties: false } },
    { name: 'refuse', description: 'Return a deliberate tool refusal', inputSchema: { type: 'object', properties: {} } },
  ] }));
  server.setRequestHandler(CallToolRequestSchema, async request => {
    if (request.params.name === 'refuse') return { isError: true, content: [{ type: 'text', text: 'deliberate tool refusal' }] };
    const { a, b } = request.params.arguments;
    if (!Number.isInteger(a) || !Number.isInteger(b)) throw new Error('integers required');
    return { content: [{ type: 'text', text: JSON.stringify({ value: a * b }) }] };
  });
  return server;
}
if (!process.argv[2]) {
  await createServer().connect(new StdioServerTransport());
} else {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => req.headers.authorization === 'Bearer acceptance-only'
    ? next() : res.status(401).json({ error: 'authorization_required' }));
  app.post('/mcp', async (req, res) => {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { void transport.close(); void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  app.all('/mcp', (_req, res) => res.sendStatus(405));
  app.listen(Number(process.argv[2]), '127.0.0.1');
}
