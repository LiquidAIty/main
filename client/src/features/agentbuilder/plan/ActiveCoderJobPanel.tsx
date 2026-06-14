import { useEffect, useState } from 'react';

import {
  parseCoderPacketJson,
  runLocalCoderPacket,
  type CoderPacket,
  type CoderRunResponse,
} from './coderLoop';
import type { PlanExecutionState } from './planExecutionState';

const panelStyle = {
  margin: '0 12px 10px',
  padding: '12px 14px',
  border: '1px solid rgba(79,162,173,0.3)',
  borderRadius: 8,
  background: 'rgba(79,162,173,0.05)',
} as const;

const mutedStyle = {
  color: 'rgba(225,235,238,0.62)',
  fontSize: 11,
  lineHeight: 1.5,
} as const;

function list(items: string[]) {
  return items.length > 0 ? items.join('\n') : 'None';
}

export default function ActiveCoderJobPanel({
  projectId,
  preparedPacket,
  preparationStatus = 'idle',
  preparationMessage = '',
  planSummary = '',
  executionState = null,
}: {
  projectId: string;
  preparedPacket?: CoderPacket | null;
  preparationStatus?: 'idle' | 'preparing' | 'ready' | 'blocked';
  preparationMessage?: string;
  planSummary?: string;
  executionState?: PlanExecutionState | null;
}) {
  const [draft, setDraft] = useState('');
  const [packet, setPacket] = useState<CoderPacket | null>(null);
  const [result, setResult] = useState<CoderRunResponse | null>(null);
  const [message, setMessage] = useState(
    'No active CoderPacket. Accept one validated packet before Go.',
  );
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!preparedPacket) return;
    if (preparedPacket.projectId !== projectId) {
      setPacket(null);
      setDraft('');
      setMessage(
        `Prepared CoderPacket projectId ${preparedPacket.projectId} does not match active project ${projectId}.`,
      );
      return;
    }
    setPacket(preparedPacket);
    setDraft(JSON.stringify(preparedPacket, null, 2));
    setResult(null);
    setMessage('Active CoderPacket prepared from real project context. Review it, then click Go.');
  }, [preparedPacket, projectId]);

  const applyEdits = () => {
    try {
      const nextPacket = parseCoderPacketJson(draft);
      if (nextPacket.projectId !== projectId) {
        throw new Error(
          `CoderPacket projectId ${nextPacket.projectId} does not match active project ${projectId}.`,
        );
      }
      setPacket(nextPacket);
      setResult(null);
      setMessage('Active CoderPacket edits validated. Review it, then click Go.');
    } catch (error) {
      setPacket(null);
      setResult(null);
      setMessage(error instanceof Error ? error.message : 'Invalid CoderPacket.');
    }
  };

  const runPacket = async () => {
    if (!packet || running) return;
    setRunning(true);
    setResult(null);
    setMessage('Sending the accepted CoderPacket to LocalCoder...');
    try {
      const nextResult = await runLocalCoderPacket(packet);
      setResult(nextResult);
      setMessage(`LocalCoder returned ${nextResult.report.status}. No next job was started.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'LocalCoder run failed.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <section data-testid="active-coder-job-panel" style={panelStyle}>
      <div style={{ color: '#e7f0f2', fontSize: 13, fontWeight: 700 }}>
        Active CoderPacket
      </div>
      <div style={{ ...mutedStyle, marginTop: 4 }}>
        The accepted packet is the complete spec and task. Go executes exactly this one job.
      </div>
      <div style={{ ...mutedStyle, marginTop: 6, whiteSpace: 'pre-wrap' }}>
        PLAN.md: {planSummary || 'Living plan summary unavailable.'}
        {'\n'}Preparation: {preparationStatus}
        {preparationMessage ? ` - ${preparationMessage}` : ''}
      </div>

      {!packet ? (
        <div style={{ ...mutedStyle, marginTop: 10 }}>
          {preparationStatus === 'preparing'
            ? 'Magentic-One/Sol context is being assembled into one active CoderPacket.'
            : preparationStatus === 'blocked'
              ? 'Active CoderPacket preparation is blocked. The exact blocker remains visible above.'
              : 'Chat normally to prepare one active CoderPacket from real project context.'}
        </div>
      ) : (
        <>
          <div style={{ marginTop: 10, color: '#e7f0f2', fontSize: 12 }}>
            <strong>{packet.objective}</strong>
          </div>
          <div style={{ ...mutedStyle, whiteSpace: 'pre-wrap', marginTop: 6 }}>
            Repo: {packet.repoPath}
            {'\n'}Allowed files: {list(packet.allowedFiles)}
            {'\n'}Proof required: {list(packet.proofRequired)}
            {'\n'}Stop conditions: {list(packet.stopConditions)}
          </div>
          <textarea
            aria-label="Active CoderPacket JSON"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            style={{
              width: '100%',
              minHeight: 150,
              marginTop: 10,
              padding: 10,
              resize: 'vertical',
              borderRadius: 6,
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(8,12,16,0.7)',
              color: '#e7f0f2',
              fontFamily: 'monospace',
              fontSize: 11,
            }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button type="button" onClick={applyEdits} disabled={running || !draft.trim()}>
              Apply edits
            </button>
            <button type="button" onClick={runPacket} disabled={running}>
              {running ? 'Running...' : 'Go'}
            </button>
            <button
              type="button"
              onClick={() => {
                setPacket(null);
                setDraft('');
                setResult(null);
                setMessage('Active CoderPacket cleared without execution.');
              }}
              disabled={running}
            >
              Clear
            </button>
          </div>
        </>
      )}

      <div style={{ ...mutedStyle, marginTop: 10 }}>{message}</div>

      {executionState ? (
        <div data-testid="plan-execution-state" style={{ marginTop: 12, color: '#e7f0f2', fontSize: 12 }}>
          <div><strong>Plan execution: {executionState.status}</strong></div>
          <div style={{ ...mutedStyle, marginTop: 5, whiteSpace: 'pre-wrap' }}>
            Coding run: {executionState.coding_run_id}
            {'\n'}Target root: {executionState.target_root}
            {'\n'}Session: {executionState.console_session_id || 'unavailable'}
            {'\n'}Result status: {executionState.result_status_url}
            {'\n'}Blocker: {executionState.blocker || 'None'}
            {'\n'}Next needed: {executionState.next_needed}
            {'\n'}Next SPEC candidate: {executionState.next_spec_candidate || 'Pending result'}
          </div>
          {executionState.task_result ? (
            <div data-testid="plan-task-result" style={{ ...mutedStyle, marginTop: 8, whiteSpace: 'pre-wrap' }}>
              TaskResult: {executionState.task_result.status}
              {'\n'}Result: {executionState.task_result.result}
              {'\n'}Proof: {list(executionState.task_result.proof)}
            </div>
          ) : null}
        </div>
      ) : null}

      {result ? (
        <div style={{ marginTop: 12, color: '#e7f0f2', fontSize: 12 }}>
          <div>
            <strong>CoderReport: {result.report.status}</strong>
          </div>
          <div style={{ ...mutedStyle, marginTop: 5 }}>{result.report.summary}</div>
          <div style={{ ...mutedStyle, marginTop: 8, whiteSpace: 'pre-wrap' }}>
            Compared requirements: {result.comparison.comparedRequirements}
            {'\n'}Matches packet: {result.comparison.matchesPacket ? 'yes' : 'no'}
            {'\n'}Completed: {list(result.comparison.completedRequirements)}
            {'\n'}Incomplete: {list(result.comparison.incompleteRequirements)}
            {'\n'}Blocked: {list(result.comparison.blockedRequirements)}
            {'\n'}Changed: {list(result.comparison.changedRequirements)}
            {'\n'}Out of scope: {list(result.comparison.outOfScopeFindings)}
            {'\n'}Blockers: {list(result.report.blockers)}
            {'\n'}Proof: {result.report.proofResults.length > 0
              ? result.report.proofResults
                  .map((proof) => `${proof.status}: ${proof.command}`)
                  .join('\n')
              : 'None'}
            {'\n'}Next narrower focus: {result.comparison.nextNarrowerFocus || 'None'}
            {'\n'}ThinkGraph persistence: {result.thinkGraphPersistence?.ok === false
              ? `blocked - ${result.thinkGraphPersistence.error || 'unknown error'}`
              : 'recorded'}
          </div>
        </div>
      ) : null}
    </section>
  );
}
