import {
  buildEpisodePatch,
  type EpisodeInput,
  type EpisodeProvenance,
  type EpisodeNodeKind,
  type EpisodeNodeInput,
  type EpisodeArtifactRef,
  type UserJudgmentLabel,
} from './episodeContract';
import { getPromptDraft, promptRecordToEpisodeNodes } from '../prompt/promptLifecycle';
import {
  applyThinkGraphPatch,
  type ThinkGraphPatchAuthority,
  type ApplyThinkGraphPatchResult,
} from './thinkGraphStore';

/**
 * Episode + evaluation closure: assemble ONE connected episode from the run's
 * REAL outputs and persist it through the existing generic ThinkGraph writer.
 *
 * The prompt lineage (PreparedPrompt/PromptRevision/ApprovedPrompt) is pulled
 * from the prompt lifecycle store — never re-authored here — and the caller
 * supplies compact per-step summaries for the reasoning/specialist/orchestration/
 * worker/test/response/judgment steps. Nothing new is stored: it reuses
 * buildEpisodePatch (generic resources/statements) + applyThinkGraphPatch.
 */
export type EpisodeCloseContext = {
  episodeId: string;
  projectId: string;
  conversationId: string;
  goalText: string;
  goalId?: string;
  provenance: EpisodeProvenance;
  /** Prompt lineage is pulled from the lifecycle store for this job, if present. */
  jobId?: string;
  /** Compact per-step summaries; only supplied steps become episode nodes. */
  steps?: Partial<Record<EpisodeNodeKind, string>>;
  graphRefs?: { codeGraph?: string[]; knowGraph?: string[]; thinkGraph?: string[] };
  artifacts?: EpisodeArtifactRef[];
  judgment?: UserJudgmentLabel;
};

/** Assemble the EpisodeInput from the run's outputs. Pure — the unit-testable seam. */
export function buildEpisodeCloseInput(context: EpisodeCloseContext): EpisodeInput {
  const nodes: Partial<Record<EpisodeNodeKind, EpisodeNodeInput>> = {};
  for (const [kind, summary] of Object.entries(context.steps ?? {})) {
    if (summary) nodes[kind as EpisodeNodeKind] = { summary };
  }
  if (context.goalId) {
    nodes.Goal = { summary: context.goalText, properties: { goal_id: context.goalId } };
  }
  // Prompt lineage from the lifecycle store (authored there, not here).
  if (context.jobId) {
    const record = getPromptDraft(context.jobId);
    if (record) Object.assign(nodes, promptRecordToEpisodeNodes(record));
  }
  return {
    episodeId: context.episodeId,
    projectId: context.projectId,
    conversationId: context.conversationId,
    provenance: context.provenance,
    goalText: context.goalText,
    nodes,
    graphRefs: context.graphRefs,
    artifacts: context.artifacts,
    judgment: context.judgment,
  };
}

/**
 * Close the episode: assemble + persist through the existing generic writer.
 * Requires the graph DB; the pure assembly above is the unit-testable seam.
 */
export async function closeEpisode(
  context: EpisodeCloseContext,
  authority: ThinkGraphPatchAuthority,
): Promise<ApplyThinkGraphPatchResult> {
  return applyThinkGraphPatch(authority, buildEpisodePatch(buildEpisodeCloseInput(context)));
}
