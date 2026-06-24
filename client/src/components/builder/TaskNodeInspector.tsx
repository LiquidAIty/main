import type { CSSProperties, ReactNode } from 'react';

import type { PlanMissionNodeData } from '../assist/planMissionModel';
import { GRAPH_THEME, graphInspectorPanelStyle } from '../graph/graphVisualTokens';

/**
 * Task inspector for a selected task (mission) node on the unified project canvas.
 * The node face stays title-only; this panel owns the details. Read-only for V0 —
 * it surfaces the real planFlowTaskObjects fields and the fail-closed Run Agents
 * action. Proposed agents are chips/text here, never permanent canvas wires.
 */
export default function TaskNodeInspector({
  data,
  onRunAgents,
  goGateStatus,
  onClose,
}: {
  data: PlanMissionNodeData;
  onRunAgents?: () => void;
  goGateStatus?: string | null;
  onClose?: () => void;
}) {
  const labelStyle: CSSProperties = { color: GRAPH_THEME.surface.mutedText, fontSize: 10 };
  const Row = ({ label, value, pre }: { label: string; value?: ReactNode; pre?: boolean }) => {
    if (value === undefined || value === null || value === '') return null;
    return (
      <div>
        <div style={labelStyle}>{label}</div>
        <div
          style={{
            marginTop: 2,
            whiteSpace: pre ? 'pre-wrap' : 'normal',
            overflowWrap: 'anywhere',
          }}
        >
          {value}
        </div>
      </div>
    );
  };

  const proposed = Array.isArray(data.assignedAgentIds) ? data.assignedAgentIds : [];

  return (
    <aside
      aria-label="Selected task node details"
      data-testid="task-node-inspector"
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
          TASK
        </div>
        {onClose ? (
          <button
            type="button"
            aria-label="Close task inspector"
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
        {String(data.label || 'Task')}
      </div>

      {onRunAgents ? (
        <div style={{ marginTop: 10 }}>
          <button
            type="button"
            data-testid="task-inspector-run-agents"
            aria-label="Run Agents — stage the selected task at the approval gate"
            title="Run Agents — stage the selected task at the approval gate (execution not wired)"
            onClick={() => onRunAgents()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 12px',
              borderRadius: 8,
              background: 'rgba(13,17,23,0.92)',
              border: '1px solid rgba(55,173,170,0.38)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 0 12px rgba(55,173,170,0.14)',
              color: 'rgba(220,247,245,0.95)',
              fontWeight: 650,
              fontSize: 11,
              letterSpacing: '0.03em',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            <svg width="9" height="9" viewBox="0 0 24 24" fill="rgba(55,173,170,0.95)" stroke="none" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
            Run Agents
          </button>
          {goGateStatus ? (
            <div
              data-testid="task-inspector-run-agents-status"
              style={{ marginTop: 6, fontSize: 11, lineHeight: 1.3, color: GRAPH_THEME.surface.mutedText }}
            >
              {goGateStatus}
            </div>
          ) : null}
        </div>
      ) : null}

      <div style={{ marginTop: 12, display: 'grid', gap: 8, fontSize: 11.5 }}>
        <Row label="Status" value={data.status} />
        <Row label="Detail" value={data.detail} pre />
        <Row
          label="Step number"
          value={typeof data.stepNumber === 'number' ? String(data.stepNumber) : undefined}
        />
        <Row
          label="Depends on"
          value={data.dependsOn && data.dependsOn.length > 0 ? data.dependsOn.join(', ') : undefined}
        />
        {/* Harness Plan Draft step fields (rendered only when actually present). */}
        <Row label="Plan state" value={data.planState} />
        <Row label="Expected outcome" value={data.expectedOutcome} pre />
        <Row
          label="Constraints"
          value={data.constraints && data.constraints.length ? data.constraints.join('\n') : undefined}
          pre
        />
        <Row
          label="Acceptance criteria"
          value={
            data.acceptanceCriteria && data.acceptanceCriteria.length
              ? data.acceptanceCriteria.join('\n')
              : undefined
          }
          pre
        />
        <Row label="Target flow" value={data.targetFlow} />
        <Row label="Target agent" value={data.targetAgent} />
        {/* Outcome review foundation: the REQUESTED side (expected outcome +
            acceptance criteria above) is the durable contract; the review slot
            starts unreviewed and is NEVER auto-marked matched/complete — a real
            agent result is compared later. */}
        {data.expectedOutcome || (data.acceptanceCriteria && data.acceptanceCriteria.length) ? (
          <Row label="Review status" value="unreviewed — no actual result yet" />
        ) : null}
        <Row label="Approval required" value={data.approvalRequired ? 'yes' : 'no'} />
        <Row label="Next needed" value={data.nextNeeded} pre />
        <Row label="Proof needed" value={data.proofNeeded} pre />
        <Row label="Source artifact" value={data.sourceArtifactId || data.sourceArtifactRef} />
        <Row label="Routes through" value={data.routeThrough} />
        <div>
          <div style={labelStyle}>Proposed agents</div>
          <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {proposed.length > 0 ? (
              proposed.map((agentId) => (
                <span
                  key={agentId}
                  style={{
                    padding: '2px 8px',
                    borderRadius: 999,
                    border: '1px solid rgba(55,173,170,0.38)',
                    background: 'rgba(13,17,23,0.92)',
                    fontSize: 10.5,
                  }}
                >
                  {agentId}
                </span>
              ))
            ) : (
              <span style={{ color: GRAPH_THEME.surface.mutedText }}>none proposed yet</span>
            )}
          </div>
        </div>
        <Row label="Agents used" value="none yet" />
        <Row label="Run result" value={data.resultSummary || 'none yet'} pre />
        <Row label="Blocker" value={data.blocker} pre />
        {data.rawTaskObject ? (
          <div>
            <div style={labelStyle}>raw object</div>
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
              {data.rawTaskObject}
            </pre>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
