import type { SceneGraphSource } from './sceneGraphSource';

export type MotionShotPlan = {
  shotId: string;
  cameraIntent: string;
  startFrame: number;
  endFrame: number;
  durationFrames: number;
  motionInstruction: string;
  diffusionInstruction: string;
  lockedNonNegotiables: string[];
};

export type SceneGraphMotionPlan = {
  sceneId: string;
  sheetName: string;
  fps: number;
  shots: MotionShotPlan[];
};

function resolveEndSecond(seconds: number[], index: number): number {
  const current = seconds[index] ?? 0;
  const next = seconds[index + 1];
  if (typeof next === 'number' && Number.isFinite(next) && next > current) {
    return next;
  }
  return current + 1.2;
}

export function compileSceneGraphToMotionPlan(
  scene: SceneGraphSource,
): SceneGraphMotionPlan {
  const fps = 30;
  const orderedKeyframes = [...scene.keyframes].sort((a, b) => a.second - b.second);
  const seconds = orderedKeyframes.map((keyframe) => keyframe.second);
  const lockedNonNegotiables = scene.nonNegotiableRules.map((rule) => rule.rule);

  const shots = orderedKeyframes.map((keyframe, index) => {
    const camera = scene.cameras.find((candidate) => candidate.id === keyframe.cameraId);
    const endSecond = resolveEndSecond(seconds, index);
    const startFrame = Math.max(0, Math.round(keyframe.second * fps));
    const endFrame = Math.max(startFrame + 1, Math.round(endSecond * fps));
    const durationFrames = endFrame - startFrame;
    const cameraIntent = camera
      ? `${camera.name} (${camera.shotType}, ${camera.movement})`
      : `Camera ${keyframe.cameraId}`;

    return {
      shotId: keyframe.id,
      cameraIntent,
      startFrame,
      endFrame,
      durationFrames,
      motionInstruction: keyframe.action,
      diffusionInstruction: `Preserve scene geometry and flow direction for ${keyframe.label}.`,
      lockedNonNegotiables,
    };
  });

  return {
    sceneId: scene.id,
    sheetName: `scene-${scene.id}`,
    fps,
    shots,
  };
}
