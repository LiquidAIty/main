import { describe, expect, it } from 'vitest';

import {
  createInternalMcpBearer,
  resolveInternalMcpUrl,
  verifyInternalMcpBearerForTest,
  withoutInternalMcpSecret,
} from './internalMcpAuth';

const env = {
  LIQUIDAITY_INTERNAL_MCP_SECRET: '0123456789abcdef0123456789abcdef',
  LIQUIDAITY_INTERNAL_MCP_URL: 'http://127.0.0.1:8765/mcp',
};

describe('internal MCP Card authentication', () => {
  it('signs fixed server-owned Card identity and grants', () => {
    const token = createInternalMcpBearer({
      kind: 'card-runtime',
      projectId: 'project-1',
      deckId: 'deck_builder',
      conversationId: 'conversation-1',
      parentRunId: 'run-1',
      callerCardId: 'card-main',
      callerRuntimeKind: 'hermes',
      callerRuntimeMode: 'main',
      grantedTools: ['canvas.inspect', 'canvas.inspect', 'card.run_assistant_agent'],
    }, env, 1000);
    const claims = verifyInternalMcpBearerForTest(token, env);
    expect(claims).toMatchObject({
      iss: 'liquidaity-runtime',
      aud: 'liquidaity-internal-mcp',
      iat: 1000,
      principal: {
        kind: 'card-runtime',
        callerCardId: 'card-main',
        callerRuntimeKind: 'hermes',
        callerRuntimeMode: 'main',
        grantedTools: ['canvas.inspect', 'card.run_assistant_agent'],
      },
    });
  });

  it('keeps the signing secret out of model runtime environments', () => {
    const child = withoutInternalMcpSecret({ ...env, SAFE: 'yes' });
    expect(child.LIQUIDAITY_INTERNAL_MCP_SECRET).toBeUndefined();
    expect(child.SAFE).toBe('yes');
  });

  it('accepts only the canonical loopback MCP seam', () => {
    expect(resolveInternalMcpUrl(env)).toBe('http://127.0.0.1:8765/mcp');
    expect(() => resolveInternalMcpUrl({ ...env, LIQUIDAITY_INTERNAL_MCP_URL: 'https://example.com/mcp' }))
      .toThrow('internal_mcp_url_must_be_loopback_http');
  });
});
