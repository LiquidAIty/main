export type SignalGeoPoint = {
  type: 'Point';
  coordinates: [number, number];
};

export type SignalEvidenceReference = {
  sourceNativeRef: string;
  contentHash: string;
  artifactId?: string | null;
};

export type SignalCandidate = {
  schemaVersion: 'signal.candidate.v1';
  candidateId: string;
  projectId: string;
  deckId: string;
  producerCardId: string;
  producerRunId: string;
  source: {
    system: string;
    nativeRef: string;
    retrievalMethod: string;
    contentHash: string;
    licenseRef?: string | null;
    attribution?: string | null;
  };
  observedAt?: string | null;
  asOfAt?: string | null;
  retrievedAt: string;
  expiresAt?: string | null;
  freshness: 'fresh' | 'stale' | 'unknown' | 'retracted';
  stalenessState: 'current' | 'expired' | 'unknown' | 'retracted';
  domain: string;
  location?: SignalGeoPoint | null;
  entityRefs: string[];
  assetRefs: string[];
  topics: string[];
  possibleRelevance?: string | null;
  horizon?: string | null;
  confidence?: number | null;
  lifecycleStatus: 'observed' | 'watching' | 'resolved' | 'retracted';
  evidenceRefs: SignalEvidenceReference[];
  rawObservation: Record<string, unknown>;
  agentHypothesis?: string | null;
};

export type SignalPackage = {
  schemaVersion: 'signal.package.v1';
  packageId: string;
  projectId: string;
  deckId: string;
  producerCardId: string;
  producerRunId: string;
  generatedAt: string;
  query: {
    schemaVersion: 'signal.query.v1';
    queryId: string;
    requestingCardId: string;
    requestingRunId: string;
    reason: string;
  };
  candidates: SignalCandidate[];
  truncated: boolean;
  cursor?: string | null;
  sourceClocks: Record<string, string | null>;
  errors: string[];
};

export type SignalAssessment = {
  schemaVersion: 'signal.assessment.v1';
  assessmentId: string;
  projectId: string;
  deckId: string;
  requestingCardId: string;
  requestingRunId: string;
  analystCardId: string;
  analysisRunId: string;
  packageId: string;
  candidateIds: string[];
  disposition: 'SUPPORTED' | 'WEAK' | 'REJECTED' | 'INCONCLUSIVE';
  method: string;
  observations: string[];
  inference: string;
  evidenceRefs: SignalEvidenceReference[];
  limitations: string[];
  confidence: number;
  assessedAt: string;
  asOfAt: string;
  expiresAt?: string | null;
  freshness: 'fresh' | 'stale' | 'unknown';
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasString(value: Record<string, unknown>, key: string): boolean {
  return typeof value[key] === 'string' && value[key] !== '';
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isGeoPoint(value: unknown): value is SignalGeoPoint {
  if (!isRecord(value) || value.type !== 'Point' || !Array.isArray(value.coordinates)) return false;
  return value.coordinates.length === 2
    && value.coordinates.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate));
}

function isEvidenceReference(value: unknown): value is SignalEvidenceReference {
  return isRecord(value)
    && hasString(value, 'sourceNativeRef')
    && hasString(value, 'contentHash');
}

function isSignalCandidate(value: unknown): value is SignalCandidate {
  if (!isRecord(value) || value.schemaVersion !== 'signal.candidate.v1') return false;
  const source = value.source;
  const confidence = value.confidence;
  const freshness = new Set(['fresh', 'stale', 'unknown', 'retracted']);
  const stalenessStates = new Set(['current', 'expired', 'unknown', 'retracted']);
  const lifecycleStates = new Set(['observed', 'watching', 'resolved', 'retracted']);
  return hasString(value, 'candidateId')
    && hasString(value, 'projectId')
    && hasString(value, 'deckId')
    && hasString(value, 'producerCardId')
    && hasString(value, 'producerRunId')
    && hasString(value, 'retrievedAt')
    && hasString(value, 'domain')
    && isRecord(source)
    && hasString(source, 'system')
    && hasString(source, 'nativeRef')
    && hasString(source, 'retrievalMethod')
    && hasString(source, 'contentHash')
    && isOptionalString(source.licenseRef)
    && isOptionalString(source.attribution)
    && isOptionalString(value.observedAt)
    && isOptionalString(value.asOfAt)
    && isOptionalString(value.expiresAt)
    && freshness.has(String(value.freshness))
    && stalenessStates.has(String(value.stalenessState))
    && (value.location === undefined || value.location === null || isGeoPoint(value.location))
    && isStringArray(value.entityRefs)
    && isStringArray(value.assetRefs)
    && isStringArray(value.topics)
    && isOptionalString(value.possibleRelevance)
    && isOptionalString(value.horizon)
    && (confidence === undefined || confidence === null
      || (typeof confidence === 'number' && confidence >= 0 && confidence <= 1))
    && lifecycleStates.has(String(value.lifecycleStatus))
    && Array.isArray(value.evidenceRefs)
    && value.evidenceRefs.every(isEvidenceReference)
    && isRecord(value.rawObservation)
    && isOptionalString(value.agentHypothesis);
}

export function parseSignalPackage(value: unknown): SignalPackage | null {
  if (!isRecord(value) || value.schemaVersion !== 'signal.package.v1') return null;
  const query = value.query;
  if (!hasString(value, 'packageId')
    || !hasString(value, 'projectId')
    || !hasString(value, 'deckId')
    || !hasString(value, 'producerCardId')
    || !hasString(value, 'producerRunId')
    || !hasString(value, 'generatedAt')
    || !isRecord(query)
    || query.schemaVersion !== 'signal.query.v1'
    || !hasString(query, 'queryId')
    || !hasString(query, 'requestingCardId')
    || !hasString(query, 'requestingRunId')
    || !hasString(query, 'reason')
    || !Array.isArray(value.candidates)
    || !value.candidates.every(isSignalCandidate)
    || typeof value.truncated !== 'boolean'
    || !isOptionalString(value.cursor)
    || !isRecord(value.sourceClocks)
    || !Object.values(value.sourceClocks).every((clock) => clock === null || typeof clock === 'string')
    || !Array.isArray(value.errors)
    || !value.errors.every((entry) => typeof entry === 'string')) return null;
  return value as SignalPackage;
}

export function parseSignalAssessment(value: unknown): SignalAssessment | null {
  if (!isRecord(value) || value.schemaVersion !== 'signal.assessment.v1') return null;
  const dispositions = new Set(['SUPPORTED', 'WEAK', 'REJECTED', 'INCONCLUSIVE']);
  const freshness = new Set(['fresh', 'stale', 'unknown']);
  return hasString(value, 'assessmentId')
    && hasString(value, 'projectId')
    && hasString(value, 'deckId')
    && hasString(value, 'requestingCardId')
    && hasString(value, 'requestingRunId')
    && hasString(value, 'analystCardId')
    && hasString(value, 'analysisRunId')
    && hasString(value, 'packageId')
    && isStringArray(value.candidateIds)
    && dispositions.has(String(value.disposition))
    && hasString(value, 'method')
    && Array.isArray(value.observations)
    && value.observations.every((entry) => typeof entry === 'string')
    && hasString(value, 'inference')
    && Array.isArray(value.evidenceRefs)
    && value.evidenceRefs.every(isEvidenceReference)
    && Array.isArray(value.limitations)
    && value.limitations.every((entry) => typeof entry === 'string')
    && typeof value.confidence === 'number'
    && value.confidence >= 0
    && value.confidence <= 1
    && hasString(value, 'assessedAt')
    && hasString(value, 'asOfAt')
    && isOptionalString(value.expiresAt)
    && freshness.has(String(value.freshness))
    ? value as SignalAssessment
    : null;
}

export function parseCardRunJson(output: unknown): unknown {
  if (typeof output !== 'string' || !output.trim()) return null;
  try {
    return JSON.parse(output);
  } catch {
    return null;
  }
}
