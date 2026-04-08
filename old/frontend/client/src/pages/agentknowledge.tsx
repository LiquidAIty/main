import React, { useState } from "react";
import { agentknowledgegraph } from "../components/agent-knowledge-graph";

// Theme colors
const C = {
  bg: "#0B0C0E",
  panel: "#121317",
  border: "#2A2F36",
  text: "#E9EEF5",
  muted: "#9AA3B2",
  primary: "#6EFAFB",   // turquoise
  accent:  "#E2725B",   // terra cotta
  neutral: "#6E7E85",   // gray
};

export default function agentknowledge() {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [availableAgents, setAvailableAgents] = useState([
    { id: 'sol-orchestrator', name: 'SOL Orchestrator' },
    { id: 'sol-code', name: 'SOL Code Agent' },
    { id: 'sol-marketing', name: 'SOL Marketing Agent' },
    { id: 'sol-research', name: 'SOL Research Agent' },
  ]);

  return (
    <div className="h-screen flex flex-col" style={{ background: C.bg, color: C.text }}>
      {/* Header */}
      <header className="p-4 border-b" style={{ borderColor: C.border }}>
        <div className="flex justify-between items-center">
          <h1 className="text-xl font-semibold">Agent Knowledge Graphs</h1>
          <div className="flex items-center">
            <span className="mr-2 text-sm" style={{ color: C.muted }}>Filter by agent:</span>
            <select
              value={selectedAgentId || ''}
              onChange={(e) => setSelectedAgentId(e.target.value || null)}
              className="bg-transparent border rounded px-2 py-1"
              style={{ borderColor: C.border, color: C.text }}
            >
              <option value="">All Agents</option>
              {availableAgents.map(agent => (
                <option key={agent.id} value={agent.id}>{agent.name}</option>
              ))}
            </select>
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 overflow-hidden">
        <agentknowledgegraph agentId={selectedAgentId} />
      </div>
    </div>
  );
}
