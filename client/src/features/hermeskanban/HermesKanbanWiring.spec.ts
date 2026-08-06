// @vitest-environment node
//
// Wiring + no-terminal source assertions for the in-app Hermes Kanban.
// These read committed/test-time source and assert the surface contract:
//  - rail/card click opens HermesKanbanWorkspace, never a terminal;
//  - HermesConsole (and every "Hermes Terminal" affordance) is gone;
//  - Coder terminal infrastructure is untouched;
//  - the Agent Card inspector (AgentManager) is unchanged;
//  - the Hermes Kanban uses only the /api/hermes-kanban bridge (no second
//    kanban/database authority).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(process.cwd());
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

const AGENTBUILDER = 'client/src/pages/agentbuilder.tsx';
const RAIL = 'client/src/features/agentbuilder/core/AgentBuilderRail.tsx';
const WORKSPACE = 'client/src/features/hermeskanban/HermesKanbanWorkspace.tsx';
const API = 'client/src/features/hermeskanban/api.ts';
const INSPECTOR = 'client/src/features/hermeskanban/HermesKanbanInspector.tsx';
const AGENT_MANAGER = 'client/src/components/AgentManager.tsx';

describe('Hermes rail/card click opens the Kanban workspace', () => {
  it('renders HermesKanbanWorkspace in the page and wires the rail click to open it', () => {
    const page = read(AGENTBUILDER);
    const rail = read(RAIL);
    expect(page).toContain("import HermesKanbanWorkspace");
    expect(page).toContain('<HermesKanbanWorkspace');
    expect(page).toContain('data-testid="hermes-kanban-region"');
    expect(page).toContain("hermesKanbanActive={workspaceView === 'hermes'}");
    expect(page).toContain('onOpenHermesKanban={openHermesKanban}');
    expect(rail).toContain('data-testid="rail-hermes-kanban-button"');
    expect(rail).toContain('onOpenHermesKanban');
  });
});

describe('HermesConsole is fully removed (no in-app Hermes terminal)', () => {
  it('deletes the HermesConsole component files', () => {
    const tsx = path.join(root, 'client/src/components/hermes/HermesConsole.tsx');
    const spec = path.join(root, 'client/src/components/hermes/HermesConsole.spec.tsx');
    let tsxMissing = false;
    let specMissing = false;
    try {
      readFileSync(tsx, 'utf8');
    } catch {
      tsxMissing = true;
    }
    try {
      readFileSync(spec, 'utf8');
    } catch {
      specMissing = true;
    }
    expect(tsxMissing).toBe(true);
    expect(specMissing).toBe(true);
  });

  it('contains no Hermes terminal import, state, handler, or test id', () => {
    for (const rel of [AGENTBUILDER, RAIL, WORKSPACE, INSPECTOR]) {
      const source = read(rel);
      expect(source, rel).not.toContain('HermesConsole');
      expect(source, rel).not.toContain('hermesConsoleOpen');
      expect(source, rel).not.toContain('openHermesTerminal');
      expect(source, rel).not.toContain('onOpenHermesTerminal');
      expect(source, rel).not.toContain('rail-hermes-terminal-button');
      expect(source, rel).not.toContain('hermesTerminalActive');
    }
  });

  it('contains no forbidden terminal affordance strings anywhere in the app/page', () => {
    for (const rel of [AGENTBUILDER, WORKSPACE, INSPECTOR, API]) {
      const source = read(rel);
      expect(source, rel).not.toContain('Hermes Terminal');
      expect(source, rel).not.toContain('Start session');
      expect(source, rel).not.toContain('Stop session');
      expect(source, rel).not.toContain('manual override terminal');
      expect(source, rel).not.toContain('interactive Hermes chat');
    }
  });

  it('the rail button is labelled Hermes Kanban and there is no terminal launcher', () => {
    const rail = read(RAIL);
    expect(rail).toContain('aria-label="Hermes Kanban"');
    expect(rail).not.toContain('Hermes Terminal');
    expect(rail).not.toContain('PTY');
  });
});

describe('Shared/Coder terminal infrastructure is untouched', () => {
  it('keeps OpenClaudeConsolePanel as the Coder terminal surface', () => {
    const page = read(AGENTBUILDER);
    expect(page).toContain('OpenClaudeConsolePanel');
    expect(page).toContain('title="OpenClaude Code"');
  });

  it('leaves the Agent Card inspector (AgentManager) unchanged', () => {
    const page = read(AGENTBUILDER);
    expect(page).toContain("import('../components/AgentManager')");
    expect(page).toContain("'Prompt'");
    expect(page).toContain("'Knowledge'");
    expect(page).toContain("'Tools'");
    expect(page).toContain("'Runtime'");
    const manager = read(AGENT_MANAGER);
    // The Agent Card editor still defines the saved Hermes card.
    expect(manager).toContain('agent-manager-save');
    expect(manager).toContain('agent-manager-run');
  });
});

describe('No second Kanban authority is introduced', () => {
  it('the Hermes Kanban frontend only calls the /api/hermes-kanban bridge', () => {
    const api = read(API);
    expect(api).toContain('/api/hermes-kanban');
    // No direct DB / project-store / local-kanban writes from the feature.
    expect(api).toContain('/api/hermes-kanban');
    expect(api).not.toMatch(/fetch\([^)]*projects/);
    const workspace = read(WORKSPACE);
    expect(workspace).not.toContain('localStorage');
  });

  it('the inspector contains kanban-only controls and never renders lanes', () => {
    const inspector = read(INSPECTOR);
    expect(inspector).toContain('RightGlassDrawer');
    expect(inspector).toContain('Board');
    expect(inspector).toContain('Orchestration');
    expect(inspector).toContain('Profiles');
    expect(inspector).toContain('System');
    expect(inspector).toContain('Dependencies');
    expect(inspector).toContain('Activity');
    expect(inspector).toContain('Result');
    expect(inspector).not.toMatch(/kanban-lane/);
    // No terminal-related data surface lives inside the inspector.
    expect(inspector).not.toContain('OpenClaudeConsolePanel');
    expect(inspector).not.toContain('PTY');
  });
});
