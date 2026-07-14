import { describe, expect, it } from 'vitest';
import {
  buildEpisodePatch,
  validateEpisodeInput,
  syntheticSeedProvenance,
  EPISODE_NODE_KINDS,
  type EpisodeInput,
} from './episodeContract';
import { validateThinkGraphPatch, type ThinkGraphPatchAuthority } from './thinkGraphStore';

const AUTH: ThinkGraphPatchAuthority = {
  projectId: 'p1',
  cardId: 'card_main_chat',
  correlationId: 'trace_1',
  conversationId: 'main',
};

function fullEpisode(overrides: Partial<EpisodeInput> = {}): EpisodeInput {
  const nodes: EpisodeInput['nodes'] = {};
  for (const kind of EPISODE_NODE_KINDS) {
    if (kind === 'Goal') continue;
    nodes[kind] = { summary: `${kind} summary` };
  }
  return {
    episodeId: 'ep_1',
    projectId: 'p1',
    conversationId: 'main',
    provenance: {
      source: 'real_run',
      verified: true,
      productProof: true,
      trainingEligibility: 'eligible',
      provider: 'openrouter',
      model: 'glm-5.2',
      authorityMode: 'direct_main_audit',
    },
    goalText: 'Understand the coder runtime collapse',
    nodes,
    graphRefs: { codeGraph: ['coderRouter.ts::runCoderSubagent', 'coderConsoleRuntime.ts'], knowGraph: ['kg_1'] },
    artifacts: [
      { kind: 'terminal_transcript', path: 'coder-workspace/runs/coder_1/transcript.txt', hash: 'abc', ownerNode: 'SpecialistInvocation' },
      { kind: 'test_log', path: 'coder-workspace/runs/coder_1/tests.log', ownerNode: 'TestResult' },
    ],
    judgment: 'accepted',
    ...overrides,
  };
}

function resourceIds(patch: ReturnType<typeof buildEpisodePatch>): Set<string> {
  return new Set((patch.resources ?? []).map((r) => r.id));
}

describe('validateEpisodeInput', () => {
  it('accepts a well-formed episode', () => {
    expect(validateEpisodeInput(fullEpisode())).toBeNull();
  });

  it('rejects missing identity / goal / provenance', () => {
    expect(validateEpisodeInput(fullEpisode({ episodeId: '' }))).toBe('episode_episodeId_required');
    expect(validateEpisodeInput(fullEpisode({ goalText: '' }))).toBe('episode_goal_text_required');
    expect(validateEpisodeInput({ ...fullEpisode(), provenance: undefined as never })).toBe('episode_provenance_required');
  });

  it('refuses a synthetic seed that claims verified/product_proof', () => {
    const bad = fullEpisode({ provenance: { source: 'synthetic_seed', verified: true, productProof: false, trainingEligibility: 'needs_review' } });
    expect(validateEpisodeInput(bad)).toBe('synthetic_seed_cannot_be_verified_or_product_proof');
  });

  it('rejects an unknown node kind', () => {
    const input = fullEpisode();
    (input.nodes as Record<string, unknown>).Bogus = { summary: 'x' };
    expect(validateEpisodeInput(input)).toBe('episode_unknown_node_kind: Bogus');
  });
});

describe('buildEpisodePatch', () => {
  it('produces a patch that PASSES the generic store validator', () => {
    const patch = buildEpisodePatch(fullEpisode());
    expect(validateThinkGraphPatch(AUTH, patch)).toBeNull();
  });

  it('records the Episode root with provenance + training labels', () => {
    const patch = buildEpisodePatch(fullEpisode());
    const episode = (patch.resources ?? []).find((r) => r.id === 'ep_1');
    expect(episode?.kind).toBe('Episode');
    expect(episode?.properties).toMatchObject({
      source: 'real_run',
      verified: true,
      product_proof: true,
      training_eligibility: 'eligible',
      judgment: 'accepted',
      provider: 'openrouter',
      authority_mode: 'direct_main_audit',
      code_graph_ref_count: 2,
    });
  });

  it('creates one kind-tagged resource per present node and skips absent ones', () => {
    const input = fullEpisode({ nodes: { MainReasoning: { summary: 'reasoned' } } }); // only Goal + MainReasoning
    const patch = buildEpisodePatch(input);
    const kinds = (patch.resources ?? []).map((r) => r.kind);
    expect(kinds).toContain('Goal');
    expect(kinds).toContain('MainReasoning');
    expect(kinds).not.toContain('MagOneRun');
  });

  it('holds triple-closure: every statement endpoint is a declared resource', () => {
    const patch = buildEpisodePatch(fullEpisode());
    const ids = resourceIds(patch);
    for (const st of patch.statements ?? []) {
      expect(ids.has(st.subject)).toBe(true);
      expect(ids.has(st.object)).toBe(true);
    }
  });

  it('chains the lineage (has_step then then…) and links artifacts by evidence', () => {
    const patch = buildEpisodePatch(fullEpisode());
    const preds = (patch.statements ?? []).map((s) => s.predicateTerm);
    expect(preds).toContain('has_step');
    expect(preds).toContain('then');
    expect(preds).toContain('evidence');
    const artifact = (patch.resources ?? []).find((r) => r.kind === 'Artifact');
    expect(artifact?.properties).toMatchObject({ artifact_kind: 'terminal_transcript' });
    expect(String(artifact?.properties?.path)).toMatch(/transcript\.txt$/);
  });

  it('stays within the store limits and reports dropped artifacts (no silent truncation)', () => {
    const artifacts = Array.from({ length: 100 }, (_, i) => ({ kind: 'diff', path: `d/${i}.patch` }));
    const patch = buildEpisodePatch(fullEpisode({ artifacts }));
    expect((patch.resources ?? []).length).toBeLessThanOrEqual(40);
    expect((patch.statements ?? []).length).toBeLessThanOrEqual(30);
    expect(validateThinkGraphPatch(AUTH, patch)).toBeNull();
    const episode = (patch.resources ?? []).find((r) => r.id === 'ep_1');
    expect(Number(episode?.properties?.artifacts_dropped)).toBeGreaterThan(0);
  });

  it('preserves a rejected/negative-example episode honestly', () => {
    const patch = buildEpisodePatch(
      fullEpisode({ judgment: 'rejected', provenance: { source: 'real_run', verified: true, productProof: false, trainingEligibility: 'negative_example' } }),
    );
    const episode = (patch.resources ?? []).find((r) => r.id === 'ep_1');
    expect(episode?.properties).toMatchObject({ judgment: 'rejected', training_eligibility: 'negative_example', product_proof: false });
  });
});

describe('syntheticSeedProvenance', () => {
  it('stamps the mandatory synthetic labels and cannot be relaxed', () => {
    const prov = syntheticSeedProvenance(
      { provider: 'openrouter', model: 'cheap-model', promptVersion: 'seed_v1' },
      // even if a caller tries to relax these, they stay locked:
      { verified: true, productProof: true, source: 'real_run' as never, trainingEligibility: 'eligible' },
    );
    expect(prov.source).toBe('synthetic_seed');
    expect(prov.verified).toBe(false);
    expect(prov.productProof).toBe(false);
    expect(prov.generatorModel).toBe('cheap-model');
    // trainingEligibility override IS allowed (a caller may pick needs_review vs evaluation_only)
    expect(prov.trainingEligibility).toBe('eligible');
  });

  it('the produced episode fails validation if it also claims product proof (defense in depth)', () => {
    const prov = syntheticSeedProvenance({ provider: 'x', model: 'y', promptVersion: 'v1' });
    expect(validateEpisodeInput(fullEpisode({ provenance: prov }))).toBeNull();
    expect(prov.trainingEligibility).toBe('needs_review');
  });
});
