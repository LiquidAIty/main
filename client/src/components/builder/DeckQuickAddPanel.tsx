import type { AgentCardInstance } from "../../types/agentgraph";
import {
  DECK_NODE_PRESETS,
  findDeckNodePreset,
  getAssistStarterRecipe,
  getCommonAssistNextPresetKeys,
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
  anchorCard,
  onAddPreset,
  onCreateAssistStarter,
  colors,
}: {
  anchorCard: AgentCardInstance | null;
  onAddPreset: (presetKey: string) => void;
  onCreateAssistStarter: () => void;
  colors: DeckQuickAddPanelColors;
}) {
  const commonPresets = getCommonAssistNextPresetKeys(anchorCard)
    .map((presetKey) => findDeckNodePreset(presetKey))
    .filter((preset): preset is DeckNodePreset => Boolean(preset));
  const assistStarterRecipe = getAssistStarterRecipe(anchorCard);
  const helperText = anchorCard
    ? "New cards appear beside the selected node and connect from it so the new link is immediately visible."
    : "Start with the common Assist roles below, then wire the rest with visible links only.";

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
        Quick Add
      </div>
      {assistStarterRecipe && (
        <div
          style={{
            marginBottom: 10,
            padding: "10px 12px",
            borderRadius: 10,
            border: `1px solid ${colors.primary}`,
            background: "rgba(79,162,173,0.08)",
          }}
        >
          <div className="text-xs" style={{ color: colors.text, fontWeight: 700, marginBottom: 6 }}>
            Assist Starter
          </div>
          <div className="text-xs" style={{ color: colors.neutral, lineHeight: 1.5, marginBottom: 8 }}>
            {assistStarterRecipe.presetKeys
              .map((presetKey) => findDeckNodePreset(presetKey)?.label || presetKey)
              .join(" -> ")}
          </div>
          <button
            onClick={onCreateAssistStarter}
            style={{
              width: "100%",
              padding: "9px 12px",
              borderRadius: 8,
              border: `1px solid ${colors.primary}`,
              background: "rgba(79,162,173,0.16)",
              color: colors.text,
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            {assistStarterRecipe.label}
          </button>
        </div>
      )}
      {commonPresets.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div className="text-xs" style={{ color: colors.neutral, marginBottom: 8 }}>
            {anchorCard ? "Common Next" : "Assist MVP Roles"}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {commonPresets.map((preset) => (
              <button
                key={`common:${preset.key}`}
                onClick={() => onAddPreset(preset.key)}
                style={{
                  padding: "8px 10px",
                  borderRadius: 999,
                  border: `1px solid ${colors.border}`,
                  background: "rgba(255,255,255,0.04)",
                  color: colors.text,
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 8,
        }}
      >
        {DECK_NODE_PRESETS.map((preset) => (
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
      <div className="text-xs" style={{ color: colors.neutral, marginTop: 10, lineHeight: 1.5 }}>
        {helperText}
      </div>
    </div>
  );
}
