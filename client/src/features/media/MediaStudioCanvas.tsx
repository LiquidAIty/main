import React from 'react';
import {
  GRAPH_THEME,
  graphDrawerSectionStyle,
} from '../../components/graph/graphVisualTokens';
import type {
  MediaAnalysisManifest,
  MediaAsset,
  MediaGenerationJob,
  MediaPrompt,
  MediaRenderJob,
  MediaStyleToken,
} from './mediaStudioTypes';
import {
  compileVideoGraphScriptToOpenRouterPrompt,
  compileVideoGraphScriptToPeepshowRubric,
  compileVideoGraphScriptToRemotionProps,
  type VideoGraphScript,
} from './videoGraphScript';

type StudioPanelProps = {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
};

function StudioPanel({ title, subtitle, children }: StudioPanelProps): React.ReactElement {
  return (
    <section
      style={graphDrawerSectionStyle({
        padding: '14px 16px',
        display: 'grid',
        gap: 10,
      })}
    >
      <header style={{ display: 'grid', gap: 4 }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: 0.25,
            color: GRAPH_THEME.drawer.inputText,
          }}
        >
          {title}
        </div>
        {subtitle ? (
          <div
            style={{
              fontSize: 12,
              lineHeight: 1.45,
              color: GRAPH_THEME.drawer.inputMuted,
            }}
          >
            {subtitle}
          </div>
        ) : null}
      </header>
      {children}
    </section>
  );
}

function Dot({ color }: { color: string }): React.ReactElement {
  return (
    <span
      aria-hidden
      style={{
        width: 8,
        height: 8,
        borderRadius: 999,
        display: 'inline-block',
        background: color,
      }}
    />
  );
}

const SAMPLE_PROMPT: MediaPrompt = {
  id: 'prompt_a',
  text: 'Sunset city rooftop sequence, cinematic lens, slow camera drift.',
  negativePrompt: 'logo watermarks, extra limbs, text overlays',
  ratio: '16:9',
  durationSeconds: 8,
  updatedAt: 'draft',
};

const SAMPLE_STYLE_TOKENS: MediaStyleToken[] = [
  { id: 'style_grain', label: 'Film grain', value: 'subtle grain', strength: 0.4 },
  { id: 'style_grade', label: 'Teal/orange', value: 'teal orange grade', strength: 0.65 },
  { id: 'style_camera', label: 'Anamorphic', value: 'anamorphic flare', strength: 0.55 },
];

const SAMPLE_ASSETS: MediaAsset[] = [
  {
    id: 'asset_ref_1',
    kind: 'image',
    label: 'Rooftop style board',
    source: 'manual',
    status: 'ready',
    createdAt: 'now',
  },
  {
    id: 'asset_clip_1',
    kind: 'video',
    label: 'Clip candidate A',
    source: 'openrouter',
    status: 'draft',
    createdAt: 'pending',
  },
];

const SAMPLE_GENERATION_JOBS: MediaGenerationJob[] = [
  {
    id: 'job_openrouter_video_1',
    provider: 'openrouter',
    status: 'queued',
    promptId: SAMPLE_PROMPT.id,
    inputAssetIds: ['asset_ref_1'],
    outputAssetIds: [],
    createdAt: 'pending',
    updatedAt: 'pending',
  },
];

const SAMPLE_MANIFEST: MediaAnalysisManifest = {
  id: 'manifest_peepshow_1',
  assetId: 'asset_clip_1',
  provider: 'peepshow',
  summary: 'Awaiting first clip; manifest/report files will populate after analysis run.',
  tags: ['faces', 'cuts', 'safety-check'],
  createdAt: 'pending',
};

const SAMPLE_RENDER_JOB: MediaRenderJob = {
  id: 'render_remotion_1',
  provider: 'remotion',
  status: 'draft',
  sourceAssetIds: ['asset_clip_1'],
  compositionName: 'hero-cut-v1',
  createdAt: 'pending',
  updatedAt: 'pending',
};

const SAMPLE_VIDEO_GRAPH_SCRIPT: VideoGraphScript = {
  id: 'launch_teaser_v1',
  title: 'LiquidAIty Launch Teaser',
  brief: 'Show a rooftop story beat that transitions into product confidence and CTA.',
  entities: [
    { id: 'char_host', kind: 'character', label: 'Host silhouette' },
    {
      id: 'loc_rooftop',
      kind: 'location',
      label: 'City rooftop at sunset',
      attributes: { weather: 'clear', mood: 'cinematic' },
    },
    { id: 'obj_holo', kind: 'object', label: 'Floating graph UI panel' },
    { id: 'brand_logo', kind: 'brand', label: 'LiquidAIty logo lockup' },
  ],
  relationships: [
    { id: 'rel_1', sourceId: 'loc_rooftop', targetId: 'char_host', relation: 'contains' },
    { id: 'rel_2', sourceId: 'char_host', targetId: 'obj_holo', relation: 'interacts_with' },
    { id: 'rel_3', sourceId: 'obj_holo', targetId: 'brand_logo', relation: 'transitions_to' },
  ],
  actions: [
    {
      id: 'act_1',
      actorId: 'char_host',
      verb: 'faces',
      targetId: 'loc_rooftop',
      startSecond: 0,
      endSecond: 2.8,
      intent: 'establish scene',
    },
    {
      id: 'act_2',
      actorId: 'char_host',
      verb: 'gestures toward',
      targetId: 'obj_holo',
      startSecond: 2.8,
      endSecond: 5.4,
      intent: 'activate product proof',
    },
    {
      id: 'act_3',
      actorId: 'obj_holo',
      verb: 'resolves into',
      targetId: 'brand_logo',
      startSecond: 5.4,
      endSecond: 8,
      intent: 'close with CTA',
    },
  ],
  camera: {
    shot: 'medium',
    movement: 'dolly',
    lens: '35mm',
    framing: 'rule of thirds, right-weighted subject',
  },
  style: {
    palette: ['#f7934a', '#0f172a', '#37adaa'],
    lighting: 'sunset rim light',
    grade: 'teal-orange',
    texture: 'subtle grain',
  },
  timing: {
    durationSeconds: 8,
    fps: 30,
    beats: [
      { label: 'establish', second: 0.5 },
      { label: 'product reveal', second: 3.6 },
      { label: 'brand lockup', second: 6.5 },
    ],
  },
  audio: {
    voiceover: 'One graph. One runtime. One truth surface.',
    musicCue: 'hybrid pulse rising',
    sfx: ['soft whoosh', 'ui confirm tick'],
  },
  constraints: [
    { id: 'c_1', rule: 'No visible watermark text', severity: 'hard' },
    { id: 'c_2', rule: 'Keep host silhouette readable against skyline', severity: 'soft' },
  ],
  reviewCriteria: [
    { id: 'r_1', label: 'Brand legibility', check: 'Logo readable for at least 1.2s', weight: 0.35 },
    { id: 'r_2', label: 'Story continuity', check: 'No abrupt jump cuts across major beat boundaries', weight: 0.4 },
    { id: 'r_3', label: 'Audio sync', check: 'Gesture beat aligns with UI reveal within 6 frames', weight: 0.25 },
  ],
};

export default function MediaStudioCanvas(): React.ReactElement {
  const openRouterPromptPreview = compileVideoGraphScriptToOpenRouterPrompt(
    SAMPLE_VIDEO_GRAPH_SCRIPT,
  );
  const peepshowRubricPreview = compileVideoGraphScriptToPeepshowRubric(
    SAMPLE_VIDEO_GRAPH_SCRIPT,
  );
  const remotionPropsPreview = compileVideoGraphScriptToRemotionProps(
    SAMPLE_VIDEO_GRAPH_SCRIPT,
  );

  return (
    <div
      data-testid="video-workspace-placeholder"
      style={{
        height: '100%',
        padding: 16,
        background: GRAPH_THEME.background.knowledgeSurface,
        color: GRAPH_THEME.drawer.inputText,
        display: 'grid',
        gap: 12,
        overflow: 'auto',
        alignContent: 'start',
      }}
    >
      <StudioPanel
        title="Media Studio"
        subtitle="Video Agent workbench shell. Prompt and assets stay app-owned; backend bridges are staged."
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto',
            gap: 10,
            alignItems: 'center',
          }}
        >
          <div style={{ fontSize: 13, color: GRAPH_THEME.drawer.inputMuted }}>
            Project brief: launch teaser clip, 8s, rooftop sequence, CTA ending.
          </div>
          <div
            style={{
              border: `1px solid ${GRAPH_THEME.accent.solar}`,
              borderRadius: 999,
              padding: '4px 8px',
              fontSize: 11,
              color: GRAPH_THEME.accent.solar,
            }}
          >
            staged runtime
          </div>
        </div>
      </StudioPanel>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(280px, 1fr) minmax(280px, 1fr)',
          gap: 12,
        }}
      >
        <StudioPanel title="Prompt" subtitle="Core shot intent and constraints.">
          <div style={{ fontSize: 13, lineHeight: 1.5 }}>{SAMPLE_PROMPT.text}</div>
          <div style={{ fontSize: 12, color: GRAPH_THEME.drawer.inputMuted }}>
            Negative: {SAMPLE_PROMPT.negativePrompt}
          </div>
          <div style={{ fontSize: 12, color: GRAPH_THEME.drawer.inputMuted }}>
            Ratio {SAMPLE_PROMPT.ratio} · Duration {SAMPLE_PROMPT.durationSeconds}s
          </div>
        </StudioPanel>

        <StudioPanel
          title="Image / Style Seed"
          subtitle="Reference media + style tokens for prompt-to-image and image-to-video."
        >
          <div style={{ display: 'grid', gap: 8 }}>
            {SAMPLE_STYLE_TOKENS.map((token) => (
              <div
                key={token.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 8,
                  fontSize: 12,
                }}
              >
                <span>{token.label}</span>
                <span style={{ color: GRAPH_THEME.drawer.inputMuted }}>
                  {Math.round((token.strength || 0) * 100)}%
                </span>
              </div>
            ))}
          </div>
        </StudioPanel>

        <StudioPanel
          title="OpenRouter Video Generation"
          subtitle="Submit/poll wiring is deferred to backend route integration."
        >
          {SAMPLE_GENERATION_JOBS.map((job) => (
            <div
              key={job.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: 12,
              }}
            >
              <span>{job.id}</span>
              <span style={{ color: GRAPH_THEME.drawer.inputMuted }}>{job.status}</span>
            </div>
          ))}
        </StudioPanel>

        <StudioPanel
          title="Peepshow Analysis"
          subtitle="Expected flow: video path -> peepshow CLI -> manifest/report -> review."
        >
          <div style={{ fontSize: 12, lineHeight: 1.5 }}>{SAMPLE_MANIFEST.summary}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {SAMPLE_MANIFEST.tags.map((tag) => (
              <span
                key={tag}
                style={{
                  fontSize: 11,
                  padding: '2px 7px',
                  borderRadius: 999,
                  border: `1px solid ${GRAPH_THEME.drawer.inputBorder}`,
                  color: GRAPH_THEME.drawer.inputMuted,
                }}
              >
                {tag}
              </span>
            ))}
          </div>
        </StudioPanel>

        <StudioPanel
          title="Remotion Assembly / Export"
          subtitle="Composition and export controls are placeholders in this pass."
        >
          <div style={{ fontSize: 12, color: GRAPH_THEME.drawer.inputMuted }}>
            Composition: {SAMPLE_RENDER_JOB.compositionName}
          </div>
          <div style={{ fontSize: 12, color: GRAPH_THEME.drawer.inputMuted }}>
            Render status: {SAMPLE_RENDER_JOB.status}
          </div>
        </StudioPanel>

        <StudioPanel title="Assets / Jobs" subtitle="Project media memory scaffold.">
          <div style={{ display: 'grid', gap: 8 }}>
            {SAMPLE_ASSETS.map((asset) => (
              <div
                key={asset.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  fontSize: 12,
                }}
              >
                <span>{asset.label}</span>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    color: GRAPH_THEME.drawer.inputMuted,
                  }}
                >
                  <Dot
                    color={
                      asset.status === 'ready'
                        ? GRAPH_THEME.accent.primary
                        : asset.status === 'error'
                          ? '#D98458'
                          : GRAPH_THEME.accent.solar
                    }
                  />
                  {asset.kind}
                </span>
              </div>
            ))}
          </div>
        </StudioPanel>

        <StudioPanel
          title="VideoGraphScript"
          subtitle="Compiler stubs: graph script -> OpenRouter prompt / Peepshow rubric / Remotion props."
        >
          <div
            style={{
              border: `1px solid ${GRAPH_THEME.drawer.inputBorder}`,
              borderRadius: 8,
              padding: 10,
              fontSize: 11,
              lineHeight: 1.45,
              color: GRAPH_THEME.drawer.inputMuted,
              maxHeight: 188,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
            }}
          >
            {openRouterPromptPreview}
          </div>
          <div
            style={{
              border: `1px solid ${GRAPH_THEME.drawer.inputBorder}`,
              borderRadius: 8,
              padding: 10,
              fontSize: 11,
              lineHeight: 1.45,
              color: GRAPH_THEME.drawer.inputMuted,
              maxHeight: 150,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
            }}
          >
            {JSON.stringify(peepshowRubricPreview, null, 2)}
          </div>
          <div
            style={{
              border: `1px solid ${GRAPH_THEME.drawer.inputBorder}`,
              borderRadius: 8,
              padding: 10,
              fontSize: 11,
              lineHeight: 1.45,
              color: GRAPH_THEME.drawer.inputMuted,
              maxHeight: 150,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
            }}
          >
            {JSON.stringify(remotionPropsPreview, null, 2)}
          </div>
        </StudioPanel>
      </div>
    </div>
  );
}
