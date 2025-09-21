import React, { useState } from "react";
import { KnowledgeGraphView } from "./knowledge-graph-view";
import { TimeSeriesChart, TimeSeriesPoint, BandPoint, EventPoint } from "./timeseries-chart";

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

export interface Triple {
  id: string;
  a: string;
  r: string;
  b: string;
  source?: string;
  confidence: number;
  verified: boolean;
}

export interface HistoryItem {
  type: 'add' | 'remove';
  payload: Triple | Triple[];
}

interface CountPillProps {
  label: string;
  value: number;
}

const CountPill = ({ label, value }: CountPillProps) => (
  <span style={{ 
    fontSize: 12, 
    color: C.neutral, 
    border: `1px solid ${C.border}`, 
    padding: '4px 8px', 
    borderRadius: 999 
  }}>
    {label}: <b style={{ color: C.text }}>{value}</b>
  </span>
);

interface PillProps {
  label: string;
  onClick: () => void;
  tone?: 'muted' | 'accent';
}

const Pill = ({ label, onClick, tone = 'muted' }: PillProps) => (
  <button 
    onClick={onClick} 
    className="pill" 
    style={{ 
      border: `1px solid ${tone === 'accent' ? C.primary : C.border}`, 
      color: tone === 'accent' ? C.primary : C.muted, 
      background: 'transparent', 
      padding: '6px 10px', 
      fontSize: 12, 
      borderRadius: 999 
    }}
  >
    {label}
  </button>
);

export interface KnowledgePanelProps {
  triples: Triple[];
  suggestedTriples: Triple[];
  onAddTriple: (triple: Partial<Triple>) => void;
  onDeleteTriple: (id: string) => void;
  onRemoveBySource: (source: string) => void;
  onUndo: () => void;
  history: HistoryItem[];
  timeSeriesData?: {
    series: TimeSeriesPoint[];
    band: BandPoint[];
    events: EventPoint[];
  };
}

export function KnowledgePanel({
  triples,
  suggestedTriples,
  onAddTriple,
  onDeleteTriple,
  onRemoveBySource,
  onUndo,
  history,
  timeSeriesData
}: KnowledgePanelProps) {
  // Knowledge form
  const [formA, setFormA] = useState("");
  const [formR, setFormR] = useState("");
  const [formB, setFormB] = useState("");
  const [formSource, setFormSource] = useState("");
  const [formConf, setFormConf] = useState(0.8);
  const [bulkSource, setBulkSource] = useState("");

  // Knowledge views (Graph | Timeline | List)
  const [kgView, setKgView] = useState<'graph' | 'timeline' | 'list'>('list');
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  // Derive nodes/links from triples for the force graph
  const kgNodes = React.useMemo(() => {
    const m = new Map();
    triples.forEach(t => {
      if (!m.has(t.a)) m.set(t.a, { id: t.a, label: t.a, kind: 'other' });
      if (!m.has(t.b)) m.set(t.b, { id: t.b, label: t.b, kind: 'other' });
    });
    return Array.from(m.values());
  }, [triples]);

  const kgLinks = React.useMemo(() =>
    triples.map(t => ({
      source: t.a,
      target: t.b,
      weight: t.confidence,
      relation: t.r
    })), [triples]);

  function handleAddForm() {
    onAddTriple({
      a: formA.trim(),
      r: formR.trim(),
      b: formB.trim(),
      source: formSource.trim() || undefined,
      confidence: formConf
    });
    setFormA("");
    setFormR("");
    setFormB("");
    setFormSource("");
    setFormConf(0.8);
  }

  return (
    <div className="flex flex-col gap-10 p-4">
      {/* View toggles */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-8">
          <span className="text-[12px]" style={{ color: C.muted }}>View:</span>
          <div className="flex items-center gap-6">
            <button
              onClick={() => setKgView('graph')}
              style={{
                padding: '6px 10px',
                border: `1px solid ${kgView === 'graph' ? C.primary : C.border}`,
                borderRadius: 999,
                color: kgView === 'graph' ? C.primary : C.muted,
                background: 'transparent'
              }}
            >
              Graph
            </button>
            <button
              onClick={() => setKgView('timeline')}
              style={{
                padding: '6px 10px',
                border: `1px solid ${kgView === 'timeline' ? C.primary : C.border}`,
                borderRadius: 999,
                color: kgView === 'timeline' ? C.primary : C.muted,
                background: 'transparent'
              }}
            >
              Timeline
            </button>
            <button
              onClick={() => setKgView('list')}
              style={{
                padding: '6px 10px',
                border: `1px solid ${kgView === 'list' ? C.primary : C.border}`,
                borderRadius: 999,
                color: kgView === 'list' ? C.primary : C.muted,
                background: 'transparent'
              }}
            >
              List
            </button>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <CountPill label="Facts" value={triples.length} />
          <CountPill label="Suggestions" value={suggestedTriples.length} />
          <button
            onClick={onUndo}
            disabled={!history.length}
            style={{
              opacity: history.length ? 1 : 0.5,
              fontSize: 12,
              padding: '6px 10px',
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              color: C.text,
              background: 'transparent'
            }}
          >
            Undo
          </button>
        </div>
      </div>

      {/* Quick add triple */}
      <div>
        <div className="text-[12px] mb-2" style={{ color: C.muted }}>
          Add a fact: <span style={{ color: C.primary }}>entity — relation — entity</span>
        </div>
        <div className="flex flex-wrap gap-6 items-center">
          <input
            value={formA}
            onChange={(e) => setFormA(e.target.value)}
            placeholder="Entity A"
            style={{
              background: '#0E0F12',
              border: `1px solid ${C.border}`,
              color: C.text,
              borderRadius: 6,
              padding: '8px 10px',
              fontSize: 13,
              width: 180
            }}
          />
          <input
            value={formR}
            onChange={(e) => setFormR(e.target.value)}
            placeholder="Relation (e.g., works_at)"
            style={{
              background: '#0E0F12',
              border: `1px solid ${C.border}`,
              color: C.text,
              borderRadius: 6,
              padding: '8px 10px',
              fontSize: 13,
              width: 200
            }}
          />
          <input
            value={formB}
            onChange={(e) => setFormB(e.target.value)}
            placeholder="Entity B"
            style={{
              background: '#0E0F12',
              border: `1px solid ${C.border}`,
              color: C.text,
              borderRadius: 6,
              padding: '8px 10px',
              fontSize: 13,
              width: 180
            }}
          />
          <button
            onClick={handleAddForm}
            className="rounded-md font-medium"
            style={{ background: C.primary, color: '#0B0C0E', padding: '8px 12px', fontSize: 13 }}
          >
            Add
          </button>
        </div>
        <div className="flex flex-wrap gap-6 items-center mt-3">
          <input
            value={formSource}
            onChange={(e) => setFormSource(e.target.value)}
            placeholder="Source URL (optional)"
            style={{
              background: '#0E0F12',
              border: `1px solid ${C.border}`,
              color: C.text,
              borderRadius: 6,
              padding: '8px 10px',
              fontSize: 12,
              width: 360
            }}
          />
          <div className="flex items-center gap-2" style={{ color: C.muted, fontSize: 12 }}>
            Confidence
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={formConf}
              onChange={(e) => setFormConf(parseFloat(e.target.value))}
            />
            <span style={{ color: C.text }}>{formConf.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* GRAPH VIEW */}
      {kgView === 'graph' && (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, background: '#0E0F12', padding: 10 }}>
          <KnowledgeGraphView
            nodes={kgNodes}
            links={kgLinks}
            height={420}
            onSelectNode={setSelectedNode}
            selectedId={selectedNode}
          />
        </div>
      )}

      {/* TIMELINE VIEW */}
      {kgView === 'timeline' && timeSeriesData && (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, background: '#0E0F12', padding: 10 }}>
          <div className="flex flex-wrap items-center gap-4 text-xs mb-2" style={{ color: C.muted }}>
            <span className="inline-flex items-center gap-2">
              <span className="inline-block w-5 h-[3px]" style={{ background: C.primary }}></span>Actual
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="inline-block w-5 h-[3px]" style={{ background: C.accent }}></span>Forecast
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="inline-block w-5 h-2" style={{ background: C.accent, opacity: 0.2 }}></span>Band
            </span>
          </div>
          <TimeSeriesChart
            series={timeSeriesData.series}
            band={timeSeriesData.band}
            events={selectedNode
              ? timeSeriesData.events.filter(e => e.entity === selectedNode)
              : timeSeriesData.events}
            height={380}
          />
        </div>
      )}

      {/* LIST VIEW */}
      {kgView === 'list' && (
        <div>
          <div className="text-[12px] mb-2" style={{ color: C.muted }}>Knowledge ({triples.length})</div>
          <div className="flex flex-col gap-6">
            {triples.map(t => (
              <div
                key={t.id}
                className="kg-row flex items-center justify-between"
                style={{ borderBottom: `1px dashed ${C.border}`, paddingBottom: 10 }}
              >
                <div style={{ fontSize: 13 }}>
                  <span style={{ color: C.text }}>{t.a}</span>{' '}
                  <span style={{ color: C.primary }}>{t.r}</span>{' '}
                  <span style={{ color: C.text }}>{t.b}</span>
                  {t.source && (
                    <span
                      style={{
                        marginLeft: 10,
                        fontSize: 12,
                        color: C.muted,
                        border: `1px solid ${C.border}`,
                        padding: '2px 6px',
                        borderRadius: 6
                      }}
                    >
                      src: {t.source}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-6">
                  <span style={{ fontSize: 12, color: C.muted }}>{Math.round(t.confidence * 100)}%</span>
                  <button style={{ fontSize: 12, color: '#F66' }} onClick={() => onDeleteTriple(t.id)}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Bulk remove by source */}
          <div className="mt-4 flex items-center gap-3">
            <input
              value={bulkSource}
              onChange={(e) => setBulkSource(e.target.value)}
              placeholder="Remove all facts by source (paste exact source)"
              style={{
                background: '#0E0F12',
                border: `1px solid ${C.border}`,
                color: C.text,
                borderRadius: 6,
                padding: '8px 10px',
                fontSize: 12,
                flex: 1
              }}
            />
            <button
              onClick={() => onRemoveBySource(bulkSource.trim())}
              style={{
                fontSize: 12,
                padding: '8px 10px',
                border: `1px solid ${C.border}`,
                borderRadius: 6,
                color: C.text,
                background: 'transparent'
              }}
            >
              Remove
            </button>
          </div>
        </div>
      )}

      {/* Suggestions */}
      {suggestedTriples.length > 0 && (
        <div>
          <div className="text-[12px] mb-2" style={{ color: C.muted }}>Suggestions from chat/files</div>
          <div className="flex flex-wrap gap-8">
            {suggestedTriples.map(s => (
              <div
                key={s.id}
                style={{
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                  padding: '10px 12px',
                  background: '#0E0F12'
                }}
              >
                <div style={{ fontSize: 13, color: C.text }}>
                  {s.a} <span style={{ color: C.primary }}>{s.r}</span> {s.b}{' '}
                  <span style={{ marginLeft: 8, fontSize: 12, color: C.muted }}>
                    ({Math.round(s.confidence * 100)}%)
                  </span>
                </div>
                <div className="flex gap-8 mt-2">
                  <button
                    style={{ fontSize: 12, color: C.primary }}
                    onClick={() => {
                      onAddTriple(s);
                    }}
                  >
                    Add
                  </button>
                  <button
                    style={{ fontSize: 12, color: C.muted }}
                    onClick={() => {
                      // Handle ignore suggestion
                    }}
                  >
                    Ignore
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
