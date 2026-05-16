import type { MotionShotPlan } from './sceneGraphMotionPlan';
import type { SceneGraphSource } from './sceneGraphSource';

export type ModelCandidate = {
  id: string;
  modelId: string;
  costTier: 'cheap' | 'premium';
  qualityTier: 'scout' | 'finisher';
};

export type PeepshowScoringRule = {
  id: string;
  label: string;
  target: 'non_negotiable' | 'camera_continuity' | 'flow_direction' | 'geometry_lock';
  weight: number;
  minPassScore: number;
};

export type GenerationPromotionRule = {
  id: string;
  label: string;
  minOverallScore: number;
  requireZeroNonNegotiableViolations: boolean;
};

export type GenerationReviewResult = {
  runId: string;
  peepshowReportReference: string | null;
  overallScore: number;
  preservedWins: string[];
  requiredFixes: string[];
  nonNegotiableViolations: string[];
  ruleScores: Array<{
    ruleId: string;
    score: number;
    passed: boolean;
  }>;
};

export type GenerationCorrectionPacket = {
  id: string;
  sourceRunId: string;
  peepshowReportReference: string | null;
  preservedWins: string[];
  requiredFixes: string[];
  lockedNonNegotiables: string[];
  summary: string;
};

export type GenerationRetryBudget = {
  maxScoutRuns: number;
  maxFinisherRuns: number;
  usedScoutRuns: number;
  usedFinisherRuns: number;
};

export type ScoutGenerationRun = {
  cascadeId: string;
  shotId: string;
  modelId: string;
  costTier: 'cheap';
  qualityTier: 'scout';
  sourceFrames: {
    startFrame: number;
    endFrame: number;
    durationFrames: number;
  };
  scoutResultJobId: string | null;
};

export type FinisherGenerationRun = {
  cascadeId: string;
  shotId: string;
  modelId: string;
  costTier: 'premium';
  qualityTier: 'finisher';
  parentScoutJobId: string | null;
  sourceFrames: {
    startFrame: number;
    endFrame: number;
    durationFrames: number;
  };
  finisherResultJobId: string | null;
};

export type FinalGenerationPacket = {
  cascadeId: string;
  shotId: string;
  model: string;
  finalPromptPayload: string;
  sourceSceneId: string;
  sourceFrames: {
    startFrame: number;
    endFrame: number;
    durationFrames: number;
  };
  cameraIntent: string;
  motionInstruction: string;
  diffusionInstruction: string;
  lockedNonNegotiables: string[];
  correctionPacket: GenerationCorrectionPacket | null;
  parentJobId: string | null;
};

export type ModelCascadePlan = {
  id: string;
  sceneId: string;
  shotId: string;
  scoutModel: ModelCandidate;
  finisherModel: ModelCandidate;
  scoringRules: PeepshowScoringRule[];
  promotionRule: GenerationPromotionRule;
  retryBudget: GenerationRetryBudget;
  scoutRun: ScoutGenerationRun;
  finisherRun: FinisherGenerationRun;
  stages: Array<
    | 'scout_generation'
    | 'scout_review'
    | 'correction_packet'
    | 'finisher_generation'
    | 'final_review'
    | 'remotion_target'
  >;
};

export const KoolSkoolsProgressiveVideoCascade: ModelCascadePlan = {
  id: 'cascade_koolskools_progressive_video',
  sceneId: 'scene_koolskools_current_cooler_concept',
  shotId: 'kf_1',
  scoutModel: {
    id: 'candidate_scout',
    modelId: 'google/veo-3-fast',
    costTier: 'cheap',
    qualityTier: 'scout',
  },
  finisherModel: {
    id: 'candidate_finisher',
    modelId: 'google/veo-3',
    costTier: 'premium',
    qualityTier: 'finisher',
  },
  scoringRules: [
    {
      id: 'rule_non_negotiables',
      label: 'Non-negotiables preserved',
      target: 'non_negotiable',
      weight: 0.45,
      minPassScore: 0.95,
    },
    {
      id: 'rule_flow_direction',
      label: 'Airflow direction fidelity',
      target: 'flow_direction',
      weight: 0.25,
      minPassScore: 0.9,
    },
    {
      id: 'rule_camera_continuity',
      label: 'Shot framing continuity',
      target: 'camera_continuity',
      weight: 0.15,
      minPassScore: 0.8,
    },
    {
      id: 'rule_geometry_lock',
      label: 'Geometry/dimension lock',
      target: 'geometry_lock',
      weight: 0.15,
      minPassScore: 0.85,
    },
  ],
  promotionRule: {
    id: 'promotion_scout_to_finisher',
    label: 'Promote scout run to finisher when quality threshold clears.',
    minOverallScore: 0.82,
    requireZeroNonNegotiableViolations: true,
  },
  retryBudget: {
    maxScoutRuns: 3,
    maxFinisherRuns: 2,
    usedScoutRuns: 0,
    usedFinisherRuns: 0,
  },
  scoutRun: {
    cascadeId: 'cascade_koolskools_progressive_video',
    shotId: 'kf_1',
    modelId: 'google/veo-3-fast',
    costTier: 'cheap',
    qualityTier: 'scout',
    sourceFrames: {
      startFrame: 15,
      endFrame: 90,
      durationFrames: 75,
    },
    scoutResultJobId: null,
  },
  finisherRun: {
    cascadeId: 'cascade_koolskools_progressive_video',
    shotId: 'kf_1',
    modelId: 'google/veo-3',
    costTier: 'premium',
    qualityTier: 'finisher',
    parentScoutJobId: null,
    sourceFrames: {
      startFrame: 15,
      endFrame: 90,
      durationFrames: 75,
    },
    finisherResultJobId: null,
  },
  stages: [
    'scout_generation',
    'scout_review',
    'correction_packet',
    'finisher_generation',
    'final_review',
    'remotion_target',
  ],
};

export function compileSceneGraphShotToScoutPayload(
  scene: SceneGraphSource,
  shot: MotionShotPlan,
  cascade: ModelCascadePlan,
): FinalGenerationPacket {
  return {
    cascadeId: cascade.id,
    shotId: shot.shotId,
    model: cascade.scoutModel.modelId,
    finalPromptPayload: [
      `Scene: ${scene.name}`,
      `Shot: ${shot.shotId}`,
      `Camera intent: ${shot.cameraIntent}`,
      `Motion instruction: ${shot.motionInstruction}`,
      `Diffusion instruction: ${shot.diffusionInstruction}`,
      'Locked non-negotiables:',
      ...shot.lockedNonNegotiables.map((rule) => `- ${rule}`),
    ].join('\n'),
    sourceSceneId: scene.id,
    sourceFrames: {
      startFrame: shot.startFrame,
      endFrame: shot.endFrame,
      durationFrames: shot.durationFrames,
    },
    cameraIntent: shot.cameraIntent,
    motionInstruction: shot.motionInstruction,
    diffusionInstruction: shot.diffusionInstruction,
    lockedNonNegotiables: shot.lockedNonNegotiables,
    correctionPacket: null,
    parentJobId: null,
  };
}

export function scoreGenerationReviewAgainstNonNegotiables(
  review: GenerationReviewResult,
): number {
  if (review.nonNegotiableViolations.length > 0) return 0;
  return review.overallScore;
}

export function compilePeepshowReviewToCorrectionPacket(
  review: GenerationReviewResult,
  lockedNonNegotiables: string[],
): GenerationCorrectionPacket {
  return {
    id: `correction_${review.runId}`,
    sourceRunId: review.runId,
    peepshowReportReference: review.peepshowReportReference,
    preservedWins: review.preservedWins,
    requiredFixes: review.requiredFixes,
    lockedNonNegotiables,
    summary: [
      `Preserve wins: ${review.preservedWins.join(', ') || 'none listed'}.`,
      `Fix next: ${review.requiredFixes.join(', ') || 'none listed'}.`,
      'Do not violate locked non-negotiables.',
    ].join(' '),
  };
}

export function promoteScoutRunToFinalGenerationPacket(
  scoutPacket: FinalGenerationPacket,
  finisherModelId: string,
  review: GenerationReviewResult,
  correctionPacket: GenerationCorrectionPacket,
): FinalGenerationPacket {
  return {
    ...scoutPacket,
    model: finisherModelId,
    correctionPacket,
    parentJobId: review.runId,
    finalPromptPayload: [
      scoutPacket.finalPromptPayload,
      '',
      'Correction packet:',
      `- Preserve wins: ${correctionPacket.preservedWins.join(', ') || 'none listed'}`,
      `- Required fixes: ${correctionPacket.requiredFixes.join(', ') || 'none listed'}`,
      `- Locked rules: ${correctionPacket.lockedNonNegotiables.join(' | ')}`,
    ].join('\n'),
  };
}

export function compileFinalGenerationPacketToOpenRouterPayload(
  packet: FinalGenerationPacket,
  stage: 'scout' | 'finisher',
) {
  return {
    prompt: packet.finalPromptPayload,
    model: packet.model,
    sourceSceneId: packet.sourceSceneId,
    sourceVideoGraphId: null,
    sourceShotId: packet.shotId,
    startFrame: packet.sourceFrames.startFrame,
    endFrame: packet.sourceFrames.endFrame,
    durationFrames: packet.sourceFrames.durationFrames,
    cameraIntent: packet.cameraIntent,
    motionInstruction: packet.motionInstruction,
    diffusionInstruction: packet.diffusionInstruction,
    lockedNonNegotiables: packet.lockedNonNegotiables,
    cascadeId: packet.cascadeId,
    cascadeStage: stage,
    parentJobId: packet.parentJobId,
    correctionPacket: packet.correctionPacket
      ? {
          preservedWins: packet.correctionPacket.preservedWins,
          requiredFixes: packet.correctionPacket.requiredFixes,
          summary: packet.correctionPacket.summary,
        }
      : undefined,
  };
}
