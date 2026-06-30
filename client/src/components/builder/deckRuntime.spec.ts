import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MAG_ONE_OUTPUT_CONTRACT,
  MAG_ONE_OWL_TASK_LEDGER_CONTRACT,
  OWL_SHAPED_OUTPUT_CONTRACT,
} from './deckRuntime';

describe('reusable OWL-shaped output contract', () => {
  it('explains JSON as the transport format', () => {
    expect(OWL_SHAPED_OUTPUT_CONTRACT).toMatch(/JSON is the transport format/i);
  });

  it('explains OWL-style classes and relations as the semantic layer', () => {
    expect(OWL_SHAPED_OUTPUT_CONTRACT).toMatch(/OWL-style classes/i);
    expect(OWL_SHAPED_OUTPUT_CONTRACT).toMatch(/relations/i);
    expect(OWL_SHAPED_OUTPUT_CONTRACT).toMatch(/assertions/i);
  });

  it('explains property-graph nodes/edges/properties as the storage target', () => {
    expect(OWL_SHAPED_OUTPUT_CONTRACT).toMatch(/property graph/i);
    expect(OWL_SHAPED_OUTPUT_CONTRACT).toMatch(/nodes/i);
    expect(OWL_SHAPED_OUTPUT_CONTRACT).toMatch(/edges/i);
  });

  it('includes sourceRefs, evidence, confidence, and uncertainty', () => {
    expect(OWL_SHAPED_OUTPUT_CONTRACT).toMatch(/sourceRefs/);
    expect(OWL_SHAPED_OUTPUT_CONTRACT).toMatch(/evidence/);
    expect(OWL_SHAPED_OUTPUT_CONTRACT).toMatch(/confidence/);
    expect(OWL_SHAPED_OUTPUT_CONTRACT).toMatch(/uncertainty/);
  });

  it('forbids invention and prefers empty arrays / unavailable marking', () => {
    expect(OWL_SHAPED_OUTPUT_CONTRACT).toMatch(/Do not invent/i);
    expect(OWL_SHAPED_OUTPUT_CONTRACT).toMatch(/empty arrays/i);
    expect(OWL_SHAPED_OUTPUT_CONTRACT).toMatch(/unavailable/i);
  });
});

describe('Mag One OWL-shaped Task Ledger contract', () => {
  it('the default PlanFlow contract embeds the OWL-shaped output + Mag One instructions', () => {
    expect(DEFAULT_MAG_ONE_OUTPUT_CONTRACT).toContain(OWL_SHAPED_OUTPUT_CONTRACT);
    expect(DEFAULT_MAG_ONE_OUTPUT_CONTRACT).toContain(MAG_ONE_OWL_TASK_LEDGER_CONTRACT);
  });

  it('asks ONLY for an OWL-shaped graph payload — no task-object structure', () => {
    expect(DEFAULT_MAG_ONE_OUTPUT_CONTRACT).not.toContain('planFlowTaskObjects');
    expect(DEFAULT_MAG_ONE_OUTPUT_CONTRACT).toContain('graphPayload');
  });

  it('includes task-ledger graph vocabulary (entity + relation classes)', () => {
    for (const entityType of ['project', 'task', 'file', 'skill', 'blocker', 'model', 'graph', 'source', 'decision']) {
      expect(MAG_ONE_OWL_TASK_LEDGER_CONTRACT).toContain(entityType);
    }
    for (const relType of ['depends_on', 'modifies', 'blocked_by', 'uses_skill', 'proves', 'writes_to', 'reads_from', 'supersedes']) {
      expect(MAG_ONE_OWL_TASK_LEDGER_CONTRACT).toContain(relType);
    }
  });

  it('tells Mag One to read graph context before tasking and not invent files/proof', () => {
    expect(MAG_ONE_OWL_TASK_LEDGER_CONTRACT).toMatch(/READ it\s+before tasking/i);
    expect(MAG_ONE_OWL_TASK_LEDGER_CONTRACT).toMatch(/Do not invent repo files/i);
    expect(MAG_ONE_OWL_TASK_LEDGER_CONTRACT).toMatch(/claim proof that does not exist/i);
  });

  it('forbids deterministic intent classification / regex routing in the prompt', () => {
    expect(MAG_ONE_OWL_TASK_LEDGER_CONTRACT).toMatch(/Do not classify user intent with\s+deterministic rules or regex routing/i);
  });

  it('reintroduces no draft-generator naming', () => {
    expect(DEFAULT_MAG_ONE_OUTPUT_CONTRACT.toLowerCase()).not.toContain('draft');
    expect(OWL_SHAPED_OUTPUT_CONTRACT.toLowerCase()).not.toContain('draft');
  });
});

describe('OWL contract distinguishes explicit-assert from never-invent (no graph-empty)', () => {
  it('tells the model to ASSERT graph facts explicitly present in the input', () => {
    expect(OWL_SHAPED_OUTPUT_CONTRACT).toMatch(/ASSERT graph facts that are explicitly present/);
    expect(OWL_SHAPED_OUTPUT_CONTRACT).toMatch(/named things become entities/i);
    expect(OWL_SHAPED_OUTPUT_CONTRACT).toMatch(/relationships .* become relations/i);
  });

  it('forbids returning empty entities/relations when explicit graph facts exist', () => {
    expect(OWL_SHAPED_OUTPUT_CONTRACT).toMatch(/Do not return empty entities\/relations when the input contains explicit/i);
    expect(OWL_SHAPED_OUTPUT_CONTRACT).toMatch(/Return empty arrays ONLY when there is genuinely no reusable/i);
  });

  it('still forbids inventing unknown prices, valuations, unrun proof, and missing repo files', () => {
    expect(OWL_SHAPED_OUTPUT_CONTRACT).toMatch(/Do not invent unknown facts/i);
    expect(OWL_SHAPED_OUTPUT_CONTRACT).toMatch(/a current price with no live quote source/i);
    expect(OWL_SHAPED_OUTPUT_CONTRACT).toMatch(/a current valuation\s+with no source/i);
    expect(OWL_SHAPED_OUTPUT_CONTRACT).toMatch(/proof that was not run/i);
    expect(OWL_SHAPED_OUTPUT_CONTRACT).toMatch(/repo files not in context/i);
  });

  it('clarifies a named entity is not an invention even when a value about it is unknown', () => {
    expect(OWL_SHAPED_OUTPUT_CONTRACT).toMatch(/NOT an invention, even when a\s+specific value about it/i);
    expect(OWL_SHAPED_OUTPUT_CONTRACT).toMatch(/put the missing value in the uncertainty field/i);
  });

  it('requires sourceRefs to be set when facts are drawn from input', () => {
    expect(OWL_SHAPED_OUTPUT_CONTRACT).toMatch(/Set sourceRef\/sourceRefs to where the facts came from/i);
    expect(OWL_SHAPED_OUTPUT_CONTRACT).toMatch(/do not leave them empty when you assert facts/i);
  });

  it('contract requires a nonempty graphPayload when subjects are named', () => {
    expect(MAG_ONE_OWL_TASK_LEDGER_CONTRACT).toMatch(/graphPayload MUST represent them as entities and\s+relations/i);
    expect(MAG_ONE_OWL_TASK_LEDGER_CONTRACT).toMatch(/uncertainty for values you\s+cannot source/i);
  });

  it('default contract no longer tells the model to return empty graph arrays by default', () => {
    expect(DEFAULT_MAG_ONE_OUTPUT_CONTRACT).toMatch(/DO assert into graphPayload the\s+entities and relations explicitly present/i);
    expect(DEFAULT_MAG_ONE_OUTPUT_CONTRACT).toMatch(/return empty graph arrays only\s+when there is genuinely no graph-worthy content/i);
  });

  it('keeps forbidding deterministic intent classification / regex routing (unchanged guard)', () => {
    // The contract still bans regex/keyword routing in its instruction language; the fix here
    // is prompt design, not a deterministic code path.
    expect(MAG_ONE_OWL_TASK_LEDGER_CONTRACT).toMatch(/Do not classify user intent with\s+deterministic rules or regex routing/i);
  });
});

