import {
  DECK_NODE_PRESETS,
  type DeckNodePreset,
} from "./deckPresets";

type DeckQuickAddPanelColors = {
  primary: string;
  bg: string;
  border: string;
  text: string;
  neutral: string;
};

export default function DeckQuickAddPanel({
  onAddPreset,
  colors,
}: {
  onAddPreset: (presetKey: string) => void;
  colors: DeckQuickAddPanelColors;
}) {
  const visiblePresets = DECK_NODE_PRESETS.filter((preset) => preset.runtimeType !== "graph_flow");

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
        style={{ color: colors.text, fontWeight: 700, marginBottom: 10 }}
      >
        Add Agent
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 8,
        }}
      >
        {visiblePresets.map((preset) => (
          <button
            key={preset.key}
            onClick={() => onAddPreset(preset.key)}
            style={{
              textAlign: "left",
              padding: "10px 12px",
              borderRadius: 8,
              border: `1px solid ${colors.border}`,
              background: "#202020",
              color: colors.text,
              cursor: "pointer",
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 700 }}>{preset.label}</div>
            <div
              className="text-xs"
              style={{ color: colors.neutral, marginTop: 4, lineHeight: 1.45, opacity: 0.9 }}
            >
              {preset.subtitle}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
