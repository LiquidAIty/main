import type { ThinkGraphPatch, ThinkGraphProperties } from './thinkGraphStore';

/**
 * ThinkGraph training-episode contract + builder.
 *
 * A connected episode (Goal → ConversationTurn → … → UserJudgment →
 * TrainingEligibility) recorded as GENERIC ThinkGraph resources/statements — no
 * new store, no schema change. Compact, training-useful fields live in resource
 * properties; bulky payloads (transcripts, diffs, prompts, search bodies, test
 * logs, screenshots) stay as ARTIFACT REFERENCES (path + hash + media type).
 *
 * The same public contract is used by real runs and by synthetic seeds — a
 * synthetic seed only differs by provenance (source=synthetic_seed, verified=
 * false, product_proof=false, training_eligibility=needs_review). buildEpisodePatch
 * is pure and honours the store's structural limits + triple-closure, so its
 * output always passes validateThinkGraphPatch.
 */
export const EPISODE_NODE_KINDS = [
  'Goal',
  'ConversationTurn',
  'MainReasoning',
  'SpecialistInvocation',
  'FilteredCodeGraphView',
  'ResearchResult',
  'UpdatedReasoning',
  'PreparedPrompt',
  'PromptRevision',
  'ApprovedPrompt',
  'MagOneRun',
  'WorkerSelection',
  'WorkerResult',
  'TestResult',
  'MainFinalResponse',
  'UserJudgment',
  'TrainingEligibility',
] as const;
export type EpisodeNodeKind = (typeof EPISODE_NODE_KINDS)[number];

export type EpisodeSource = 'real_run' | 'synthetic_seed' | 'external_agent_standin';
export type UserJudgmentLabel = 'accepted' | 'corrected' | 'rejected' | 'unjudged';
export type TrainingEligibility =
  | 'eligible'
  | 'needs_review'
  | 'negative_example'
  | 'evaluation_only'
  | 'excluded_private'
  | 'excluded_secrets'
  | 'excluded_license';

export type EpisodeProvenance = {
  source: EpisodeSource;
  verified: boolean;
  productProof: boolean;
  trainingEligibility: TrainingEligibility;
  /** The provider/model that DID the episode's specialist work (real runs). */
  provider?: string;
  model?: string;
  authorityMode?: 'direct_main_audit' | 'mag_one_execution';
  /** The generator (synthetic seed) or the stand-in (external_agent_standin) that
   * produced this episode's model outputs — never the same as a real run. */
  generatorProvider?: string;
  generatorModel?: string;
  generationPromptVersion?: string;
  /** external_agent_standin: the run's surrounding mechanisms are real, but a
   * stand-in agent acted at the model boundaries — so it proves plumbing, not
   * that the configured models make good decisions. */
  modelQualityProof?: boolean;
  pipeTest?: boolean;
  privacyExcluded?: boolean;
  secretsExcluded?: boolean;
  licenseExcluded?: boolean;
};

export type EpisodeArtifactRef = {
  /** e.g. terminal_transcript | tool_events | prompt | search_body | diff | test_log | screenshot | generated_file */
  kind: string;
  path: string;
  hash?: string;
  mediaType?: string;
  size?: number;
  /** Which episode node this artifact evidences (defaults to the Episode root). */
  ownerNode?: EpisodeNodeKind;
};

export type EpisodeNodeInput = {
  summary: string;
  properties?: ThinkGraphProperties;
};

export type EpisodeInput = {
  episodeId: string;
  projectId: string;
  conversationId: string;
  provenance: EpisodeProvenance;
  goalText: string;
  /** Compact per-step content. Only present steps become nodes. */
  nodes?: Partial<Record<EpisodeNodeKind, EpisodeNodeInput>>;
  graphRefs?: { codeGraph?: string[]; knowGraph?: string[]; thinkGraph?: string[] };
  artifacts?: EpisodeArtifactRef[];
  judgment?: UserJudgmentLabel;
};

// Structural limits mirrored from thinkGraphStore (keep the builder within them
// so the produced patch always validates). Node kinds (17) + Episode = 18 base
// resources; the remainder budgets artifacts.
const MAX_RESOURCES = 40;
const MAX_STATEMENTS = 30;
const PROP_VALUE_MAX = 200;
const LABEL_MAX = 300;

function compact(value: string, max = PROP_VALUE_MAX): string {
  const one = String(value ?? '').replace(/\s+/g, ' ').trim();
  return one.length > max ? one.slice(0, max) : one;
}

function propValue(value: string | number | boolean): string | number | boolean {
  return typeof value === 'string' ? compact(value) : value;
}

function cleanProps(props: ThinkGraphProperties | undefined): ThinkGraphProperties {
  const out: ThinkGraphProperties = {};
  if (!props) return out;
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null) continue;
    out[compact(k, 60)] = propValue(v as string | number | boolean);
  }
  return out;
}

/** Mandatory synthetic-seed provenance — callers can't forget the labels that
 * keep unverified generated data out of trusted/verified knowledge. */
export function syntheticSeedProvenance(
  generator: { provider: string; model: string; promptVersion: string },
  overrides: Partial<EpisodeProvenance> = {},
): EpisodeProvenance {
  return {
    trainingEligibility: 'needs_review',
    generatorProvider: generator.provider,
    generatorModel: generator.model,
    generationPromptVersion: generator.promptVersion,
    ...overrides,
    // Non-negotiable for synthetic seeds — placed AFTER overrides so a caller can
    // never relax them (keeps unverified generated data out of trusted knowledge).
    source: 'synthetic_seed',
    verified: false,
    productProof: false,
  };
}

/** Mandatory external-agent stand-in provenance (Phase 4 labels). The surrounding
 * mechanisms are real, but a stand-in agent acted at the model boundaries — so
 * this proves plumbing, never that the configured models make good decisions. */
export function externalAgentStandInProvenance(
  standIn: { provider: string; model: string },
  overrides: Partial<EpisodeProvenance> = {},
): EpisodeProvenance {
  return {
    // `verified` defaults false but is overridable — a stand-in run's evidence
    // (tests, artifacts) may be genuinely verified even though the model was a stand-in.
    verified: false,
    trainingEligibility: 'needs_review',
    generatorProvider: standIn.provider,
    generatorModel: standIn.model,
    ...overrides,
    // Locked AFTER overrides: a stand-in run is a pipe test, not product or
    // model-quality proof.
    source: 'external_agent_standin',
    productProof: false,
    modelQualityProof: false,
    pipeTest: true,
  };
}

/** Structural validation of an episode input (never a model call). */
export function validateEpisodeInput(input: EpisodeInput): string | null {
  if (!input || typeof input !== 'object') return 'episode_input_required';
  for (const k of ['episodeId', 'projectId', 'conversationId'] as const) {
    if (!String(input[k] ?? '').trim()) return `episode_${k}_required`;
  }
  if (!String(input.goalText ?? '').trim()) return 'episode_goal_text_required';
  const p = input.provenance;
  if (!p || typeof p !== 'object') return 'episode_provenance_required';
  if (p.source !== 'real_run' && p.source !== 'synthetic_seed' && p.source !== 'external_agent_standin') {
    return 'episode_provenance_source_invalid';
  }
  if (typeof p.verified !== 'boolean' || typeof p.productProof !== 'boolean') return 'episode_provenance_flags_required';
  if (p.source === 'synthetic_seed' && (p.verified || p.productProof)) {
    return 'synthetic_seed_cannot_be_verified_or_product_proof';
  }
  // A stand-in run proves plumbing, never product/model quality.
  if (p.source === 'external_agent_standin' && (p.productProof || p.modelQualityProof)) {
    return 'external_agent_standin_cannot_be_product_or_model_quality_proof';
  }
  if (input.nodes) {
    for (const kind of Object.keys(input.nodes)) {
      if (!(EPISODE_NODE_KINDS as readonly string[]).includes(kind)) return `episode_unknown_node_kind: ${kind}`;
    }
  }
  return null;
}

/**
 * Build the generic ThinkGraphPatch for one episode. Pure. Present nodes become
 * kind-tagged resources chained by `then` statements; artifacts become bounded
 * `Artifact` resources referenced by `evidence` statements; the Episode root
 * carries provenance/labels. Triple-closure holds (every statement endpoint is a
 * declared resource), and the patch stays within the store's limits.
 */
export function buildEpisodePatch(input: EpisodeInput): ThinkGraphPatch {
  const eid = String(input.episodeId).trim();
  const nodeId = (kind: EpisodeNodeKind) => `${eid}:${kind}`;
  const resources: NonNullable<ThinkGraphPatch['resources']> = [];
  const statements: NonNullable<ThinkGraphPatch['statements']> = [];

  const refs = input.graphRefs ?? {};
  const p = input.provenance;

  // ── Episode root: identity + provenance + training labels ──────────────────
  const episodeProps: ThinkGraphProperties = {
    source: p.source,
    verified: p.verified,
    product_proof: p.productProof,
    training_eligibility: p.trainingEligibility,
    conversation_id: compact(input.conversationId),
    judgment: input.judgment ?? 'unjudged',
    code_graph_ref_count: (refs.codeGraph ?? []).length,
    know_graph_ref_count: (refs.knowGraph ?? []).length,
  };
  if (p.provider) episodeProps.provider = compact(p.provider);
  if (p.model) episodeProps.model = compact(p.model);
  if (p.authorityMode) episodeProps.authority_mode = p.authorityMode;
  if (p.generatorProvider) episodeProps.generator_provider = compact(p.generatorProvider);
  if (p.generatorModel) episodeProps.generator_model = compact(p.generatorModel);
  if (p.generationPromptVersion) episodeProps.generation_prompt_version = compact(p.generationPromptVersion);
  if (typeof p.modelQualityProof === 'boolean') episodeProps.model_quality_proof = p.modelQualityProof;
  if (typeof p.pipeTest === 'boolean') episodeProps.pipe_test = p.pipeTest;
  const exclusions: string[] = [];
  if (p.privacyExcluded) exclusions.push('private');
  if (p.secretsExcluded) exclusions.push('secrets');
  if (p.licenseExcluded) exclusions.push('license');
  if (exclusions.length) episodeProps.exclusions = exclusions.join(',');
  const codeSample = (refs.codeGraph ?? []).slice(0, 3).join(' | ');
  if (codeSample) episodeProps.code_graph_refs_sample = compact(codeSample);
  resources.push({ id: eid, label: compact(input.goalText, LABEL_MAX), kind: 'Episode', properties: episodeProps });

  // ── Present lineage nodes, in canonical order ──────────────────────────────
  const presentKinds: EpisodeNodeKind[] = [];
  for (const kind of EPISODE_NODE_KINDS) {
    const node = input.nodes?.[kind];
    // The Goal always exists (from goalText); other nodes only if supplied.
    if (kind !== 'Goal' && !node) continue;
    const summary = kind === 'Goal' ? input.goalText : node!.summary;
    resources.push({
      id: nodeId(kind),
      label: compact(summary, LABEL_MAX),
      kind,
      properties: { ...cleanProps(node?.properties), summary: compact(summary) },
    });
    presentKinds.push(kind);
  }

  // Episode -has_step-> each present node; chain present nodes with `then`.
  let stmtSeq = 0;
  const addStatement = (subject: string, predicateTerm: string, object: string) => {
    if (statements.length >= MAX_STATEMENTS) return false;
    statements.push({ id: `${eid}:st:${stmtSeq++}`, subject, predicateTerm, object });
    return true;
  };
  if (presentKinds.length > 0) addStatement(eid, 'has_step', nodeId(presentKinds[0]));
  for (let i = 1; i < presentKinds.length; i++) {
    addStatement(nodeId(presentKinds[i - 1]), 'then', nodeId(presentKinds[i]));
  }

  // ── Artifact references (bounded by BOTH resource and statement budgets, so
  // every included artifact gets a resource AND its evidence edge — no orphans,
  // no silent truncation past the store limits). ────────────────────────────
  const artifacts = input.artifacts ?? [];
  const artifactCap = Math.max(0, Math.min(MAX_RESOURCES - resources.length, MAX_STATEMENTS - statements.length));
  const included = artifacts.slice(0, artifactCap);
  const dropped = artifacts.length - included.length;
  const presentSet = new Set(presentKinds);
  included.forEach((artifact, i) => {
    const aid = `${eid}:artifact:${i}`;
    const props: ThinkGraphProperties = { artifact_kind: compact(artifact.kind), path: compact(artifact.path) };
    if (artifact.hash) props.hash = compact(artifact.hash);
    if (artifact.mediaType) props.media_type = compact(artifact.mediaType);
    if (typeof artifact.size === 'number') props.size = artifact.size;
    resources.push({ id: aid, label: compact(`${artifact.kind}: ${artifact.path}`, LABEL_MAX), kind: 'Artifact', properties: props });
    const owner = artifact.ownerNode && presentSet.has(artifact.ownerNode) ? nodeId(artifact.ownerNode) : eid;
    addStatement(aid, 'evidence', owner);
  });
  if (dropped > 0) episodeProps.artifacts_dropped = dropped;
  episodeProps.artifact_count = included.length;

  return { resources, statements };
}
