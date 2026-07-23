import { describe, expect, it } from 'vitest';

import { AUTOGEN_CARD_TOOL_SPECS, HARNESS_MCP_TOOL_SPECS } from './runtimeContracts';

describe('runtime-specific tool catalogs', () => {
  const harness = HARNESS_MCP_TOOL_SPECS.map((spec) => spec.name);
  const autogen = AUTOGEN_CARD_TOOL_SPECS.map((spec) => spec.name);

  it('keeps native graph and control tools in the Harness catalog', () => {
    expect(harness).toEqual(expect.arrayContaining([
      'thinkgraph.get_graph_slice', 'thinkgraph.submit_update', 'thinkgraph.persist_graph_view', 'knowgraph.query',
      'knowgraph.ingest', 'codegraph.status', 'codegraph.search',
      'agentgraph.create_context', 'agentgraph.read_context', 'agentgraph.expand_reference',
      'card.run_assistant_agent', 'web_search',
    ]));
  });

  it('keeps AutoGen-only semantic tools out of the Harness catalog', () => {
    expect(harness).not.toEqual(expect.arrayContaining([
      'read_thinkgraph_scope', 'apply_thinkgraph_patch', 'retrieve_knowgraph_context', 'run_local_coder',
    ]));
    expect(autogen).toEqual(expect.arrayContaining([
      'read_thinkgraph_scope', 'apply_thinkgraph_patch', 'retrieve_knowgraph_context', 'run_local_coder', 'web_search',
    ]));
  });
});
