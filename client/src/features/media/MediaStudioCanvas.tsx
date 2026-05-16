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
  KoolPhaseComfortRailInternalSceneGraph,
  KoolSkoolsCurrentCoolerSceneGraph,
  compileSceneGraphToCanvasLensHints,
  compileSceneGraphToDiffusionPrompt,
  compileSceneGraphToPeepshowChecklist,
  compileSceneGraphToRemotionPlan,
  compileSceneGraphToSeedFramePlan,
  compileSceneGraphToSimulationProxyPlan,
  compileSceneGraphToSvgOverlayPlan,
  compileSceneGraphToThreeBlockoutPlan,
  type SceneGraphSource,
} from './sceneGraphSource';

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

const SCENE_LIBRARY: readonly SceneGraphSource[] = [
  KoolSkoolsCurrentCoolerSceneGraph,
  KoolPhaseComfortRailInternalSceneGraph,
] as const;

export default function MediaStudioCanvas(): React.ReactElement {
  const activeScene = KoolSkoolsCurrentCoolerSceneGraph;
  const diffusionPromptPreview = compileSceneGraphToDiffusionPrompt(activeScene);
  const peepshowChecklistPreview = compileSceneGraphToPeepshowChecklist(activeScene);
  const remotionPlanPreview = compileSceneGraphToRemotionPlan(activeScene);
  const threeBlockoutPlanPreview = compileSceneGraphToThreeBlockoutPlan(activeScene);
  const svgOverlayPlanPreview = compileSceneGraphToSvgOverlayPlan(activeScene);
  const seedFramePlanPreview = compileSceneGraphToSeedFramePlan(activeScene);
  const simulationProxyPlanPreview = compileSceneGraphToSimulationProxyPlan(activeScene);
  const lensHintsPreview = compileSceneGraphToCanvasLensHints(activeScene);

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

      <StudioPanel
        title="SceneGraph Source"
        subtitle="Canonical scene truth. Canvases are lenses; prompts are compiled outputs."
      >
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 13 }}>
            Active scene: <strong>{activeScene.name}</strong>
          </div>
          <div style={{ fontSize: 12, color: GRAPH_THEME.drawer.inputMuted }}>
            Claim level: {activeScene.claimLevel} · Products {activeScene.products.length} · Flow paths {activeScene.flowPaths.length} · Cameras {activeScene.cameras.length}
          </div>
          <div style={{ fontSize: 12, color: GRAPH_THEME.drawer.inputMuted }}>
            Output targets: {activeScene.outputTargets.join(', ')}
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            {SCENE_LIBRARY.map((scene) => (
              <div
                key={scene.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 8,
                  fontSize: 12,
                  color:
                    scene.id === activeScene.id
                      ? GRAPH_THEME.drawer.inputText
                      : GRAPH_THEME.drawer.inputMuted,
                }}
              >
                <span>{scene.name}</span>
                <span>{scene.claimLevel}</span>
              </div>
            ))}
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
          subtitle="Prompt is compiled from SceneGraph Source; backend submit/poll route is the next runtime slice."
        >
          <div
            style={{
              border: `1px solid ${GRAPH_THEME.drawer.inputBorder}`,
              borderRadius: 8,
              padding: 10,
              fontSize: 11,
              lineHeight: 1.45,
              color: GRAPH_THEME.drawer.inputMuted,
              maxHeight: 128,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
            }}
          >
            {diffusionPromptPreview}
          </div>
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
          title="SceneGraph Compilers"
          subtitle="Deterministic planners: scene graph -> overlay/blockout/seed/diffusion/review/remotion/simulation/lens hints."
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
            {JSON.stringify(
              {
                threeBlockout: threeBlockoutPlanPreview,
                svgOverlay: svgOverlayPlanPreview,
                seedFrames: seedFramePlanPreview,
              },
              null,
              2,
            )}
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
            {JSON.stringify(
              {
                peepshowChecklist: peepshowChecklistPreview,
                remotionPlan: remotionPlanPreview,
              },
              null,
              2,
            )}
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
            {JSON.stringify(
              {
                simulationProxy: simulationProxyPlanPreview,
                lensHints: lensHintsPreview,
              },
              null,
              2,
            )}
          </div>
        </StudioPanel>
      </div>
    </div>
  );
}
