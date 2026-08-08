// @vitest-environment node
//
// Wiring assertions for the native Hermes surfaces.
// These read committed/test-time source and assert the surface contract:
//  - rail/card click opens HermesKanbanWorkspace;
//  - the workspace may explicitly open the separate installed-Hermes terminal;
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
const CODER_ROUTES = 'apps/backend/src/routes/coder.routes.ts';
const CONSOLE_SESSION = 'apps/backend/src/coder/openclaude/console/consoleSession.ts';
const CONSOLE_CLIENT = 'client/src/features/agentbuilder/console/openClaudeConsoleClient.ts';
const HERMES_CONSOLE = 'client/src/components/hermes/HermesConsole.tsx';

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

describe('Installed Hermes terminal remains separate from Kanban and Coder', () => {
  it('wires an explicit workspace action to the Hermes terminal component', () => {
    const page = read(AGENTBUILDER);
    const workspace = read(WORKSPACE);
    const terminal = read(HERMES_CONSOLE);
    expect(page).toContain("import HermesConsole");
    expect(page).toContain('openHermesTerminal');
    expect(page).toContain('<HermesConsole');
    expect(workspace).toContain('onOpenTerminal');
    expect(workspace).toContain('data-testid="hermes-terminal-open"');
    expect(terminal).toContain('title="Hermes Terminal"');
    expect(terminal).toContain('hermesConsoleClient');
  });

  it('publishes a separate installed-Hermes route, manager, and client', () => {
    expect(read(CODER_ROUTES)).toContain("'/hermes/console'");
    expect(read(CONSOLE_SESSION)).toContain('HermesConsoleSessionManager');
    expect(read(CONSOLE_SESSION)).toContain('resolveHermesConsoleRuntime');
    expect(read(CONSOLE_CLIENT)).toContain('hermesConsoleClient');
  });

  it('keeps the rail destination Kanban-first instead of adding a second rail icon', () => {
    const rail = read(RAIL);
    expect(rail).toContain('aria-label="Hermes Kanban"');
    expect(rail).not.toContain('rail-hermes-terminal-button');
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

describe('No visible runtime branding in the workspace', () => {
  it('board, workspace and inspector sources contain no branded visible titles', () => {
    for (const rel of [
      'client/src/features/hermeskanban/HermesKanbanBoard.tsx',
      'client/src/features/hermeskanban/HermesKanbanWorkspace.tsx',
      'client/src/features/hermeskanban/HermesKanbanInspector.tsx',
      'client/src/features/hermeskanban/KanbanBoardTabs.tsx',
      'client/src/features/hermeskanban/KanbanTaskTabs.tsx',
    ]) {
      const source = read(rel);
      expect(source, rel).not.toContain('Hermes Kanban ·');
      expect(source, rel).not.toContain('Hermes · Board');
      expect(source, rel).not.toContain('HERMES ·');
      expect(source, rel).not.toContain('live native board');
      expect(source, rel).not.toContain('>Hermes<');
      expect(source, rel).not.toContain('"Hermes"');
    }
  });

  it('uses icon-only header controls with accessible labels (no visible gateway/add/inspector text)', () => {
    const board = read('client/src/features/hermeskanban/HermesKanbanBoard.tsx');
    expect(board).toContain('aria-label="Add task"');
    expect(board).toContain('aria-label={inspectorOpen ? \'Close inspector\' : \'Open inspector\'}');
    expect(board).toContain('aria-label=');
    // No visible "Gateway" / "Add Task" / "Inspector" labels remain.
    expect(board).not.toMatch(/Add Task</);
    expect(board).not.toMatch(/>Inspector</);
  });

  it('no decorative count pills, profile chips, or boxed empty placards remain', () => {
    const board = read('client/src/features/hermeskanban/HermesKanbanBoard.tsx');
    expect(board).not.toContain("'Empty'");
    expect(board).not.toContain('>Empty<');
    expect(board).not.toContain('dashed rgba(167,176,186,0.18)');
    // profile/assignee chips removed from cards
    expect(board).not.toContain('P{task.priority}');
    expect(board).not.toContain('task.tenant ?');
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
