import type { DeckEdge } from "../../types/agentgraph";

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
      style={{
        padding: "12px 14px",
        borderRadius: 8,
        border: `1px solid ${colors.border}`,
        background: colors.bg,
      }}
    >
      <div
        className="text-xs"
        style={{ color: colors.text, fontWeight: 700, marginBottom: 12 }}
      >
        Connection
      </div>
      <div className="space-y-3">
        <div
          className="text-xs"
          style={{
            padding: "10px 12px",
            borderRadius: 8,
            border: `1px solid ${colors.border}`,
            background: colors.panel,
            color: colors.neutral,
            lineHeight: 1.5,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{sourceLabel} → {targetLabel}</div>
          <div style={{ opacity: 0.8 }}>type: {connectionMeaning}</div>
        </div>
        <button
          onClick={onDelete}
          style={{
            width: "100%",
            padding: "10px 12px",
            borderRadius: 8,
            border: `1px solid ${colors.warn}`,
            background: "rgba(217,132,88,0.12)",
            color: colors.text,
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          Delete Connection
        </button>
      </div>
    </div>
  );
}
