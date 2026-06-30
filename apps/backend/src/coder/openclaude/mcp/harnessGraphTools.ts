// @graph entity: HarnessGraphTools
// @graph role: harness-mcp-graph-tools
// @graph relates_to: LiquidAItyMcpServer, ThinkGraphDelta, KnowGraphRoute
//
// The Harness-only MCP tool surface for the two project graphs. Registered on the ONE
// LiquidAIty MCP server, so the OpenClaude QueryEngine (Harness chat) can:
//   • read ThinkGraph (slice / search / open-questions / query-seeds / decisions / rejected-paths)
//   • write ThinkGraph through the ONE constrained apply_delta writer
//   • read KnowGraph (slice / search / inspect-evidence / source-context) — READ ONLY
//   • focus / highlight either graph in the existing canvas (ephemeral, no data mutation)
//
// Hard boundaries (enforced structurally — there is simply no tool for the inverse):
//   • Harness has NO knowgraph write tool. KnowGraph is read-only here.
//   • Mag One / Python tools are NOT registered here and never reach this server.
//   • Every ThinkGraph write goes through applyThinkGraphDelta — no alternate writer.
//
// MCP tool names use underscores (provider function-calling forbids dots); the logical
// dotted name (e.g. `thinkgraph.get_slice`) is recorded in each tool description.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  applyThinkGraphDelta,
  getThinkGraphSlice,
  getThinkNodesByClass,
  searchThinkGraph,
  THINK_NODE_CLASSES,
  THINK_PREDICATES,
  type ThinkDelta,
  type ThinkNodeClass,
} from '../../../services/thinkgraph/thinkGraphDelta';
import {
  queryKnowGraphProject,
  readProjectAssertions,
} from '../../../routes/knowgraph.routes';
import { projectExplorationLens, focusKindNeedsEvidence } from '../../../services/knowGraphExploration';

/**
 * The canonical Harness-only graph tool surface, grouped by authority. Single source for the
 * capability declaration (project_context) and the boundary test. There is deliberately NO
 * KnowGraph write group. Registration below uses these exact names.
 */
export const HARNESS_GRAPH_TOOLS = {
  thinkgraphRead: [
    'thinkgraph_get_slice', 'thinkgraph_search', 'thinkgraph_get_open_questions',
    'thinkgraph_get_query_seeds', 'thinkgraph_get_decisions', 'thinkgraph_get_rejected_paths',
  ],
  thinkgraphWrite: ['thinkgraph_apply_delta'],
  knowgraphRead: ['knowgraph_get_slice', 'knowgraph_search', 'knowgraph_inspect_evidence', 'knowgraph_get_source_context'],
  graphNav: ['graph_focus', 'graph_highlight', 'graph_clear_highlight'],
} as const;

const CHANGE_KINDS = ['added', 'refined', 'contradicted', 'superseded', 'rejected', 'unresolved', 'skipped'] as const;

const nodeClassEnum = z.enum(THINK_NODE_CLASSES as unknown as [string, ...string[]]);
const predicateEnum = z.enum(THINK_PREDICATES as unknown as [string, ...string[]]);
const changeEnum = z.enum(CHANGE_KINDS as unknown as [string, ...string[]]);

const applyDeltaShape = {
  provenance: z.object({
    projectId: z.string().min(1),
    conversationId: z.string().min(1),
    turnId: z.string().min(1),
    userMessageId: z.string().min(1),
    assistantMessageId: z.string().min(1),
    origin: z.literal('harness_chat'),
  }),
  deltaId: z.string().optional(),
  nodes: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        class: nodeClassEnum,
        note: z.string().optional(),
        status: z.string().optional(),
        confidence: z.number().nullable().optional(),
        change: changeEnum.optional(),
        knowGraphRef: z.string().nullable().optional(),
      }),
    )
    .optional(),
  edges: z
    .array(
      z.object({
        source: z.string().min(1),
        target: z.string().min(1),
        predicate: predicateEnum,
        rationale: z.string().optional(),
        status: z.string().optional(),
        change: changeEnum.optional(),
      }),
    )
    .optional(),
};

function jsonResult(value: unknown, isError = false) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }], isError };
}

function lc(v: unknown): string {
  return String(v ?? '').toLowerCase();
}

/**
 * Register the Harness-only ThinkGraph / KnowGraph / graph-navigation tools on the
 * provided MCP server. Called once from createLiquidAItyMcpServer.
 */
export function registerHarnessGraphTools(server: McpServer): void {
  // ── ThinkGraph: read ──────────────────────────────────────────────────────────────────
  server.registerTool(
    'thinkgraph_get_slice',
    {
      title: 'ThinkGraph: get slice',
      description:
        'thinkgraph.get_slice — read the project reasoning map. With `refs` returns those nodes; without, the full project slice (capped). Nodes carry class, label, working note, status, confidence; edges carry typed directional predicates. Read this before writing a delta so you build on the existing map instead of duplicating it.',
      inputSchema: { projectId: z.string().min(1), refs: z.array(z.string()).optional(), limit: z.number().optional() },
    },
    async ({ projectId, refs, limit }) => jsonResult(await getThinkGraphSlice({ projectId, refs, limit })),
  );

  server.registerTool(
    'thinkgraph_search',
    {
      title: 'ThinkGraph: search',
      description: 'thinkgraph.search — substring search over ThinkGraph node labels and working notes (project-scoped). Use to find an existing node id to reference in a delta.',
      inputSchema: { projectId: z.string().min(1), query: z.string().min(1) },
    },
    async ({ projectId, query }) => jsonResult(await searchThinkGraph(projectId, query)),
  );

  const byClassTool = (name: string, logical: string, cls: ThinkNodeClass, blurb: string) =>
    server.registerTool(
      name,
      { title: blurb, description: `${logical} — read all ThinkGraph nodes of class ${cls} for the project.`, inputSchema: { projectId: z.string().min(1) } },
      async ({ projectId }) => jsonResult(await getThinkNodesByClass(projectId, [cls])),
    );
  byClassTool('thinkgraph_get_open_questions', 'thinkgraph.get_open_questions', 'Question', 'ThinkGraph: open questions');
  byClassTool('thinkgraph_get_query_seeds', 'thinkgraph.get_query_seeds', 'QuerySeed', 'ThinkGraph: query seeds');
  byClassTool('thinkgraph_get_decisions', 'thinkgraph.get_decisions', 'Decision', 'ThinkGraph: decisions');
  byClassTool('thinkgraph_get_rejected_paths', 'thinkgraph.get_rejected_paths', 'RejectedPath', 'ThinkGraph: rejected paths');

  // ── ThinkGraph: write (the ONE constrained writer) ────────────────────────────────────
  server.registerTool(
    'thinkgraph_apply_delta',
    {
      title: 'ThinkGraph: apply delta',
      description:
        'thinkgraph.apply_delta — the ONLY way to write ThinkGraph. YOU make the semantic choice of what changed this turn (new question, refined hypothesis, contradiction, decision, rejected path, resolved/unresolved entity, query seed) and express it as nodes + typed directional edges. The tool validates integrity ONLY (provenance present, predicate typed, no self-loop, idempotent per turn) — it never invents content. Provenance is required: projectId, conversationId, turnId, userMessageId, assistantMessageId, origin="harness_chat". Notes are concise working rationale, not raw chain-of-thought. Predicates: ' +
        THINK_PREDICATES.join(', ') + '. Node classes: ' + THINK_NODE_CLASSES.join(', ') + '.',
      inputSchema: applyDeltaShape,
    },
    async (input) => {
      const result = await applyThinkGraphDelta(input as unknown as ThinkDelta);
      return jsonResult(result, !result.ok);
    },
  );

  // ── KnowGraph: read-only (NO write tool exists here) ──────────────────────────────────
  server.registerTool(
    'knowgraph_get_slice',
    {
      title: 'KnowGraph: get slice',
      description:
        'knowgraph.get_slice — read a bounded, source-backed semantic neighborhood from KnowGraph via the same exploration lens the canvas uses (entities/tickers/EDGAR sections as nodes, source-backed assertions folded into edges; storage/process roots excluded). Optional focus/focusId drills in. READ ONLY — Harness cannot write KnowGraph.',
      inputSchema: {
        projectId: z.string().min(1),
        focus: z.string().optional(),
        focusId: z.string().optional(),
        lens: z.string().optional(),
        depth: z.number().optional(),
      },
    },
    async ({ projectId, focus, focusId, lens, depth }) => {
      const raw = await queryKnowGraphProject(projectId);
      const includeEvidence = focusKindNeedsEvidence(null) || Boolean(focusId);
      const projected = projectExplorationLens(
        raw.nodes.map((n) => ({ id: n.id, label: n.label, type: n.type, properties: n.properties })),
        raw.relationships.map((r) => ({ id: r.id, from: r.from, to: r.to, type: r.type, properties: r.properties })),
        { focus: focus ?? null, focusId: focusId ?? null, lens: lens ?? 'entity', depth: Number(depth) || 1, includeEvidence },
      );
      return jsonResult({
        focus: projected.focus,
        nodes: projected.nodes.map((n) => ({
          id: n.id, label: n.displayLabel, kind: n.semanticKind, role: n.explorationRole,
          evidenceCount: n.evidenceCount, sourceCount: n.sourceCount, degree: n.degree,
        })),
        edges: projected.edges.map((e) => ({
          id: e.id, source: e.source, target: e.target, predicate: e.predicate,
          directness: e.directness, evidenceIds: e.evidenceIds, sourceIds: e.sourceIds,
        })),
      });
    },
  );

  server.registerTool(
    'knowgraph_search',
    {
      title: 'KnowGraph: search',
      description: 'knowgraph.search — substring search over KnowGraph node labels/types (project-scoped, read-only). Returns matching raw graph ids usable as focusId for knowgraph_get_slice or inspect tools.',
      inputSchema: { projectId: z.string().min(1), query: z.string().min(1), limit: z.number().optional() },
    },
    async ({ projectId, query, limit }) => {
      const raw = await queryKnowGraphProject(projectId);
      const q = lc(query);
      const cap = Math.min(Math.max(Math.trunc(limit ?? 50) || 50, 1), 200);
      const hits = raw.nodes
        .filter((n) => lc(n.label).includes(q) || lc(n.type).includes(q))
        .slice(0, cap)
        .map((n) => ({ id: n.id, label: n.label, type: n.type }));
      return jsonResult({ matches: hits });
    },
  );

  server.registerTool(
    'knowgraph_inspect_evidence',
    {
      title: 'KnowGraph: inspect evidence',
      description:
        'knowgraph.inspect_evidence — read REAL :SourceBackedAssertion rows for the project with full provenance (subject/predicate/object, outcome, confidence, source ref/title/url, evidence_text). Optional `match` filters subject/predicate/object by substring. Read-only — this is the literal evidence behind KnowGraph edges; cite it rather than asserting unsourced facts.',
      inputSchema: { projectId: z.string().min(1), match: z.string().optional(), limit: z.number().optional() },
    },
    async ({ projectId, match, limit }) => {
      const rows = await readProjectAssertions(projectId);
      const m = lc(match);
      const cap = Math.min(Math.max(Math.trunc(limit ?? 50) || 50, 1), 200);
      const filtered = (m ? rows.filter((r) => lc(r.subject).includes(m) || lc(r.predicate).includes(m) || lc(r.object).includes(m)) : rows).slice(0, cap);
      return jsonResult({ count: filtered.length, assertions: filtered });
    },
  );

  server.registerTool(
    'knowgraph_get_source_context',
    {
      title: 'KnowGraph: get source context',
      description: 'knowgraph.get_source_context — group the project source-backed assertions by source (ref/url/title) so you can see what each document actually supports. Optional `sourceRef` narrows to one source. Read-only.',
      inputSchema: { projectId: z.string().min(1), sourceRef: z.string().optional() },
    },
    async ({ projectId, sourceRef }) => {
      const rows = await readProjectAssertions(projectId);
      const want = lc(sourceRef);
      const bySource = new Map<string, { sourceRef: string; sourceTitle: string; sourceUrl: string; assertions: typeof rows }>();
      for (const r of rows) {
        const key = String(r.source_ref || r.source_url || r.source_title || 'unknown');
        if (want && !lc(key).includes(want) && !lc(r.source_url).includes(want) && !lc(r.source_title).includes(want)) continue;
        const bucket = bySource.get(key) ?? { sourceRef: key, sourceTitle: r.source_title, sourceUrl: r.source_url, assertions: [] };
        bucket.assertions.push(r);
        bySource.set(key, bucket);
      }
      return jsonResult({ sources: Array.from(bySource.values()) });
    },
  );

  // ── Graph UI navigation (ephemeral — returns a directive, mutates NO data) ────────────
  const graphTarget = z.enum(['know', 'think']);
  server.registerTool(
    'graph_focus',
    {
      title: 'Graph: focus node',
      description: 'graph.focus — ask the existing canvas to center/select one node in the named graph. Ephemeral navigation only: it returns a focus directive and changes NO graph data.',
      inputSchema: { graph: graphTarget, nodeId: z.string().min(1) },
    },
    async ({ graph, nodeId }) => jsonResult({ navigation: { action: 'focus', graph, nodeId } }),
  );
  server.registerTool(
    'graph_highlight',
    {
      title: 'Graph: highlight nodes',
      description: 'graph.highlight — ask the canvas to highlight a set of nodes in the named graph (optional short note for the lens label). Ephemeral; mutates NO graph data.',
      inputSchema: { graph: graphTarget, nodeIds: z.array(z.string().min(1)).min(1), note: z.string().optional() },
    },
    async ({ graph, nodeIds, note }) => jsonResult({ navigation: { action: 'highlight', graph, nodeIds, note: note ?? null } }),
  );
  server.registerTool(
    'graph_clear_highlight',
    {
      title: 'Graph: clear highlight',
      description: 'graph.clear_highlight — clear any ephemeral highlight/focus lens on the named graph. Mutates NO graph data.',
      inputSchema: { graph: graphTarget },
    },
    async ({ graph }) => jsonResult({ navigation: { action: 'clear_highlight', graph } }),
  );
}
