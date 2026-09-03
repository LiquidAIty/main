import { useEffect, useState } from 'react';

import type { CardSubsystemAttachment } from '../../../types/agentgraph';

const PANEL = '#172020';
const FIELD = '#202c2d';
const EDGE = '#3A4A4F';
const INK = '#E0DED5';
const MUTED = '#80969F';
const CYAN = '#72D7C7';

type SubsystemReadiness = {
  status?: string;
  version?: string | null;
  adapter?: Record<string, unknown>;
  lifecycle?: Record<string, unknown>;
  nativeAgents?: Record<string, unknown>;
  diagnostics?: string | null;
};

export default function CardSubsystemTab({ attachment, readinessEndpoint }: {
  attachment: CardSubsystemAttachment;
  readinessEndpoint?: string | null;
}) {
  const [readiness, setReadiness] = useState<SubsystemReadiness | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!readinessEndpoint) return;
    const controller = new AbortController();
    void fetch(readinessEndpoint, { credentials: 'include', signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(String(body?.error || `subsystem_readiness_${response.status}`));
        setReadiness(body as SubsystemReadiness);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : 'Subsystem readiness unavailable');
        }
      });
    return () => controller.abort();
  }, [readinessEndpoint]);

  return <div data-testid={`card-subsystem-tab-${attachment.id}`} style={{ display: 'grid', gap: 11 }}>
    <section style={{ background: PANEL, border: `1px solid ${EDGE}`, borderRadius: 10, padding: 12 }}>
      <div style={{ alignItems: 'center', display: 'flex', gap: 8, justifyContent: 'space-between' }}>
        <div><strong style={{ color: INK, fontSize: 13 }}>{attachment.label}</strong>
          <div style={{ color: MUTED, fontSize: 9.5, marginTop: 3 }}>Attached subsystem · public adapter boundary</div></div>
        <span style={{ border: `1px solid ${CYAN}66`, borderRadius: 999, color: CYAN,
          fontSize: 9, padding: '4px 7px' }}>{readiness?.status || 'not read'}</span>
      </div>
      <p style={{ color: MUTED, fontSize: 10.5, lineHeight: 1.5, margin: '10px 0 0' }}>
        This tab exposes the subsystem’s native capabilities and integration state. Hermes prompt,
        tools, skills, memory, Team, Script, and graph context stay in their standard Card tabs;
        live work stays in the Agent UI.
      </p>
    </section>
    <section style={{ background: FIELD, border: `1px solid ${EDGE}`, borderRadius: 10, padding: 11 }}>
      <strong style={{ color: INK, fontSize: 10.5 }}>Adapter contract</strong>
      <div style={{ color: MUTED, display: 'grid', fontSize: 9.5, gap: 5,
        gridTemplateColumns: 'auto 1fr', marginTop: 8 }}>
        <span>Kind</span><span style={{ color: CYAN }}>{attachment.adapter.kind}</span>
        <span>Contract</span><span style={{ color: CYAN }}>{attachment.adapter.contractVersion}</span>
        <span>Configuration</span><span>{attachment.configurationSchema || 'None declared'}</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 9 }}>
        {attachment.adapter.capabilities.map((capability) => <span key={capability}
          style={{ background: PANEL, border: `1px solid ${EDGE}`, borderRadius: 7, color: MUTED,
            fontSize: 9, padding: '4px 6px' }}>{capability}</span>)}
      </div>
    </section>
    <section style={{ background: FIELD, border: `1px solid ${EDGE}`, borderRadius: 10, padding: 11 }}>
      <strong style={{ color: INK, fontSize: 10.5 }}>Native lifecycle and agents</strong>
      <pre style={{ color: error ? '#ff786e' : MUTED, fontSize: 9, lineHeight: 1.45,
        margin: '8px 0 0', overflow: 'auto', whiteSpace: 'pre-wrap' }}>
        {error || JSON.stringify({ version: readiness?.version || null,
          lifecycle: readiness?.lifecycle || null,
          nativeAgents: readiness?.nativeAgents || null,
          diagnostics: readiness?.diagnostics || null }, null, 2)}
      </pre>
    </section>
  </div>;
}
