import type { DeckDocument } from "../../types/agentgraph";

type DeckExecutionPathSummaryColors = {
  bg: string;
  border: string;
  text: string;
  neutral: string;
  warn: string;
};

function safeText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    const json = JSON.stringify(value);
    if (typeof json === "string") return json;
  } catch {
    // fallback below
  }
  return String(value);
}

export default function DeckExecutionPathSummary({
  deck,
  executionPlan,
  colors,
}: {
  deck: DeckDocument;
  executionPlan: {
    simpleOrderCardIds: string[];
    issues: string[];
  };
  colors: DeckExecutionPathSummaryColors;
}) {
  const nodeLabel = new Map(deck.nodes.map((node) => [node.id, safeText(node.title || node.id)] as const));
  const orderedLabels = executionPlan.simpleOrderCardIds
    .map((cardId) => nodeLabel.get(cardId) || cardId)
    .filter(Boolean);
  const hasLoopIssue = executionPlan.issues.some((issue) => issue.toLowerCase().includes("cycle"));

  return (
    <div
      style={{
        padding: "12px 14px",
        borderRadius: 8,
        border: `1px solid ${colors.border}`,
        background: colors.bg,
        marginBottom: 12,
      }}
    >
      <div
        className="text-xs"
        style={{ color: colors.text, fontWeight: 700, marginBottom: 8 }}
      >
        Visible Execution Path
      </div>
      <div className="text-xs" style={{ color: colors.neutral, lineHeight: 1.55 }}>
        {orderedLabels.length > 0 ? orderedLabels.join(" -> ") : "No runnable path yet."}
      </div>
      <div className="text-xs" style={{ color: colors.neutral, marginTop: 8, opacity: 0.85 }}>
        This order comes directly from the drawn links on the canvas.
      </div>
      {hasLoopIssue && (
        <div
          className="text-xs"
          style={{
            color: colors.warn,
            marginTop: 8,
            lineHeight: 1.55,
            padding: "8px 10px",
            borderRadius: 8,
            border: `1px solid rgba(217,132,88,0.34)`,
            background: "rgba(217,132,88,0.08)",
          }}
        >
          Loop detected in the drawn graph. The runtime does not invent a fake simple order through cycles.
        </div>
      )}
    </div>
  );
}
