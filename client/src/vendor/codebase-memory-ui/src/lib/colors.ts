/* Node label → color mapping for sidebar/tooltips (structural meaning) */

const LABEL_COLORS: Record<string, string> = {
  Project: "#37ADAA",
  Package: "#4E8F9A",
  Module: "#5E7C8A",
  Folder: "#91C4B3",
  File: "#62B0E8",
  Class: "#76A9B8",
  Interface: "#8FA9B3",
  Function: "#4CC9C0",
  Method: "#6FB7B5",
  Route: "#7BC8C4",
  Variable: "#64748b",
};

const DEFAULT_COLOR = "#94a3b8";

export function colorForLabel(label: string): string {
  return LABEL_COLORS[label] ?? DEFAULT_COLOR;
}

/* Stellar spectral type legend (for the graph view) */
export const STELLAR_LEGEND = [
  { type: "Hub", color: "#A9ECE8", description: "50+ connections" },
  { type: "Anchor", color: "#8FD8D3", description: "26-50 connections" },
  { type: "Connector", color: "#76BFC4", description: "13-25 connections" },
  { type: "Member", color: "#6FA8B8", description: "7-12 connections" },
  { type: "Leaf", color: "#718A96", description: "4-6 connections" },
  { type: "Peripheral", color: "#617681", description: "2-3 connections" },
  { type: "Isolated", color: "#52636B", description: "0-1 connections" },
];
