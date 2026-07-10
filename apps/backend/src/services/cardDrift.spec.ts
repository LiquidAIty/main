// Card drift detection: deterministic string/structure checks — removed-tool
// tombstones, unknown mcp__ references, resolution failures, and
// connected-but-broken states. No LLM, no prompt mutation.
import { describe, expect, it } from 'vitest';
import { detectCardDrift, type DriftCardInput } from './cardDrift';

function card(partial: Partial<DriftCardInput>): DriftCardInput {
  return {
    cardId: 'card_x',
    title: 'X',
    runtimeType: 'assistant_agent',
    runtimeBinding: null,
    connected: false,
    enabled: true,
    prompt: '',
    provider: 'openrouter',
    modelKey: 'openai/gpt-5.1-chat',
    resolved: { provider: 'openrouter', providerModelId: 'openai/gpt-5.1-chat', tools: [] },
    resolutionError: null,
    ...partial,
  };
}

describe('detectCardDrift', () => {
  it('flags a removed-tool reference ONCE (longest tombstone wins)', () => {
    const findings = detectCardDrift([
      card({
        cardId: 'card_thinkgraph_agent',
        prompt: 'Use mcp__liquidaity__thinkgraph_apply_live_patch to write the graph.',
      }),
    ]);
    const removed = findings.filter((f) => f.kind === 'removed_tool_reference');
    expect(removed).toHaveLength(1);
    expect(removed[0].severity).toBe('problem');
    expect(removed[0].detail).toContain('mcp__liquidaity__thinkgraph_apply_live_patch');
  });

  it('flags unknown mcp__ tool references but accepts the live surface', () => {
    const findings = detectCardDrift([
      card({
        prompt:
          'Call mcp__liquidaity__run_mag_one then mcp__liquidaity__made_up_tool. Also apply_thinkgraph_patch is fine.',
      }),
    ]);
    const unknown = findings.filter((f) => f.kind === 'unknown_tool_reference');
    expect(unknown).toHaveLength(1);
    expect(unknown[0].detail).toContain('mcp__liquidaity__made_up_tool');
  });

  it('flags resolution failures, connected-but-not-callable, and connected-but-disabled', () => {
    const findings = detectCardDrift([
      card({
        cardId: 'card_broken',
        connected: true,
        resolved: null,
        resolutionError: 'Unknown model key: nope',
      }),
      card({ cardId: 'card_off', connected: true, enabled: false }),
      card({ cardId: 'card_nomodel', resolved: null, resolutionError: 'card_model_config_missing: cardId=card_nomodel' }),
    ]);
    expect(findings.map((f) => `${f.cardId}:${f.kind}`).sort()).toEqual([
      'card_broken:connected_but_not_callable',
      'card_broken:model_resolution_failed',
      'card_nomodel:missing_model_config',
      'card_off:connected_but_disabled',
    ]);
  });

  it('reports nothing for a clean card', () => {
    expect(
      detectCardDrift([card({ prompt: 'Use read_thinkgraph_scope then apply_thinkgraph_patch.' })]),
    ).toEqual([]);
  });
});
