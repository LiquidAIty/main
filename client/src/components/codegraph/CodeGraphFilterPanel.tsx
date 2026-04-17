import { useMemo } from "react";

import { colorForCodeGraphLabel } from "./colors";
import type { CodeGraphData } from "./types";

type CodeGraphFilterPanelProps = {
  data: CodeGraphData;
  enabledLabels: Set<string>;
  enabledEdgeTypes: Set<string>;
  showLabels: boolean;
  onToggleLabel: (label: string) => void;
  onToggleEdgeType: (type: string) => void;
  onToggleShowLabels: () => void;
  onEnableAll: () => void;
  onDisableAll: () => void;
};

export function CodeGraphFilterPanel({
  data,
  enabledLabels,
  enabledEdgeTypes,
  showLabels,
  onToggleLabel,
  onToggleEdgeType,
  onToggleShowLabels,
  onEnableAll,
  onDisableAll,
}: CodeGraphFilterPanelProps): React.ReactElement {
  const { labelCounts, edgeTypeCounts } = useMemo(() => {
    const labelCountMap = new Map<string, number>();
    const edgeCountMap = new Map<string, number>();

    data.nodes.forEach((node) => {
      labelCountMap.set(node.label, (labelCountMap.get(node.label) ?? 0) + 1);
    });
    data.edges.forEach((edge) => {
      edgeCountMap.set(edge.type, (edgeCountMap.get(edge.type) ?? 0) + 1);
    });

    return {
      labelCounts: [...labelCountMap.entries()].sort((a, b) => b[1] - a[1]),
      edgeTypeCounts: [...edgeCountMap.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [data]);

  return (
    <div
      style={{
        padding: "12px 14px",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        display: "grid",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "rgba(255,255,255,0.6)",
            textTransform: "uppercase",
            letterSpacing: "0.12em",
          }}
        >
          Filters
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            onClick={onEnableAll}
            style={{
              fontSize: 10,
              color: "rgba(79,162,173,0.9)",
              background: "transparent",
              border: 0,
              cursor: "pointer",
            }}
          >
            All
          </button>
          <span style={{ color: "rgba(255,255,255,0.2)" }}>|</span>
          <button
            type="button"
            onClick={onDisableAll}
            style={{
              fontSize: 10,
              color: "rgba(79,162,173,0.9)",
              background: "transparent",
              border: 0,
              cursor: "pointer",
            }}
          >
            None
          </button>
        </div>
      </div>

      <div>
        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginBottom: 6 }}>Nodes</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {labelCounts.map(([label, count]) => {
            const enabled = enabledLabels.has(label);
            const labelColor = colorForCodeGraphLabel(label);
            return (
              <button
                key={label}
                type="button"
                onClick={() => onToggleLabel(label)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  borderRadius: 7,
                  border: enabled ? "1px solid rgba(255,255,255,0.14)" : "1px solid transparent",
                  background: enabled ? "rgba(255,255,255,0.05)" : "transparent",
                  opacity: enabled ? 1 : 0.35,
                  fontSize: 10,
                  fontWeight: 600,
                  padding: "4px 6px",
                  cursor: "pointer",
                  color: enabled ? labelColor : "rgba(255,255,255,0.45)",
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: enabled ? labelColor : "#444",
                  }}
                />
                <span>{label}</span>
                <span style={{ color: "rgba(255,255,255,0.4)" }}>{count.toLocaleString()}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginBottom: 6 }}>Edges</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {edgeTypeCounts.map(([type, count]) => {
            const enabled = enabledEdgeTypes.has(type);
            return (
              <button
                key={type}
                type="button"
                onClick={() => onToggleEdgeType(type)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  borderRadius: 7,
                  border: enabled ? "1px solid rgba(255,255,255,0.14)" : "1px solid transparent",
                  background: enabled ? "rgba(255,255,255,0.05)" : "transparent",
                  opacity: enabled ? 1 : 0.35,
                  fontSize: 10,
                  fontWeight: 600,
                  padding: "4px 6px",
                  cursor: "pointer",
                  color: enabled ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.45)",
                }}
              >
                <span>{type.replace(/_/g, " ").toLowerCase()}</span>
                <span style={{ color: "rgba(255,255,255,0.4)" }}>{count.toLocaleString()}</span>
              </button>
            );
          })}
        </div>
      </div>

      <button
        type="button"
        onClick={onToggleShowLabels}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          fontSize: 11,
          fontWeight: 600,
          color: showLabels ? "rgba(79,162,173,1)" : "rgba(255,255,255,0.45)",
          background: "transparent",
          border: 0,
          cursor: "pointer",
          padding: 0,
          justifySelf: "start",
        }}
      >
        <span
          style={{
            width: 14,
            height: 14,
            borderRadius: 4,
            border: showLabels ? "1px solid rgba(79,162,173,0.8)" : "1px solid rgba(255,255,255,0.2)",
            background: showLabels ? "rgba(79,162,173,0.2)" : "transparent",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 9,
          }}
        >
          {showLabels ? "✓" : ""}
        </span>
        Show labels
      </button>
    </div>
  );
}
