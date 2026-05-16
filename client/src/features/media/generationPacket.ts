import type { MotionShotPlan } from './sceneGraphMotionPlan';
import type { SceneGraphSource } from './sceneGraphSource';

export type GenerationPacketSourceType =
  | 'threeScene'
  | 'imageFrame'
  | 'videoClip'
  | 'simulationFrame'
  | 'generatedStill'
  | 'scoutResult';

export type GenerationPacketFrameRef = {
  id: string;
  label: string;
  url?: string;
  frame?: number;
  note?: string;
};

export type GenerationPacketPrompt = {
  main: string;
  negative?: string;
};

export type GenerationPacketNarration = {
  text?: string;
  voice?: string;
};

export type GenerationPacketConstraint = {
  id: string;
  rule: string;
  locked: boolean;
};

export type GenerationPacketReviewTarget = {
  id: string;
  label: string;
  severity: 'hard' | 'soft';
};

export type GenerationPacketOutputTarget =
  | 'videoDiffusion'
  | 'peepshowReview'
  | 'seedFrame'
  | 'remotionAssembly';

export type GenerationPacketLineage = {
  origin: GenerationPacketSourceType;
  parentPacketId?: string;
  parentJobId?: string;
  summary?: string;
};

export type GenerationPacketInput = {
  sourceSceneId?: string;
  sourceShotId?: string;
  sourceType: GenerationPacketSourceType;
  sourceRefs: GenerationPacketFrameRef[];
};

export type GenerationPacket = {
  packetId: string;
  sourceSceneId?: string;
  sourceShotId?: string;
  sourceType: GenerationPacketSourceType;
  sourceRefs: GenerationPacketFrameRef[];
  startFrame: number;
  endFrame: number;
  durationFrames: number;
  fps: number;
  cameraIntent: string;
  motionInstruction: string;
  diffusionInstruction: string;
  promptBetweenFrames: GenerationPacketPrompt;
  narration?: GenerationPacketNarration;
  lockedNonNegotiables: string[];
  visualContractRefs: string[];
  cascadeId?: string;
  cascadeStage?: 'scout' | 'finisher';
  parentJobId?: string;
  peepshowReviewRef?: string;
  correctionPacket?: {
    preservedWins: string[];
    requiredFixes: string[];
    summary?: string;
  };
  outputTargets: GenerationPacketOutputTarget[];
  lineage: GenerationPacketLineage;
};

export type ShotSourceType =
  | 'threeScene'
  | 'imageFrame'
  | 'videoClip'
  | 'simulationFrame'
  | 'generatedStill';

export type ShotKeyframe = {
  frame: number;
  label: string;
};

export type ShotFrameRange = {
  startFrame: number;
  endFrame: number;
  durationFrames: number;
  fps: number;
};

export type ShotNarration = {
  text?: string;
  voice?: string;
};

export type ShotTransitionInstruction = {
  fromShotId?: string;
  toShotId?: string;
  instruction: string;
};

export type ShotDiffusionInstruction = {
  promptBetweenFrames: string;
  negativePrompt?: string;
};

export type ShotReviewChecklist = {
  required: string[];
  optional: string[];
};

export type SceneShot = {
  shotId: string;
  sceneId: string;
  sourceType: ShotSourceType;
  sourceSceneGraphId?: string;
  sourceImageUrl?: string;
  sourceVideoUrl?: string;
  startFrame: number;
  endFrame: number;
  durationFrames: number;
  fps: number;
  narration?: ShotNarration;
  promptBetweenFrames: string;
  motionInstruction: string;
  diffusionInstruction: string;
  lockedNonNegotiables: string[];
  reviewChecklist: ShotReviewChecklist;
  outputTargets: GenerationPacketOutputTarget[];
};

export type SceneSequence = {
  sceneId: string;
  shots: SceneShot[];
  transitions: ShotTransitionInstruction[];
};

export type MovieSequencePlan = {
  sequenceId: string;
  totalFrames: number;
  fps: number;
  shots: Array<{
    shotId: string;
    startFrame: number;
    endFrame: number;
    sourceType: ShotSourceType;
  }>;
};

export function estimateFrameCountForDuration(durationSec: number, fps: number): number {
  return Math.max(1, Math.round(Math.max(0, durationSec) * Math.max(1, fps)));
}

export function estimateGenerationPacketFrames(
  durationSec: number,
  fps: number,
): ShotFrameRange {
  const durationFrames = estimateFrameCountForDuration(durationSec, fps);
  return {
    startFrame: 0,
    endFrame: durationFrames,
    durationFrames,
    fps,
  };
}

export function compileSceneGraphShotToGenerationPacket(
  scene: SceneGraphSource,
  shot: MotionShotPlan,
): GenerationPacket {
  return {
    packetId: `packet_${scene.id}_${shot.shotId}`,
    sourceSceneId: scene.id,
    sourceShotId: shot.shotId,
    sourceType: 'threeScene',
    sourceRefs: [{ id: `three_${shot.shotId}`, label: 'Three.js blockout frame source' }],
    startFrame: shot.startFrame,
    endFrame: shot.endFrame,
    durationFrames: shot.durationFrames,
    fps: 30,
    cameraIntent: shot.cameraIntent,
    motionInstruction: shot.motionInstruction,
    diffusionInstruction: shot.diffusionInstruction,
    promptBetweenFrames: {
      main: `Maintain continuity for ${shot.shotId} between keyframes while preserving geometry and airflow direction.`,
    },
    narration: {
      text: `${scene.name} ${shot.shotId} concept shot.`,
    },
    lockedNonNegotiables: shot.lockedNonNegotiables,
    visualContractRefs: scene.visualContracts.map((contract) => contract.id),
    outputTargets: ['videoDiffusion', 'peepshowReview'],
    lineage: {
      origin: 'threeScene',
      summary: 'Compiled from SceneGraph shot and motion plan.',
    },
  };
}

export function compileImageFrameToGenerationPacket(args: {
  packetId: string;
  sceneId?: string;
  shotId?: string;
  imageUrl: string;
  fps: number;
  durationSec: number;
  prompt: string;
  narration?: string;
  lockedNonNegotiables?: string[];
}): GenerationPacket {
  const range = estimateGenerationPacketFrames(args.durationSec, args.fps);
  return {
    packetId: args.packetId,
    sourceSceneId: args.sceneId,
    sourceShotId: args.shotId,
    sourceType: 'imageFrame',
    sourceRefs: [{ id: 'source_image', label: 'Image keyframe', url: args.imageUrl }],
    startFrame: range.startFrame,
    endFrame: range.endFrame,
    durationFrames: range.durationFrames,
    fps: args.fps,
    cameraIntent: 'Image-led camera continuity',
    motionInstruction: 'Create subtle motion from image keyframe while preserving subject placement.',
    diffusionInstruction: 'Respect source image composition and object identity.',
    promptBetweenFrames: { main: args.prompt },
    narration: args.narration ? { text: args.narration } : undefined,
    lockedNonNegotiables: args.lockedNonNegotiables ?? [],
    visualContractRefs: [],
    outputTargets: ['videoDiffusion', 'peepshowReview'],
    lineage: {
      origin: 'imageFrame',
      summary: 'Compiled from static image frame + prompt.',
    },
  };
}

export function compileVideoClipToGenerationPacket(args: {
  packetId: string;
  sceneId?: string;
  shotId?: string;
  videoUrl: string;
  fps: number;
  startFrame: number;
  endFrame: number;
  prompt: string;
  correctionPrompt: string;
  lockedNonNegotiables?: string[];
  parentJobId?: string;
}): GenerationPacket {
  const durationFrames = Math.max(1, args.endFrame - args.startFrame);
  return {
    packetId: args.packetId,
    sourceSceneId: args.sceneId,
    sourceShotId: args.shotId,
    sourceType: 'videoClip',
    sourceRefs: [{ id: 'source_video', label: 'Video clip source', url: args.videoUrl }],
    startFrame: args.startFrame,
    endFrame: args.endFrame,
    durationFrames,
    fps: args.fps,
    cameraIntent: 'Carry forward source clip framing',
    motionInstruction: args.correctionPrompt,
    diffusionInstruction: 'Apply corrections while preserving successful visual continuity.',
    promptBetweenFrames: { main: args.prompt },
    lockedNonNegotiables: args.lockedNonNegotiables ?? [],
    visualContractRefs: [],
    parentJobId: args.parentJobId,
    outputTargets: ['videoDiffusion', 'peepshowReview'],
    lineage: {
      origin: 'videoClip',
      parentJobId: args.parentJobId,
      summary: 'Compiled from existing video clip with correction prompt.',
    },
  };
}

export function compileSimulationFrameToGenerationPacket(args: {
  packetId: string;
  sceneId?: string;
  shotId?: string;
  frameUrl: string;
  fps: number;
  durationSec: number;
  prompt: string;
  narration?: string;
  lockedNonNegotiables?: string[];
}): GenerationPacket {
  const range = estimateGenerationPacketFrames(args.durationSec, args.fps);
  return {
    packetId: args.packetId,
    sourceSceneId: args.sceneId,
    sourceShotId: args.shotId,
    sourceType: 'simulationFrame',
    sourceRefs: [{ id: 'source_sim', label: 'Simulation frame', url: args.frameUrl }],
    startFrame: range.startFrame,
    endFrame: range.endFrame,
    durationFrames: range.durationFrames,
    fps: args.fps,
    cameraIntent: 'Simulation-aligned camera lock',
    motionInstruction: 'Animate simulation data transitions with stable measurement context.',
    diffusionInstruction: 'Keep simulation arrows/labels deterministic and legible.',
    promptBetweenFrames: { main: args.prompt },
    narration: args.narration ? { text: args.narration } : undefined,
    lockedNonNegotiables: args.lockedNonNegotiables ?? [],
    visualContractRefs: [],
    outputTargets: ['videoDiffusion', 'peepshowReview'],
    lineage: {
      origin: 'simulationFrame',
      summary: 'Compiled from simulation frame + narrative prompt.',
    },
  };
}

export function compileScoutResultToFinisherGenerationPacket(args: {
  scoutPacket: GenerationPacket;
  finisherModelInstruction: string;
  peepshowReviewRef?: string;
  correctionPacket?: GenerationPacket['correctionPacket'];
  parentJobId?: string;
}): GenerationPacket {
  return {
    ...args.scoutPacket,
    packetId: `${args.scoutPacket.packetId}_finisher`,
    sourceType: 'scoutResult',
    peepshowReviewRef: args.peepshowReviewRef,
    correctionPacket: args.correctionPacket,
    parentJobId: args.parentJobId,
    cascadeStage: 'finisher',
    promptBetweenFrames: {
      main: `${args.scoutPacket.promptBetweenFrames.main}\n${args.finisherModelInstruction}`,
      negative: args.scoutPacket.promptBetweenFrames.negative,
    },
    lineage: {
      origin: 'scoutResult',
      parentPacketId: args.scoutPacket.packetId,
      parentJobId: args.parentJobId,
      summary: 'Promoted scout result to finisher packet.',
    },
  };
}

export function compileGenerationPacketToOpenRouterPayload(packet: GenerationPacket) {
  return {
    prompt: packet.promptBetweenFrames.main,
    sourceSceneId: packet.sourceSceneId,
    sourceVideoGraphId: null,
    sourceShotId: packet.sourceShotId,
    generationPacketId: packet.packetId,
    sourceType: packet.sourceType,
    fps: packet.fps,
    promptBetweenFrames: packet.promptBetweenFrames.main,
    narration: packet.narration,
    outputTargets: packet.outputTargets,
    lineage: { summary: packet.lineage.summary },
    startFrame: packet.startFrame,
    endFrame: packet.endFrame,
    durationFrames: packet.durationFrames,
    cameraIntent: packet.cameraIntent,
    motionInstruction: packet.motionInstruction,
    diffusionInstruction: packet.diffusionInstruction,
    lockedNonNegotiables: packet.lockedNonNegotiables,
    cascadeId: packet.cascadeId,
    cascadeStage: packet.cascadeStage,
    parentJobId: packet.parentJobId,
    correctionPacket: packet.correctionPacket,
  };
}

export function compileGenerationPacketToPeepshowChecklist(packet: GenerationPacket) {
  return {
    packetId: packet.packetId,
    checks: [
      ...packet.lockedNonNegotiables.map((rule, index) => ({
        id: `lock_${index + 1}`,
        requirement: rule,
        severity: 'hard' as const,
      })),
      ...packet.visualContractRefs.map((contractId) => ({
        id: contractId,
        requirement: `Visual contract ${contractId} remains satisfied.`,
        severity: 'soft' as const,
      })),
    ],
  };
}

export function compileThreeSceneShotToDiffusionPayload(
  packet: GenerationPacket,
): { prompt: string; cameraIntent: string } {
  return {
    prompt: packet.promptBetweenFrames.main,
    cameraIntent: packet.cameraIntent,
  };
}

export function compileImageShotToDiffusionPayload(
  packet: GenerationPacket,
): { prompt: string; sourceImageUrl?: string } {
  return {
    prompt: packet.promptBetweenFrames.main,
    sourceImageUrl: packet.sourceRefs.find((ref) => ref.url)?.url,
  };
}

export function compileShotToOpenRouterPayload(shot: SceneShot) {
  return {
    prompt: shot.promptBetweenFrames,
    sourceSceneId: shot.sceneId,
    sourceShotId: shot.shotId,
    sourceType: shot.sourceType,
    fps: shot.fps,
    startFrame: shot.startFrame,
    endFrame: shot.endFrame,
    durationFrames: shot.durationFrames,
    narration: shot.narration,
    motionInstruction: shot.motionInstruction,
    diffusionInstruction: shot.diffusionInstruction,
    lockedNonNegotiables: shot.lockedNonNegotiables,
    outputTargets: shot.outputTargets,
  };
}

export function compileShotToPeepshowChecklist(shot: SceneShot): ShotReviewChecklist {
  return shot.reviewChecklist;
}

export function compileShotsToMovieSequencePlan(sequence: SceneSequence): MovieSequencePlan {
  const fps = sequence.shots[0]?.fps ?? 30;
  const totalFrames = sequence.shots.reduce((sum, shot) => sum + shot.durationFrames, 0);
  return {
    sequenceId: `movie_${sequence.sceneId}`,
    totalFrames,
    fps,
    shots: sequence.shots.map((shot) => ({
      shotId: shot.shotId,
      startFrame: shot.startFrame,
      endFrame: shot.endFrame,
      sourceType: shot.sourceType,
    })),
  };
}
