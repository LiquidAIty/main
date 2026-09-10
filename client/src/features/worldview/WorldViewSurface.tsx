import { useEffect, useState } from 'react';

import GodsEyeSurface, {
  type GodsEyeFocusRequest,
  type GodsEyeLayerState,
  type GodsEyeNativeAgentState,
} from '../../components/worldsignal/GodsEyeSurface';
import {
  parseCardRunJson,
  parseSignalPackage,
  type SignalAssessment,
  type SignalCandidate,
  type SignalPackage,
} from './signalContracts';

const GLOBE_URL = import.meta.env.VITE_WORLDVIEW_GLOBE_URL || 'http://127.0.0.1:4174';

type WorldViewSurfaceProps = {
  projectId: string | null;
  deckId?: string;
  cardId: string | null;
  analystCardId?: string | null;
  signalPackage?: SignalPackage | null;
  assessment?: SignalAssessment | null;
};

type CardRunStatus = {
  state?: unknown;
  output?: unknown;
  runId?: unknown;
  cardId?: unknown;
};

async function readLatestCardOutput(args: {
  projectId: string;
  deckId: string;
  cardId: string;
}): Promise<{ runId: string; value: unknown } | null> {
  const response = await fetch('/api/cards/run', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'status',
      inspectOnly: true,
      projectId: args.projectId,
      deckId: args.deckId,
      cardId: args.cardId,
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok !== true) {
    throw new Error(String(payload?.error || `card_run_status_http_${response.status}`));
  }
  const result = payload?.result as CardRunStatus | null;
  return result?.state === 'completed'
    && result.cardId === args.cardId
    && typeof result.runId === 'string'
    ? { runId: result.runId, value: parseCardRunJson(result.output) }
    : null;
}

function candidateFocus(candidate: SignalCandidate | null): GodsEyeFocusRequest | null {
  const coordinates = candidate?.location?.coordinates;
  if (!coordinates) return null;
  return {
    id: candidate.candidateId,
    position: { longitude: coordinates[0], latitude: coordinates[1] },
  };
}

export default function WorldViewSurface({
  projectId,
  deckId = 'deck_builder',
  cardId,
  signalPackage,
}: WorldViewSurfaceProps) {
  const [persistedPackage, setPersistedPackage] = useState<SignalPackage | null>(null);
  const [sourceVersion, setSourceVersion] = useState<string | null>(null);
  const [layerState, setLayerState] = useState<GodsEyeLayerState | null>(null);
  const [nativeAgentState, setNativeAgentState] = useState<GodsEyeNativeAgentState | null>(null);
  const [surfaceError, setSurfaceError] = useState<string | null>(null);
  const activePackage = signalPackage === undefined ? persistedPackage : signalPackage;

  useEffect(() => {
    if (signalPackage !== undefined || !projectId || !cardId) return undefined;
    let cancelled = false;
    setPersistedPackage(null);
    void (async () => {
      try {
        const packageRun = await readLatestCardOutput({ projectId, deckId, cardId });
        const packageValue = parseSignalPackage(packageRun?.value);
        const scopedPackage = packageValue
          && packageValue.projectId === projectId
          && packageValue.deckId === deckId
          && packageValue.producerCardId === cardId
          && packageValue.producerRunId === packageRun?.runId
          && packageValue.candidates.every((candidate) => (
            candidate.projectId === projectId
            && candidate.deckId === deckId
            && candidate.producerCardId === cardId
            && candidate.producerRunId === packageRun?.runId
          ))
          ? packageValue : null;
        if (cancelled) return;
        setPersistedPackage(scopedPackage);
      } catch {
        if (!cancelled) setPersistedPackage(null);
      }
    })();
    return () => { cancelled = true; };
  }, [cardId, deckId, projectId, signalPackage]);

  const selectedCandidate = activePackage?.candidates[0] ?? null;

  if (!projectId || !cardId) {
    return <section style={styles.unavailable}>
      <strong>WorldView Card is not connected</strong>
      <span>The globe opens only from a saved Card presentation attachment.</span>
    </section>;
  }

  return <section style={styles.root} aria-label="WorldView signal workspace">
    <div style={styles.globePane}>
      <GodsEyeSurface
        embedUrl={GLOBE_URL}
        projectId={projectId}
        cardId={cardId}
        focus={candidateFocus(selectedCandidate)}
        onReady={(version) => { setSourceVersion(version); setSurfaceError(null); }}
        onNativeAgentState={setNativeAgentState}
        onLayerStateChange={setLayerState}
        onError={(error) => setSurfaceError(`${error.code}: ${error.message}`)}
      />
      <div style={styles.statusBar}>
        <span style={styles.brand}>WORLDVIEW</span>
        <span>{sourceVersion ? `God’s Eye ${sourceVersion}` : 'connecting to God’s Eye'}</span>
        <span>{layerState ? `${layerState.enabledLayerIds.length} native layers active` : 'layer clock pending'}</span>
        <span>{nativeAgentState
          ? `native realtime ${nativeAgentState.available ? (nativeAgentState.active ? 'active' : 'available · user-started') : 'unavailable'}`
          : 'native realtime state pending'}</span>
        {surfaceError ? <span style={styles.error}>{surfaceError}</span> : null}
      </div>
    </div>
  </section>;
}

const styles: Record<string, React.CSSProperties> = {
  root: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', height: '100%', minHeight: 0, background: '#050b10', color: '#d9f7f2' },
  globePane: { position: 'relative', minWidth: 0, minHeight: 0 },
  statusBar: { position: 'absolute', left: 14, right: 14, top: 12, display: 'flex', flexWrap: 'wrap', gap: 9, alignItems: 'center', padding: '7px 10px', border: '1px solid rgba(114,215,199,.2)', borderRadius: 999, background: 'rgba(5,11,16,.82)', backdropFilter: 'blur(12px)', color: '#7f9eaa', fontSize: 10, pointerEvents: 'none' },
  brand: { color: '#d9f7f2', letterSpacing: '.18em', fontWeight: 800 },
  error: { color: '#f39b73' },
  unavailable: { display: 'grid', placeContent: 'center', gap: 6, height: '100%', padding: 24, textAlign: 'center', color: '#78929c', background: '#050b10' },
};
