import React, { useState, useEffect } from "react";
import { KnowledgeGraphView } from "./knowledge-graph-view";

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

interface AgentGraph {
  id: string;
  createdAt: string;
  createdBy: string;
}

interface AgentKnowledgeGraphProps {
  height?: number;
  agentId?: string;
}

export function agentknowledgegraph({ height = 500, agentId }: AgentKnowledgeGraphProps) {
  const [graphs, setGraphs] = useState<AgentGraph[]>([]);
  const [selectedGraphId, setSelectedGraphId] = useState<string | null>(null);
  const [graphData, setGraphData] = useState<{ nodes: any[], links: any[] }>({ nodes: [], links: [] });
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch list of agent-generated graphs
  useEffect(() => {
    async function fetchGraphs() {
      try {
        setLoading(true);
        const response = await fetch('/api/kg/agent');
        if (!response.ok) {
          throw new Error(`Error fetching graphs: ${response.statusText}`);
        }
        const data = await response.json();
        
        // Filter by agentId if provided
        const filteredGraphs = agentId 
          ? data.graphs.filter((g: AgentGraph) => g.createdBy === agentId)
          : data.graphs;
          
        setGraphs(filteredGraphs);
        
        // Select the most recent graph by default if available
        if (filteredGraphs.length > 0 && !selectedGraphId) {
          setSelectedGraphId(filteredGraphs[0].id);
        }
        
        setLoading(false);
      } catch (err: any) {
        setError(err.message);
        setLoading(false);
      }
    }
    
    fetchGraphs();
  }, [agentId]);
  
  // Fetch specific graph data when selectedGraphId changes
  useEffect(() => {
    async function fetchGraphData() {
      if (!selectedGraphId) return;
      
      try {
        setLoading(true);
        const response = await fetch(`/api/kg/agent/${selectedGraphId}`);
        if (!response.ok) {
          throw new Error(`Error fetching graph data: ${response.statusText}`);
        }
        const data = await response.json();
        setGraphData(data);
        setLoading(false);
      } catch (err: any) {
        setError(err.message);
        setLoading(false);
      }
    }
    
    fetchGraphData();
  }, [selectedGraphId]);
  
  // Handle graph deletion
  const handleDeleteGraph = async (graphId: string) => {
    if (!confirm('Are you sure you want to delete this knowledge graph?')) {
      return;
    }
    
    try {
      setLoading(true);
      const response = await fetch(`/api/kg/agent/${graphId}`, {
        method: 'DELETE'
      });
      
      if (!response.ok) {
        throw new Error(`Error deleting graph: ${response.statusText}`);
      }
      
      // Remove deleted graph from list
      setGraphs(graphs.filter(g => g.id !== graphId));
      
      // If the deleted graph was selected, select another one
      if (selectedGraphId === graphId) {
        setSelectedGraphId(graphs.length > 1 ? graphs[0].id : null);
      }
      
      setLoading(false);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };
  
  // Format date for display
  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleString();
    } catch (e) {
      return dateString;
    }
  };

  return (
    <div className="flex flex-col h-full" style={{ background: C.bg, color: C.text }}>
      <div className="flex justify-between items-center p-4 border-b" style={{ borderColor: C.border }}>
        <h2 className="text-lg font-semibold">Agent Knowledge Graphs</h2>
        {loading && <span className="text-sm" style={{ color: C.muted }}>Loading...</span>}
      </div>
      
      {error && (
        <div className="p-4 m-4 rounded-md" style={{ background: 'rgba(226, 114, 91, 0.1)', color: C.accent }}>
          Error: {error}
        </div>
      )}
      
      <div className="flex h-full">
        {/* Sidebar with graph list */}
        <div className="w-64 border-r overflow-auto" style={{ borderColor: C.border }}>
          {graphs.length === 0 ? (
            <div className="p-4 text-sm" style={{ color: C.muted }}>
              No knowledge graphs found.
            </div>
          ) : (
            <ul>
              {graphs.map(graph => (
                <li 
                  key={graph.id}
                  className="p-3 border-b cursor-pointer hover:bg-opacity-10 hover:bg-white"
                  style={{ 
                    borderColor: C.border,
                    background: selectedGraphId === graph.id ? 'rgba(110, 250, 251, 0.05)' : 'transparent',
                    borderLeft: selectedGraphId === graph.id ? `3px solid ${C.primary}` : '3px solid transparent'
                  }}
                  onClick={() => setSelectedGraphId(graph.id)}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-medium truncate" style={{ maxWidth: '180px' }}>
                        {graph.id.replace('kg-', '')}
                      </div>
                      <div className="text-xs mt-1" style={{ color: C.muted }}>
                        {formatDate(graph.createdAt)}
                      </div>
                      <div className="text-xs mt-1" style={{ color: C.primary }}>
                        {graph.createdBy}
                      </div>
                    </div>
                    <button
                      className="text-xs p-1 opacity-50 hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteGraph(graph.id);
                      }}
                      style={{ color: C.accent }}
                    >
                      ✕
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        
        {/* Main graph visualization area */}
        <div className="flex-1 overflow-hidden">
          {selectedGraphId && graphData.nodes.length > 0 ? (
            <div className="h-full">
              <KnowledgeGraphView 
                nodes={graphData.nodes.map(n => ({
                  id: n.id,
                  label: n.properties.name || n.properties.title || n.id,
                  kind: n.labels[0]?.toLowerCase() || 'concept',
                  score: 0.5 // Default score
                }))}
                links={graphData.links.map(l => ({
                  source: l.source,
                  target: l.target,
                  relation: l.type,
                  weight: 0.5 // Default weight
                }))}
                height={height}
              />
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center" style={{ color: C.muted }}>
                {selectedGraphId ? (
                  loading ? 
                    "Loading graph data..." : 
                    "This knowledge graph has no nodes or connections."
                ) : (
                  "Select a knowledge graph to visualize"
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
