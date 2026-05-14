import { describe, expect, it } from 'vitest';

import {
  UA_INTERNAL_AGENT_DEFINITIONS,
  UA_WORKBENCH_DEFINITION,
} from './uaAgentDefinitions';
import {
  AGENT_CARD_REGISTRY,
  getApprovalRequiredDefs,
  getCardDef,
  getCardDefsByKind,
  getDefaultConnectedDefs,
  getRailEligibleDefs,
} from './agentCardRegistry';

describe('agentCardRegistry', () => {
  it('contains the existing LiquidAIty cards plus one UA workbench card', () => {
    expect(AGENT_CARD_REGISTRY).toHaveLength(14);
  });

  it('has unique ids', () => {
    const ids = AGENT_CARD_REGISTRY.map((def) => def.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('normalizes every card to the canonical Agent Card and Skill shape', () => {
    for (const def of AGENT_CARD_REGISTRY) {
      expect(def.id).toBeTruthy();
      expect(def.name).toBeTruthy();
      expect(def.title).toBeTruthy();
      expect(def.description).toBeTruthy();
      expect(def.kind).toBeTruthy();
      expect(['headless', 'workbench']).toContain(def.agentKind);
      expect(def.skillId).toBeTruthy();
      expect(def.skill.id).toBe(def.skillId);
      expect(def.skill.title).toBeTruthy();
      expect(def.skill.summary).toBeTruthy();
      expect(def.skill.role).toBeTruthy();
      expect(def.skill.instructions.length).toBeGreaterThan(0);
      expect(Array.isArray(def.toolIds)).toBe(true);
      expect(Array.isArray(def.knowledgeScopes)).toBe(true);
      expect(Array.isArray(def.objectKinds)).toBe(true);
      expect(typeof def.addable).toBe('boolean');
      expect(typeof def.hasUi).toBe('boolean');
      expect(typeof def.hasCanvas).toBe('boolean');
      expect(typeof def.railEligible).toBe('boolean');
      expect(typeof def.requiresPlanApproval).toBe('boolean');
      expect(typeof def.defaultConnected).toBe('boolean');
      expect(['implemented', 'partial', 'placeholder']).toContain(def.capabilityStatus);
      expect(typeof def.runtimeSafe).toBe('boolean');
      expect(def.runtimeType).toBeTruthy();
    }
  });

  it('defines Sol as the only default-connected registry card', () => {
    const defaults = getDefaultConnectedDefs();
    expect(defaults.map((def) => def.id)).toEqual(['sol']);
  });

  it('keeps runtime card kinds available for legacy grouping', () => {
    expect(getCardDefsByKind('bus')).toHaveLength(1);
    expect(getCardDefsByKind('workbench')).toHaveLength(8);
    expect(getCardDefsByKind('core')).toHaveLength(4);
    expect(getCardDefsByKind('signal')).toHaveLength(1);
  });

  it('classifies workbench-capable cards without turning Plan and Knowledge into workbenches', () => {
    const workbenchIds = AGENT_CARD_REGISTRY.filter((def) => def.agentKind === 'workbench').map((def) => def.id);
    expect(workbenchIds).toContain('worldsignals');
    expect(workbenchIds).toContain('code');
    expect(workbenchIds).not.toContain('plan');
    expect(workbenchIds).not.toContain('knowledge');
  });

  it('exposes one UA dashboard workbench and keeps internal UA lenses non-UI', () => {
    const def = getCardDef(UA_WORKBENCH_DEFINITION.id);
    expect(def).toBeDefined();
    expect(def!.agentKind).toBe('workbench');
    expect(def!.skillId).toBe(UA_WORKBENCH_DEFINITION.skillId);
    expect(def!.hasUi).toBe(true);
    expect(def!.hasCanvas).toBe(true);
    expect(def!.uiEngine).toBe('ua_dashboard');
    expect(def!.uiLens).toBe('project_scanner');
    expect(def!.panelKind).toBe(UA_WORKBENCH_DEFINITION.panelKind);
    expect(def!.canvasKind).toBe(UA_WORKBENCH_DEFINITION.canvasKind);
    expect(def!.workspaceSurface).toBe(UA_WORKBENCH_DEFINITION.surfaceId);
    expect(def!.templateId).toBe(UA_WORKBENCH_DEFINITION.templateId);
    expect(def!.addable).toBe(true);
    expect(def!.defaultConnected).toBe(false);
    expect(def!.skills).toEqual(UA_WORKBENCH_DEFINITION.skills);
    expect(UA_INTERNAL_AGENT_DEFINITIONS).toHaveLength(9);
  });

  it('keeps rail eligibility metadata separate from default connection state', () => {
    const railEligible = getRailEligibleDefs();
    expect(railEligible).toHaveLength(11);
    expect(railEligible.some((def) => def.id === 'sol')).toBe(false);
    expect(railEligible.some((def) => def.id === 'assist')).toBe(false);
    expect(railEligible.some((def) => def.id === 'validator')).toBe(false);
    expect(railEligible.every((def) => def.defaultConnected === false)).toBe(true);
  });

  it('keeps approval-required agents explicit', () => {
    const approvalRequired = getApprovalRequiredDefs();
    expect(approvalRequired.map((def) => def.id).sort()).toEqual(
      ['code', 'energy', 'image', 'telescope', 'trading', 'video'].sort(),
    );
  });

  it('returns undefined for unknown card ids', () => {
    expect(getCardDef('nonexistent')).toBeUndefined();
    expect(getCardDef('')).toBeUndefined();
  });
});
