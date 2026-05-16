import React from 'react';
import {
  GRAPH_THEME,
  graphDrawerSectionStyle,
} from '../../components/graph/graphVisualTokens';
import type {
  MediaAnalysisManifest,
  MediaAsset,
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

type MediaStudioCanvasProps = {
  projectId?: string | null;
};

type MediaVideoJobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

type MediaVideoJobView = {
  id: string;
  status: MediaVideoJobStatus;
  providerJobId: string | null;
  model: string;
  resultUrls: string[];
  errorMessage: string | null;
  updatedAt: string;
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

export default function MediaStudioCanvas({
  projectId = null,
}: MediaStudioCanvasProps): React.ReactElement {
  const activeScene = KoolSkoolsCurrentCoolerSceneGraph;
  const diffusionPromptPreview = compileSceneGraphToDiffusionPrompt(activeScene);
  const peepshowChecklistPreview = compileSceneGraphToPeepshowChecklist(activeScene);
  const remotionPlanPreview = compileSceneGraphToRemotionPlan(activeScene);
  const threeBlockoutPlanPreview = compileSceneGraphToThreeBlockoutPlan(activeScene);
  const svgOverlayPlanPreview = compileSceneGraphToSvgOverlayPlan(activeScene);
  const seedFramePlanPreview = compileSceneGraphToSeedFramePlan(activeScene);
  const simulationProxyPlanPreview = compileSceneGraphToSimulationProxyPlan(activeScene);
  const lensHintsPreview = compileSceneGraphToCanvasLensHints(activeScene);
  const [submitPrompt, setSubmitPrompt] = React.useState(diffusionPromptPreview);
  const [submitModel, setSubmitModel] = React.useState('google/veo-3');
  const [submitAspectRatio, setSubmitAspectRatio] = React.useState<string>(
    SAMPLE_PROMPT.ratio || '16:9',
  );
  const [submitDurationSec, setSubmitDurationSec] = React.useState(
    String(SAMPLE_PROMPT.durationSeconds || 8),
  );
  const [submitReferenceImageUrls, setSubmitReferenceImageUrls] = React.useState('');
  const [submitBusy, setSubmitBusy] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [jobView, setJobView] = React.useState<MediaVideoJobView | null>(null);
  const [lastResponseNote, setLastResponseNote] = React.useState<string | null>(null);

  const parsedReferenceUrls = React.useMemo(
    () =>
      submitReferenceImageUrls
        .split('\n')
        .map((value) => value.trim())
        .filter(Boolean),
    [submitReferenceImageUrls],
  );

  const isJobTerminal = jobView?.status === 'succeeded' || jobView?.status === 'failed';

  React.useEffect(() => {
    setSubmitPrompt(diffusionPromptPreview);
  }, [diffusionPromptPreview]);

  React.useEffect(() => {
    if (!projectId || !jobView || isJobTerminal) return;

    const interval = window.setInterval(() => {
      void (async () => {
        try {
          const response = await fetch(
            `/api/v3/projects/${encodeURIComponent(projectId)}/media/video/jobs/${encodeURIComponent(jobView.id)}`,
          );
          const payload = (await response.json().catch(() => null)) as
            | { ok?: boolean; job?: MediaVideoJobView; error?: string; message?: string }
            | null;
          if (!response.ok || !payload?.ok || !payload.job) {
            setSubmitError(
              payload?.message || payload?.error || `video_job_poll_failed_http_${response.status}`,
            );
            return;
          }
          setJobView(payload.job);
          setLastResponseNote(`Last poll ${new Date().toLocaleTimeString()}`);
        } catch (error) {
          setSubmitError(
            error instanceof Error ? error.message : 'video_job_poll_failed',
          );
        }
      })();
    }, 3000);

    return () => window.clearInterval(interval);
  }, [projectId, jobView, isJobTerminal]);

  async function submitVideoJob() {
    if (!projectId) {
      setSubmitError('Project is required before submitting a media job.');
      return;
    }
    setSubmitBusy(true);
    setSubmitError(null);
    setLastResponseNote(null);
    try {
      const durationSecRaw = Number.parseInt(submitDurationSec, 10);
      const durationSec =
        Number.isFinite(durationSecRaw) && durationSecRaw > 0 ? durationSecRaw : undefined;
      const response = await fetch(
        `/api/v3/projects/${encodeURIComponent(projectId)}/media/video/jobs`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: submitPrompt,
            model: submitModel,
            aspectRatio: submitAspectRatio,
            durationSec,
            sourceSceneId: activeScene.id,
            sourceVideoGraphId: null,
            referenceImageUrls: parsedReferenceUrls,
          }),
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            job?: MediaVideoJobView;
            error?: string;
            message?: string;
            providerMessage?: string;
          }
        | null;
      if (!response.ok || !payload?.ok || !payload.job) {
        setSubmitError(
          payload?.message ||
            payload?.providerMessage ||
            payload?.error ||
            `video_job_submit_failed_http_${response.status}`,
        );
        return;
      }
      setJobView(payload.job);
      setLastResponseNote('Submitted to backend OpenRouter route.');
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'video_job_submit_failed');
    } finally {
      setSubmitBusy(false);
    }
  }

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
          <div style={{ display: 'grid', gap: 8 }}>
            <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
              <span style={{ color: GRAPH_THEME.drawer.inputMuted }}>Model</span>
              <input
                value={submitModel}
                onChange={(event) => setSubmitModel(event.target.value)}
                style={{
                  background: GRAPH_THEME.drawer.inputBackground,
                  color: GRAPH_THEME.drawer.inputText,
                  border: `1px solid ${GRAPH_THEME.drawer.inputBorder}`,
                  borderRadius: 8,
                  padding: '8px 10px',
                  fontSize: 12,
                }}
              />
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                <span style={{ color: GRAPH_THEME.drawer.inputMuted }}>Aspect</span>
                <input
                  value={submitAspectRatio}
                  onChange={(event) => setSubmitAspectRatio(event.target.value)}
                  style={{
                    background: GRAPH_THEME.drawer.inputBackground,
                    color: GRAPH_THEME.drawer.inputText,
                    border: `1px solid ${GRAPH_THEME.drawer.inputBorder}`,
                    borderRadius: 8,
                    padding: '8px 10px',
                    fontSize: 12,
                  }}
                />
              </label>
              <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                <span style={{ color: GRAPH_THEME.drawer.inputMuted }}>Duration (sec)</span>
                <input
                  value={submitDurationSec}
                  onChange={(event) => setSubmitDurationSec(event.target.value)}
                  style={{
                    background: GRAPH_THEME.drawer.inputBackground,
                    color: GRAPH_THEME.drawer.inputText,
                    border: `1px solid ${GRAPH_THEME.drawer.inputBorder}`,
                    borderRadius: 8,
                    padding: '8px 10px',
                    fontSize: 12,
                  }}
                />
              </label>
            </div>
            <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
              <span style={{ color: GRAPH_THEME.drawer.inputMuted }}>
                Reference image URLs (optional, one per line)
              </span>
              <textarea
                value={submitReferenceImageUrls}
                onChange={(event) => setSubmitReferenceImageUrls(event.target.value)}
                rows={2}
                style={{
                  background: GRAPH_THEME.drawer.inputBackground,
                  color: GRAPH_THEME.drawer.inputText,
                  border: `1px solid ${GRAPH_THEME.drawer.inputBorder}`,
                  borderRadius: 8,
                  padding: '8px 10px',
                  fontSize: 12,
                  resize: 'vertical',
                }}
              />
            </label>
          </div>
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
            <textarea
              value={submitPrompt}
              onChange={(event) => setSubmitPrompt(event.target.value)}
              rows={8}
              style={{
                width: '100%',
                background: 'transparent',
                color: GRAPH_THEME.drawer.inputMuted,
                border: 'none',
                outline: 'none',
                fontSize: 11,
                lineHeight: 1.45,
                resize: 'vertical',
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => {
                void submitVideoJob();
              }}
              disabled={!projectId || submitBusy}
              style={{
                border: `1px solid ${GRAPH_THEME.accent.solar}`,
                color: GRAPH_THEME.accent.solar,
                background: 'transparent',
                borderRadius: 8,
                fontSize: 12,
                padding: '7px 10px',
                cursor: !projectId || submitBusy ? 'not-allowed' : 'pointer',
                opacity: !projectId || submitBusy ? 0.7 : 1,
              }}
            >
              {submitBusy ? 'Submitting...' : 'Submit Video Job'}
            </button>
            <span style={{ fontSize: 11, color: GRAPH_THEME.drawer.inputMuted }}>
              {!projectId
                ? 'Select a project to enable submit.'
                : lastResponseNote || 'Backend-owned route; key remains server-side.'}
            </span>
          </div>
          {jobView ? (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: 12,
              }}
            >
              <span>{jobView.id}</span>
              <span style={{ color: GRAPH_THEME.drawer.inputMuted }}>{jobView.status}</span>
            </div>
          ) : null}
          {jobView?.providerJobId ? (
            <div style={{ fontSize: 11, color: GRAPH_THEME.drawer.inputMuted }}>
              Provider job: {jobView.providerJobId}
            </div>
          ) : null}
          {jobView?.resultUrls?.length ? (
            <div style={{ display: 'grid', gap: 4 }}>
              {jobView.resultUrls.map((url) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 11, color: GRAPH_THEME.accent.primary }}
                >
                  {url}
                </a>
              ))}
            </div>
          ) : null}
          {submitError || jobView?.errorMessage ? (
            <div style={{ fontSize: 11, color: '#D98458' }}>
              {submitError || jobView?.errorMessage}
            </div>
          ) : null}
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
