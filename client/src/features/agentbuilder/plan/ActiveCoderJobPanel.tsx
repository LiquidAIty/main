import { useState } from 'react';

import {
  parseCoderPacketJson,
  runLocalCoderPacket,
  type CoderPacket,
  type CoderRunResponse,
} from './coderLoop';

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
}: {
  projectId: string;
}) {
  const [draft, setDraft] = useState('');
  const [packet, setPacket] = useState<CoderPacket | null>(null);
  const [result, setResult] = useState<CoderRunResponse | null>(null);
  const [message, setMessage] = useState(
    'No active CoderPacket. Accept one validated packet before Go.',
  );
  const [running, setRunning] = useState(false);

  const acceptPacket = () => {
    try {
      const nextPacket = parseCoderPacketJson(draft);
      if (nextPacket.projectId !== projectId) {
        throw new Error(
          `CoderPacket projectId ${nextPacket.projectId} does not match active project ${projectId}.`,
        );
      }
      setPacket(nextPacket);
      setResult(null);
      setMessage('Active CoderPacket accepted. Review it, then click Go.');
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

      {!packet ? (
        <>
          <textarea
            aria-label="CoderPacket JSON"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Paste one Magentic-One/Sol generated CoderPacket JSON here."
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
          <button type="button" onClick={acceptPacket} disabled={!draft.trim()}>
            Accept CoderPacket
          </button>
        </>
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
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button type="button" onClick={runPacket} disabled={running}>
              {running ? 'Running...' : 'Go'}
            </button>
            <button
              type="button"
              onClick={() => {
                setPacket(null);
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

      {result ? (
        <div style={{ marginTop: 12, color: '#e7f0f2', fontSize: 12 }}>
          <div>
            <strong>CoderReport: {result.report.status}</strong>
          </div>
          <div style={{ ...mutedStyle, marginTop: 5 }}>{result.report.summary}</div>
          <div style={{ ...mutedStyle, marginTop: 8, whiteSpace: 'pre-wrap' }}>
            Compared requirements: {result.comparison.comparedRequirements}
            {'\n'}Matches packet: {result.comparison.matchesPacket ? 'yes' : 'no'}
            {'\n'}Unresolved: {list(result.comparison.unresolvedRequirements)}
            {'\n'}Blockers: {list(result.report.blockers)}
            {'\n'}Proof: {result.report.proofResults.length > 0
              ? result.report.proofResults
                  .map((proof) => `${proof.status}: ${proof.command}`)
                  .join('\n')
              : 'None'}
            {'\n'}Next recommended task: {result.report.nextRecommendedTask || 'None'}
          </div>
        </div>
      ) : null}
    </section>
  );
}
