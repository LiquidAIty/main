import type { DeckDocument } from '../../../types/agentgraph';

export function resolveDeckWorkspaceRoot(
  deck: DeckDocument,
  activeWorkbenchRoot?: string | null,
): string | null {
  return String(activeWorkbenchRoot || deck.workspaceRoot || '').trim() || null;
}
