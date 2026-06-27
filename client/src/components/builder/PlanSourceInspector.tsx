import type { CSSProperties } from 'react';

import type { PlanMissionNodeData } from '../assist/planMissionModel';
import { GRAPH_THEME, graphInspectorPanelStyle } from '../graph/graphVisualTokens';

/**
 * Inspector for the selected user-facing Plan/source node (the real AutoGen Task
 * Ledger artifact, surfaced without internal "Task Ledger Artifact" wording). Shows
 * plan title, task count, the real plan summary, source, and the raw artifact only in
 * a debug section. Read-only — the artifact is never edited or fabricated.
 */
export default function PlanSourceInspector({
  data,
  sourceRunId,
  onClose,
}: {
  data: PlanMissionNodeData;
  sourceRunId?: string | null;
  onClose?: () => void;
}) {
  const labelStyle: CSSProperties = { color: GRAPH_THEME.surface.mutedText, fontSize: 10 };
  const summary = String(data.planResponse || '').trim();

  return (
    <aside
      aria-label="Selected plan source details"
      data-testid="plan-source-inspector"
      style={{
        position: 'absolute',
        top: 14,
        right: 14,
        zIndex: 24,
        width: 300,
        maxHeight: 'calc(100% - 28px)',
        overflow: 'auto',
        padding: 14,
        color: GRAPH_THEME.surface.text,
        // Deep-glass inspector material (shell visual only; content unchanged).
        ...graphInspectorPanelStyle(),
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', color: GRAPH_THEME.accent.primary }}>
          PLAN
        </div>
        {onClose ? (
          <button
            type="button"
            aria-label="Close plan inspector"
            onClick={onClose}
            style={{
              border: 'none',
              background: 'transparent',
              color: GRAPH_THEME.surface.mutedText,
              cursor: 'pointer',
              fontSize: 14,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        ) : null}
      </div>
      <div style={{ marginTop: 5, fontSize: 15, fontWeight: 750, lineHeight: 1.3 }}>
        {String(data.label || 'Plan')}
      </div>

      <div style={{ marginTop: 12, display: 'grid', gap: 8, fontSize: 11.5 }}>
        <div>
          <div style={labelStyle}>Task count</div>
          <div style={{ marginTop: 2 }}>{typeof data.taskCount === 'number' ? data.taskCount : 0}</div>
        </div>
        {sourceRunId ? (
          <div>
            <div style={labelStyle}>Source run</div>
            <div style={{ marginTop: 2, overflowWrap: 'anywhere' }}>{sourceRunId}</div>
          </div>
        ) : null}
        <div>
          <div style={labelStyle}>Summary</div>
          <div style={{ marginTop: 2, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {summary || 'No plan summary available.'}
          </div>
        </div>
        {data.payloadJson ? (
          <div>
            <div style={labelStyle}>raw artifact (debug)</div>
            <pre
              style={{
                marginTop: 2,
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                fontSize: 10.5,
                lineHeight: 1.4,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              }}
            >
              {data.payloadJson}
            </pre>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
