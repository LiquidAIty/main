// REAL MCP-boundary integration (SPEC: do not mock MCP discovery).
// Connects to the already-supervised official HTTP MCP host through the SDK.
// It is intentionally conditional because this test must never spawn a second host.
import { afterAll, describe, expect, it } from 'vitest';

import {
  closeToolCatalogMcpClient,
  listToolCatalog,
} from './toolCatalogMcpClient';

afterAll(async () => {
  await closeToolCatalogMcpClient();
});

const canonicalHostAvailable = Boolean(
  process.env.LIQUIDAITY_INTERNAL_MCP_SECRET
  && process.env.LIQUIDAITY_INTERNAL_MCP_URL,
);

describe.runIf(canonicalHostAvailable)('Python Agent MCP host — authenticated HTTP discovery', () => {
  it('reads the complete canonical catalog through the catalog-reader principal', async () => {
    const names = (await listToolCatalog()).map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(expect.arrayContaining([
      'canvas.inspect',
      'canvas.upsert_wire',
      'card.create',
      'card.update_configuration',
      'engraphis_recall_context',
      'engraphis_get_memory',
      'engraphis_remember',
      'agentgraph.inspect',
      'mag_one.describe_connected_agents',
      'main.context',
      'run_mag_one',
      'web_search',
    ]));
    // Obsolete model-facing graph and agent-fabric wrappers are all gone.
    expect(names).not.toContain('thinkgraph.process_conversation_pair');
    expect(names).not.toContain('thinkgraph.apply_live_patch');
    expect(names).not.toContain('execute_visible_flow');
    expect(names).not.toContain('describe_agent_fabric');
    expect(names).not.toContain('knowgraph.query');
    expect(names).not.toContain('knowgraph.ingest');
    expect(names).not.toContain('codegraph.search');
    expect(names).not.toContain('codegraph.status');
    expect(names).not.toContain('card.run_assistant_agent');
    expect(names).not.toContain('card.run_agent');
  }, 30_000);

});
