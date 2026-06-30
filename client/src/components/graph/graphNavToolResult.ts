// Thin carrier: turn a Harness graph-navigation MCP tool-result (graph_focus / graph_highlight /
// graph_clear_highlight) into an ephemeral GraphExplorerCore selection-store action. No graph data
// is ever written. Tolerant of either the raw `{navigation}` payload or an MCP `{content:[{text}]}`
// wrapper. Kept out of the page component so it is independently testable.
import { graphSelection } from './graphSelectionStore';

const GRAPH_NAV_TOOLS = new Set(['graph_focus', 'graph_highlight', 'graph_clear_highlight']);

type Nav = { action?: string; nodeId?: unknown; nodeIds?: unknown } | null;

export function applyGraphNavToolResult(toolName: string, output: string): boolean {
  if (!GRAPH_NAV_TOOLS.has(toolName)) return false;
  let nav: Nav = null;
  try {
    const parsed = JSON.parse(output) as Record<string, unknown>;
    nav = (parsed.navigation as Nav) ?? null;
    if (!nav) {
      const text = (parsed.content as { text?: string }[] | undefined)?.[0]?.text;
      if (text) nav = (JSON.parse(text) as { navigation?: Nav }).navigation ?? null;
    }
  } catch {
    return false;
  }
  if (!nav?.action) return false;
  if (nav.action === 'focus' && nav.nodeId) {
    graphSelection.requestFocus(String(nav.nodeId));
    return true;
  }
  if (nav.action === 'highlight' && Array.isArray(nav.nodeIds)) {
    graphSelection.setPinned(nav.nodeIds.map((x) => String(x)));
    return true;
  }
  if (nav.action === 'clear_highlight') {
    graphSelection.clearHighlight();
    return true;
  }
  return false;
}
