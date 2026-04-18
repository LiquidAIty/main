import type { DeckEdge } from "../../types/agentgraph";
import {
  GRAPH_THEME,
  graphDrawerButtonStyle,
  graphDrawerSectionStyle,
} from "../graph/graphVisualTokens";

type DeckEdgeInspectorColors = {
  bg: string;
  panel: string;
  border: string;
  text: string;
  neutral: string;
  warn: string;
};

export default function DeckEdgeInspector({
  edge,
  onDelete,
  sourceLabel,
  targetLabel,
  colors,
}: {
  edge: DeckEdge;
  onDelete: () => void;
  sourceLabel: string;
  targetLabel: string;
  colors: DeckEdgeInspectorColors;
}) {
  const connectionMeaning =
    edge.edgeType === "magentic_option" ? "callable route" : "flow";
  return (
    <div
      style={graphDrawerSectionStyle({
        padding: "12px 14px",
        borderRadius: 8,
      })}
    >
      <div
        className="text-xs"
        style={{ color: GRAPH_THEME.drawer.inputText, fontWeight: 700, marginBottom: 12 }}
      >
        Connection
      </div>
      <div className="space-y-3">
        <div
          className="text-xs"
          style={{
            padding: "10px 12px",
            borderRadius: 8,
            ...graphDrawerSectionStyle({
              borderRadius: 8,
            }),
            color: GRAPH_THEME.drawer.inputMuted,
            lineHeight: 1.5,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{sourceLabel} → {targetLabel}</div>
          <div style={{ opacity: 0.8 }}>type: {connectionMeaning}</div>
        </div>
        <button
          onClick={onDelete}
          style={graphDrawerButtonStyle({
            width: "100%",
            border: `1px solid ${colors.warn}`,
            background: "rgba(217,132,88,0.12)",
            color: GRAPH_THEME.drawer.inputText,
          })}
        >
          Delete Connection
        </button>
      </div>
    </div>
  );
}
