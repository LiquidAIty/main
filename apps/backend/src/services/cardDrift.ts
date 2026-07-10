/**
 * Card config/prompt drift detection — deterministic checks over the SAME
 * card descriptions the dev harness already resolves through the real
 * runtime resolvers. The harness found the first case by hand (a live card
 * prompt referencing the removed apply_live_patch tool); this makes that
 * class of rot self-announcing.
 *
 * Checks are string/structure matching only — no LLM, no prompt rewriting.
 * Findings are advisory: nothing here mutates a card. The one sanctioned
 * migration path is the explicit deck PUT API with CAS, driven by a human
 * decision.
 */

import { RUNTIME_TOOL_SPECS } from '../contracts/runtimeContracts';

/** Tools the Harness sees on the ONE product MCP host (mcp_host.py list_tools
 * mirror — update when that surface changes; drift here is itself drift). */
export const MCP_HOST_TOOL_NAMES = [
  'mag_one.describe_connected_agents',
  'run_mag_one',
  'hermes.preflight_context',
  'write_mag_one_instructions',
  'read_model_results',
  'canvas.inspect',
  'card.update_configuration',
  'canvas.upsert_wire',
  'card.assign_runtime_skill',
  'card.assign_data_binding',
  'thinkgraph.get_graph_slice',
  'card.run_assistant_agent',
] as const;

/** Removed tool names that must no longer appear in any live card prompt —
 * each entry is a tombstone from a real deletion (DONT.md purge log). */
export const REMOVED_TOOL_TOMBSTONES = [
  'thinkgraph_apply_live_patch',
  'mcp__liquidaity__thinkgraph_apply_live_patch',
  'apply_live_patch',
  'coder_console_task',
  'execute_visible_flow',
  'process_conversation_pair',
] as const;

export type DriftCardInput = {
  cardId: string;
  title: string;
  runtimeType: string | null;
  runtimeBinding: string | null;
  connected: boolean;
  enabled: boolean;
  prompt: string;
  provider: string | null;
  modelKey: string | null;
  resolved: { provider: string; providerModelId: string; tools: string[] } | null;
  resolutionError: string | null;
};

export type DriftFinding = {
  cardId: string;
  kind:
    | 'removed_tool_reference'
    | 'unknown_tool_reference'
    | 'model_resolution_failed'
    | 'connected_but_not_callable'
    | 'connected_but_disabled'
    | 'missing_model_config';
  severity: 'problem' | 'warning';
  detail: string;
};

function livePromptToolTokens(): Set<string> {
  const tokens = new Set<string>();
  for (const spec of RUNTIME_TOOL_SPECS) tokens.add(spec.name);
  for (const name of MCP_HOST_TOOL_NAMES) {
    tokens.add(name);
    // The Harness-visible MCP alias form (mcp__liquidaity__<name with dots as _>).
    tokens.add(`mcp__liquidaity__${name.replace(/\./g, '_')}`);
  }
  return tokens;
}

/** Deterministic drift detection over resolved card descriptions (pure). */
export function detectCardDrift(cards: DriftCardInput[]): DriftFinding[] {
  const findings: DriftFinding[] = [];
  const liveTokens = livePromptToolTokens();

  for (const card of cards) {
    const prompt = String(card.prompt || '');

    // Removed-tool tombstones anywhere in the live prompt are a problem.
    // Longest match wins so nested tombstones (apply_live_patch inside the
    // mcp__liquidaity__… alias) report once, not three times.
    const matchedTombstones = [...REMOVED_TOOL_TOMBSTONES]
      .filter((tombstone) => prompt.includes(tombstone))
      .sort((a, b) => b.length - a.length)
      .filter((tombstone, _, matched) => !matched.some((other) => other !== tombstone && other.includes(tombstone)));
    for (const tombstone of matchedTombstones) {
      findings.push({
        cardId: card.cardId,
        kind: 'removed_tool_reference',
        severity: 'problem',
        detail: `live prompt references removed tool '${tombstone}' — needs an explicit deck migration (never a silent rewrite)`,
      });
    }

    // mcp__-prefixed tokens in the prompt that are not on the live surface.
    for (const match of prompt.matchAll(/mcp__[A-Za-z0-9_.]+/g)) {
      const token = match[0].replace(/[.,)]+$/, '');
      const isTombstone = (REMOVED_TOOL_TOMBSTONES as readonly string[]).some((t) => token.includes(t));
      if (!liveTokens.has(token) && !isTombstone) {
        findings.push({
          cardId: card.cardId,
          kind: 'unknown_tool_reference',
          severity: 'warning',
          detail: `live prompt references '${token}' which is not on the live MCP/tool surface`,
        });
      }
    }

    if (card.resolutionError) {
      findings.push({
        cardId: card.cardId,
        kind: card.resolutionError.startsWith('card_model_config_missing')
          ? 'missing_model_config'
          : 'model_resolution_failed',
        severity: 'problem',
        detail: `runtime resolution fails: ${card.resolutionError}`,
      });
      if (card.connected) {
        findings.push({
          cardId: card.cardId,
          kind: 'connected_but_not_callable',
          severity: 'problem',
          detail: 'card is on the Mag One bus but its config cannot resolve — a team run selecting it will fail',
        });
      }
    }

    if (card.connected && !card.enabled) {
      findings.push({
        cardId: card.cardId,
        kind: 'connected_but_disabled',
        severity: 'warning',
        detail: 'card is bus-connected but disabled — Mag One sees it as eligible while runs will refuse it',
      });
    }
  }

  // De-duplicate identical findings (a tombstone may match twice via substrings).
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = `${finding.cardId}:${finding.kind}:${finding.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
