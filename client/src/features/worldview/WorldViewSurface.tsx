import { useEffect, useMemo, useState } from 'react';

import GodsEyeSurface, {
  type GodsEyeFocusRequest,
  type GodsEyeLayerState,
  type GodsEyeNativeAgentState,
  type GodsEyeSelectionRef,
} from '../../components/worldsignal/GodsEyeSurface';
import {
  parseCardRunJson,
  parseSignalAssessment,
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
  const response = await fetch('/api/coder/mcp-bridge/run_configured_card', {
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

function candidateLabel(candidate: SignalCandidate): string {
  return candidate.entityRefs[0]
    || candidate.assetRefs[0]
    || `${candidate.domain} observation`;
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
  analystCardId = null,
  signalPackage,
  assessment,
}: WorldViewSurfaceProps) {
  const [persistedPackage, setPersistedPackage] = useState<SignalPackage | null>(null);
  const [persistedAssessment, setPersistedAssessment] = useState<SignalAssessment | null>(null);
  const [evidenceStatus, setEvidenceStatus] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle');
  const [sourceVersion, setSourceVersion] = useState<string | null>(null);
  const [selection, setSelection] = useState<GodsEyeSelectionRef | null>(null);
  const [layerState, setLayerState] = useState<GodsEyeLayerState | null>(null);
  const [nativeAgentState, setNativeAgentState] = useState<GodsEyeNativeAgentState | null>(null);
  const [surfaceError, setSurfaceError] = useState<string | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const activePackage = signalPackage === undefined ? persistedPackage : signalPackage;
  const activeAssessment = assessment === undefined ? persistedAssessment : assessment;

  useEffect(() => {
    if (signalPackage !== undefined || !projectId || !cardId) return undefined;
    let cancelled = false;
    setPersistedPackage(null);
    setPersistedAssessment(null);
    setEvidenceStatus('loading');
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
        const assessmentRun = analystCardId && assessment === undefined
          ? await readLatestCardOutput({ projectId, deckId, cardId: analystCardId }) : null;
        const assessmentValue = parseSignalAssessment(assessmentRun?.value);
        const scopedAssessment = assessmentValue
          && assessmentValue.projectId === projectId
          && assessmentValue.deckId === deckId
          && assessmentValue.analystCardId === analystCardId
          && assessmentValue.analysisRunId === assessmentRun?.runId
          && assessmentValue.requestingCardId === cardId
          && assessmentValue.requestingRunId === scopedPackage?.producerRunId
          ? assessmentValue : null;
        if (cancelled) return;
        setPersistedPackage(scopedPackage);
        setPersistedAssessment(scopedAssessment);
        setEvidenceStatus(scopedPackage ? 'ready' : 'unavailable');
      } catch {
        if (!cancelled) setEvidenceStatus('unavailable');
      }
    })();
    return () => { cancelled = true; };
  }, [analystCardId, assessment, cardId, deckId, projectId, signalPackage]);

  const selectedCandidate = useMemo(() => {
    if (!activePackage?.candidates.length) return null;
    return activePackage.candidates.find((candidate) => candidate.candidateId === selectedCandidateId)
      || activePackage.candidates[0];
  }, [activePackage, selectedCandidateId]);
  const linkedAssessment = activeAssessment && activePackage
    && activeAssessment.packageId === activePackage.packageId
    && selectedCandidate
    && activeAssessment.candidateIds.includes(selectedCandidate.candidateId)
    ? activeAssessment
    : null;

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
        onSelectionChange={setSelection}
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
    <aside style={styles.evidencePane} aria-label="WorldView evidence drawer">
      <header style={styles.drawerHeader}>
        <div>
          <div style={styles.eyebrow}>EVIDENCE CHAIN</div>
          <strong>{activePackage?.packageId || 'No SignalPackage attached'}</strong>
        </div>
        <span style={styles.count}>{activePackage?.candidates.length || 0}</span>
      </header>

      {activePackage ? <div style={styles.candidateList}>
        {activePackage.candidates.map((candidate) => <button
          key={candidate.candidateId}
          type="button"
          onClick={() => setSelectedCandidateId(candidate.candidateId)}
          style={{
            ...styles.candidateButton,
            borderColor: selectedCandidate?.candidateId === candidate.candidateId ? '#72d7c7' : '#243841',
          }}
        >
          <span>{candidateLabel(candidate)}</span>
          <small>{candidate.location ? 'geographic · evidence flight' : 'non-geographic · evidence only'}</small>
        </button>)}
      </div> : <p style={styles.empty}>
        {evidenceStatus === 'loading' ? 'Reading the latest persisted WorldView Card Run.'
          : <>A Card Run can request one bounded package through <code>worldsignals.package</code>.</>}
        The globe remains useful while the source is disconnected; no fixture is shown as live data.
      </p>}

      {selectedCandidate ? <div style={styles.lanes}>
        <EvidenceLane title="Observed fact" tone="#72d7c7">
          <dl style={styles.details}>
            <dt>Source</dt><dd>{selectedCandidate.source.system}</dd>
            <dt>Native ref</dt><dd>{selectedCandidate.source.nativeRef}</dd>
            <dt>Retrieved</dt><dd>{selectedCandidate.retrievedAt}</dd>
            <dt>Freshness</dt><dd>{selectedCandidate.freshness} / {selectedCandidate.stalenessState}</dd>
            <dt>Evidence</dt><dd>{selectedCandidate.evidenceRefs[0]?.contentHash || 'missing'}</dd>
          </dl>
        </EvidenceLane>
        <EvidenceLane title="Agent hypothesis" tone="#d5ae6a">
          {selectedCandidate.agentHypothesis || 'No hypothesis supplied. The source observation remains unmodified.'}
        </EvidenceLane>
        <EvidenceLane title="Analyst assessment" tone="#ad8ce7">
          {linkedAssessment
            ? <><strong>{linkedAssessment.disposition}</strong><p>{linkedAssessment.inference}</p>
              <small>{linkedAssessment.analysisRunId} · confidence {linkedAssessment.confidence}</small></>
            : 'No linked assessment has been returned for this candidate.'}
        </EvidenceLane>
      </div> : selection ? <div style={styles.lanes}>
        <EvidenceLane title="Observed God’s Eye selection" tone="#72d7c7">
          <dl style={styles.details}>
            <dt>Native id</dt><dd>{selection.id}</dd>
            <dt>Layer</dt><dd>{selection.type}</dd>
            <dt>Label</dt><dd>{selection.label || 'unlabeled'}</dd>
            <dt>Position</dt><dd>{selection.position
              ? `${selection.position.latitude.toFixed(4)}, ${selection.position.longitude.toFixed(4)}`
              : 'source supplied no coordinates'}</dd>
          </dl>
        </EvidenceLane>
        <EvidenceLane title="Agent hypothesis" tone="#d5ae6a">Not requested.</EvidenceLane>
        <EvidenceLane title="Analyst assessment" tone="#ad8ce7">Not requested.</EvidenceLane>
      </div> : <p style={styles.empty}>Select a native globe object to inspect its bounded source identity.</p>}
    </aside>
  </section>;
}

function EvidenceLane({ title, tone, children }: {
  title: string;
  tone: string;
  children: React.ReactNode;
}) {
  return <section style={{ ...styles.lane, borderLeftColor: tone }}>
    <div style={{ ...styles.eyebrow, color: tone }}>{title}</div>
    <div style={styles.laneBody}>{children}</div>
  </section>;
}

const styles: Record<string, React.CSSProperties> = {
  root: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(300px, 25vw)', height: '100%', minHeight: 0, background: '#050b10', color: '#d9f7f2' },
  globePane: { position: 'relative', minWidth: 0, minHeight: 0 },
  statusBar: { position: 'absolute', left: 14, right: 14, top: 12, display: 'flex', flexWrap: 'wrap', gap: 9, alignItems: 'center', padding: '7px 10px', border: '1px solid rgba(114,215,199,.2)', borderRadius: 999, background: 'rgba(5,11,16,.82)', backdropFilter: 'blur(12px)', color: '#7f9eaa', fontSize: 10, pointerEvents: 'none' },
  brand: { color: '#d9f7f2', letterSpacing: '.18em', fontWeight: 800 },
  error: { color: '#f39b73' },
  evidencePane: { minWidth: 0, overflowY: 'auto', borderLeft: '1px solid #1c3038', background: 'linear-gradient(180deg,#0a1419,#071015)', padding: 14 },
  drawerHeader: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', paddingBottom: 12, borderBottom: '1px solid #1c3038', wordBreak: 'break-word' },
  eyebrow: { fontSize: 9, letterSpacing: '.16em', textTransform: 'uppercase', color: '#66818c', marginBottom: 4 },
  count: { minWidth: 28, height: 28, display: 'grid', placeItems: 'center', borderRadius: '50%', border: '1px solid #304a54', color: '#72d7c7' },
  candidateList: { display: 'grid', gap: 7, marginTop: 12 },
  candidateButton: { display: 'grid', gap: 3, textAlign: 'left', padding: '9px 10px', border: '1px solid', borderRadius: 9, background: '#0d1a20', color: '#d9f7f2', cursor: 'pointer' },
  lanes: { display: 'grid', gap: 9, marginTop: 13 },
  lane: { border: '1px solid #20363f', borderLeft: '3px solid', borderRadius: 9, padding: 10, background: 'rgba(15,27,33,.72)' },
  laneBody: { color: '#a8bdc5', fontSize: 10.5, lineHeight: 1.5, overflowWrap: 'anywhere' },
  details: { display: 'grid', gridTemplateColumns: '76px minmax(0,1fr)', gap: '5px 8px', margin: 0 },
  empty: { color: '#78929c', fontSize: 11, lineHeight: 1.55, padding: '8px 2px' },
  unavailable: { display: 'grid', placeContent: 'center', gap: 6, height: '100%', padding: 24, textAlign: 'center', color: '#78929c', background: '#050b10' },
};
