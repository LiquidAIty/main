export type VideoGraphEntityKind =
  | 'character'
  | 'location'
  | 'object'
  | 'brand'
  | 'text_overlay'
  | 'audio_source';

export type VideoGraphEntity = {
  id: string;
  kind: VideoGraphEntityKind;
  label: string;
  attributes?: Record<string, string | number | boolean>;
};

export type VideoGraphRelationship = {
  id: string;
  sourceId: string;
  targetId: string;
  relation: 'contains' | 'focuses_on' | 'interacts_with' | 'transitions_to';
  note?: string;
};

export type VideoGraphAction = {
  id: string;
  actorId: string;
  verb: string;
  targetId?: string;
  startSecond: number;
  endSecond: number;
  intent?: string;
};

export type VideoGraphCamera = {
  shot: 'wide' | 'medium' | 'close_up' | 'insert';
  movement: 'static' | 'dolly' | 'pan' | 'tilt' | 'handheld';
  lens?: string;
  framing?: string;
};

export type VideoGraphStyle = {
  palette: string[];
  lighting: string;
  grade: string;
  texture?: string;
};

export type VideoGraphTiming = {
  durationSeconds: number;
  fps: number;
  beats: Array<{ label: string; second: number }>;
};

export type VideoGraphAudio = {
  voiceover?: string;
  musicCue?: string;
  sfx: string[];
};

export type VideoGraphConstraint = {
  id: string;
  rule: string;
  severity: 'hard' | 'soft';
};

export type VideoGraphReviewCriterion = {
  id: string;
  label: string;
  check: string;
  weight: number;
};

export type VideoGraphScript = {
  id: string;
  title: string;
  brief: string;
  entities: VideoGraphEntity[];
  relationships: VideoGraphRelationship[];
  actions: VideoGraphAction[];
  camera: VideoGraphCamera;
  style: VideoGraphStyle;
  timing: VideoGraphTiming;
  audio: VideoGraphAudio;
  constraints: VideoGraphConstraint[];
  reviewCriteria: VideoGraphReviewCriterion[];
};

export type VideoGraphPeepshowRubric = {
  scriptId: string;
  checks: Array<{
    id: string;
    label: string;
    check: string;
    weight: number;
  }>;
};

export type VideoGraphRemotionProps = {
  compositionId: string;
  title: string;
  durationInFrames: number;
  fps: number;
  palette: string[];
  lighting: string;
  actions: Array<{
    id: string;
    actorId: string;
    targetId?: string;
    startFrame: number;
    endFrame: number;
    verb: string;
    intent?: string;
  }>;
  beats: VideoGraphTiming['beats'];
  voiceover?: string;
  musicCue?: string;
};

function clampToFrame(second: number, fps: number, maxFrames: number): number {
  const frame = Math.round(Math.max(0, second) * fps);
  return Math.min(frame, maxFrames);
}

export function compileVideoGraphScriptToOpenRouterPrompt(
  script: VideoGraphScript,
): string {
  const entityLines = script.entities.map((entity) => {
    const attrs = entity.attributes
      ? Object.entries(entity.attributes)
          .map(([key, value]) => `${key}=${String(value)}`)
          .join(', ')
      : '';
    return `- ${entity.id} (${entity.kind}): ${entity.label}${attrs ? ` [${attrs}]` : ''}`;
  });

  const actionLines = script.actions.map(
    (action) =>
      `- ${action.startSecond.toFixed(2)}s-${action.endSecond.toFixed(2)}s: ${action.actorId} ${action.verb}${action.targetId ? ` ${action.targetId}` : ''}${action.intent ? ` (${action.intent})` : ''}`,
  );

  const constraintLines = script.constraints.map(
    (constraint) => `- [${constraint.severity}] ${constraint.rule}`,
  );

  return [
    `Project: ${script.title}`,
    `Brief: ${script.brief}`,
    '',
    'Scene Graph Entities:',
    ...entityLines,
    '',
    `Camera: shot=${script.camera.shot}, movement=${script.camera.movement}, lens=${script.camera.lens || 'default'}, framing=${script.camera.framing || 'standard'}`,
    `Style: palette=${script.style.palette.join(', ')}, lighting=${script.style.lighting}, grade=${script.style.grade}, texture=${script.style.texture || 'clean'}`,
    `Timing: duration=${script.timing.durationSeconds}s, fps=${script.timing.fps}`,
    '',
    'Action Timeline:',
    ...actionLines,
    '',
    `Audio: voiceover=${script.audio.voiceover || 'none'}; music=${script.audio.musicCue || 'none'}; sfx=${script.audio.sfx.join(', ') || 'none'}`,
    '',
    'Hard/Soft Constraints:',
    ...constraintLines,
    '',
    'Output request: produce a coherent video generation prompt sequence consistent with the timeline, camera, and style.',
  ].join('\n');
}

export function compileVideoGraphScriptToPeepshowRubric(
  script: VideoGraphScript,
): VideoGraphPeepshowRubric {
  return {
    scriptId: script.id,
    checks: script.reviewCriteria.map((criterion) => ({
      id: criterion.id,
      label: criterion.label,
      check: criterion.check,
      weight: criterion.weight,
    })),
  };
}

export function compileVideoGraphScriptToRemotionProps(
  script: VideoGraphScript,
): VideoGraphRemotionProps {
  const durationInFrames = Math.max(
    1,
    Math.round(script.timing.durationSeconds * script.timing.fps),
  );

  return {
    compositionId: `liquidaity-${script.id}`,
    title: script.title,
    durationInFrames,
    fps: script.timing.fps,
    palette: [...script.style.palette],
    lighting: script.style.lighting,
    actions: script.actions.map((action) => ({
      id: action.id,
      actorId: action.actorId,
      targetId: action.targetId,
      startFrame: clampToFrame(action.startSecond, script.timing.fps, durationInFrames),
      endFrame: clampToFrame(action.endSecond, script.timing.fps, durationInFrames),
      verb: action.verb,
      intent: action.intent,
    })),
    beats: script.timing.beats.map((beat) => ({ ...beat })),
    voiceover: script.audio.voiceover,
    musicCue: script.audio.musicCue,
  };
}
