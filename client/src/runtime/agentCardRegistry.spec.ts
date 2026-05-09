import { describe, expect, it } from 'vitest';

import {
  AGENT_CARD_REGISTRY,
  getApprovalRequiredDefs,
  getCardDef,
  getCardDefsByKind,
  getDefaultConnectedDefs,
  getRailEligibleDefs,
  type AgentCardDef,
} from './agentCardRegistry';

describe('agentCardRegistry', () => {
  it('contains exactly 12 agent definitions', () => {
    expect(AGENT_CARD_REGISTRY).toHaveLength(12);
  });

  it('has unique ids', () => {
    const ids = AGENT_CARD_REGISTRY.map((def) => def.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has no undefined or empty required fields', () => {
    for (const def of AGENT_CARD_REGISTRY) {
      expect(def.id).toBeTruthy();
      expect(def.name).toBeTruthy();
      expect(def.description).toBeTruthy();
      expect(def.kind).toBeTruthy();
      expect(def.runtimeType).toBeTruthy();
      expect(typeof def.railEligible).toBe('boolean');
      expect(typeof def.requiresPlanApproval).toBe('boolean');
      expect(typeof def.defaultConnected).toBe('boolean');
      expect(['implemented', 'partial', 'placeholder']).toContain(def.capabilityStatus);
      expect(typeof def.runtimeSafe).toBe('boolean');
    }
  });

  // ── Classification counts ────────────────────────────────────────

  it('has exactly 1 bus agent', () => {
    expect(getCardDefsByKind('bus')).toHaveLength(1);
  });

  it('has exactly 6 workbench agents', () => {
    expect(getCardDefsByKind('workbench')).toHaveLength(6);
  });

  it('has exactly 4 core agents', () => {
    expect(getCardDefsByKind('core')).toHaveLength(4);
  });

  it('has exactly 1 signal agent', () => {
    expect(getCardDefsByKind('signal')).toHaveLength(1);
  });

  // ── Bus (Sol) ────────────────────────────────────────────────────

  it('defines Sol as the bus orchestrator with magentic_one runtime', () => {
    const sol = getCardDef('sol');
    expect(sol).toBeDefined();
    expect(sol!.name).toBe('Sol');
    expect(sol!.kind).toBe('bus');
    expect(sol!.runtimeType).toBe('magentic_one');
    expect(sol!.ownedSurface).toBeNull();
    expect(sol!.railEligible).toBe(false);
    expect(sol!.defaultConnected).toBe(true);
  });

  // ── Workbench agents ─────────────────────────────────────────────

  it('defines Code Agent as a workbench with local_coder runtime', () => {
    const code = getCardDef('code');
    expect(code).toBeDefined();
    expect(code!.kind).toBe('workbench');
    expect(code!.runtimeType).toBe('local_coder');
    expect(code!.ownedSurface).toBe('code');
    expect(code!.defaultConnected).toBe(false);
    expect(code!.requiresPlanApproval).toBe(true);
    expect(code!.capabilityStatus).toBe('partial');
    expect(code!.runtimeSafe).toBe(false);
  });

  it('defines Trading Agent as a workbench owning trading surface', () => {
    const trading = getCardDef('trading');
    expect(trading).toBeDefined();
    expect(trading!.kind).toBe('workbench');
    expect(trading!.ownedSurface).toBe('trading');
    expect(trading!.defaultConnected).toBe(false);
    expect(trading!.requiresPlanApproval).toBe(true);
  });

  it('defines Telescope Agent as a workbench owning telescope surface', () => {
    const telescope = getCardDef('telescope');
    expect(telescope).toBeDefined();
    expect(telescope!.kind).toBe('workbench');
    expect(telescope!.ownedSurface).toBe('telescope');
    expect(telescope!.defaultConnected).toBe(false);
    expect(telescope!.requiresPlanApproval).toBe(true);
  });

  it('defines Energy Agent as a workbench owning energy surface', () => {
    const energy = getCardDef('energy');
    expect(energy).toBeDefined();
    expect(energy!.kind).toBe('workbench');
    expect(energy!.ownedSurface).toBe('energy');
    expect(energy!.defaultConnected).toBe(false);
    expect(energy!.requiresPlanApproval).toBe(true);
    expect(energy!.capabilityStatus).toBe('partial');
    expect(energy!.runtimeSafe).toBe(false);
  });

  it('defines Image Maker Agent as a workbench owning image surface', () => {
    const image = getCardDef('image');
    expect(image).toBeDefined();
    expect(image!.kind).toBe('workbench');
    expect(image!.ownedSurface).toBe('image');
    expect(image!.defaultConnected).toBe(false);
    expect(image!.requiresPlanApproval).toBe(true);
    expect(image!.capabilityStatus).toBe('partial');
    expect(image!.runtimeSafe).toBe(false);
  });

  it('defines Video Agent as a placeholder workbench owning video surface', () => {
    const video = getCardDef('video');
    expect(video).toBeDefined();
    expect(video!.kind).toBe('workbench');
    expect(video!.ownedSurface).toBe('video');
    expect(video!.defaultConnected).toBe(false);
    expect(video!.requiresPlanApproval).toBe(true);
    expect(video!.capabilityStatus).toBe('placeholder');
    expect(video!.runtimeSafe).toBe(false);
  });

  it('does not mark NRGSim/Energy runtime-safe just because it owns a surface', () => {
    const energy = getCardDef('energy');
    expect(energy?.ownedSurface).toBe('energy');
    expect(energy?.railEligible).toBe(true);
    expect(energy?.runtimeSafe).toBe(false);
  });

  // ── Signal agent ─────────────────────────────────────────────────

  it('defines WorldSignals as a signal agent owning worldsignal surface', () => {
    const ws = getCardDef('worldsignals');
    expect(ws).toBeDefined();
    expect(ws!.kind).toBe('signal');
    expect(ws!.ownedSurface).toBe('worldsignal');
    expect(ws!.railEligible).toBe(true);
    expect(ws!.defaultConnected).toBe(true);
    expect(ws!.requiresPlanApproval).toBe(false);
  });

  // ── Core / headless agents ───────────────────────────────────────

  it('defines Plan Agent as core owning plan surface', () => {
    const plan = getCardDef('plan');
    expect(plan).toBeDefined();
    expect(plan!.kind).toBe('core');
    expect(plan!.ownedSurface).toBe('plan');
    expect(plan!.railEligible).toBe(true);
    expect(plan!.defaultConnected).toBe(true);
    expect(plan!.requiresPlanApproval).toBe(false);
  });

  it('defines Knowledge Agent as core owning knowledge surface', () => {
    const knowledge = getCardDef('knowledge');
    expect(knowledge).toBeDefined();
    expect(knowledge!.kind).toBe('core');
    expect(knowledge!.ownedSurface).toBe('knowledge');
    expect(knowledge!.railEligible).toBe(true);
    expect(knowledge!.defaultConnected).toBe(true);
    expect(knowledge!.requiresPlanApproval).toBe(false);
  });

  it('defines Validator Agent as headless core with no surface', () => {
    const validator = getCardDef('validator');
    expect(validator).toBeDefined();
    expect(validator!.kind).toBe('core');
    expect(validator!.ownedSurface).toBeNull();
    expect(validator!.railEligible).toBe(false);
    expect(validator!.defaultConnected).toBe(true);
    expect(validator!.requiresPlanApproval).toBe(false);
  });

  // ── Cross-cutting queries ────────────────────────────────────────

  it('returns exactly 6 default-connected agents', () => {
    const defaults = getDefaultConnectedDefs();
    expect(defaults).toHaveLength(6);
    expect(defaults.map((d) => d.id).sort()).toEqual(
      ['assist', 'knowledge', 'plan', 'sol', 'validator', 'worldsignals'].sort(),
    );
  });

  it('returns exactly 6 agents requiring plan approval', () => {
    const approvalRequired = getApprovalRequiredDefs();
    expect(approvalRequired).toHaveLength(6);
    expect(approvalRequired.map((d) => d.id).sort()).toEqual(
      ['code', 'energy', 'image', 'telescope', 'trading', 'video'].sort(),
    );
  });

  it('returns exactly 9 rail-eligible agents', () => {
    const railEligible = getRailEligibleDefs();
    expect(railEligible).toHaveLength(9);
    // Sol and Validator are not rail-eligible
    expect(railEligible.every((d) => d.id !== 'sol')).toBe(true);
    expect(railEligible.every((d) => d.id !== 'validator')).toBe(true);
  });

  it('returns undefined for unknown card ids', () => {
    expect(getCardDef('nonexistent')).toBeUndefined();
    expect(getCardDef('')).toBeUndefined();
  });

  // ── Workbench agents all have surfaces, headless validator does not ──

  it('ensures all workbench agents own a surface', () => {
    const workbenches = getCardDefsByKind('workbench');
    for (const wb of workbenches) {
      expect(wb.ownedSurface).toBeTruthy();
    }
  });

  it('ensures all workbench agents are opt-in (not default connected)', () => {
    const workbenches = getCardDefsByKind('workbench');
    for (const wb of workbenches) {
      expect(wb.defaultConnected).toBe(false);
    }
  });

  it('ensures all workbench agents require plan approval', () => {
    const workbenches = getCardDefsByKind('workbench');
    for (const wb of workbenches) {
      expect(wb.requiresPlanApproval).toBe(true);
    }
  });

  it('keeps partial or placeholder capabilities out of the runtime-safe set', () => {
    const staged = AGENT_CARD_REGISTRY.filter(
      (def) => def.capabilityStatus === 'partial' || def.capabilityStatus === 'placeholder',
    );
    expect(staged.map((def) => def.id).sort()).toEqual(
      ['code', 'energy', 'image', 'plan', 'telescope', 'trading', 'validator', 'video'].sort(),
    );
    expect(staged.filter((def) => def.id !== 'plan').every((def) => !def.runtimeSafe)).toBe(true);
  });
});
