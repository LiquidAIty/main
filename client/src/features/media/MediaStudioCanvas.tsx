import React from 'react';
import {
  GRAPH_THEME,
  graphDrawerSectionStyle,
} from '../../components/graph/graphVisualTokens';
import SceneGraphThreeBlockout from './SceneGraphThreeBlockout';
import { buildCanvasObjectContext } from './objectAwareCanvasContext';
import {
  KoolSkoolsSceneAssetRegistry,
  resolveSceneAssetsForSceneGraph,
} from './sceneAssetRegistry';
import {
  KoolSkoolsProgressiveVideoCascade,
  compileFinalGenerationPacketToOpenRouterPayload,
  compilePeepshowReviewToCorrectionPacket,
  compileSceneGraphShotToScoutPayload,
  scoreGenerationReviewAgainstNonNegotiables,
  type GenerationReviewResult,
} from './modelCascadePlan';
import {
  compileGenerationPacketToOpenRouterPayload,
  compileImageFrameToGenerationPacket,
  compileSceneGraphShotToGenerationPacket,
  compileSimulationFrameToGenerationPacket,
  compileVideoClipToGenerationPacket,
  type GenerationPacket,
  type GenerationPacketSourceType,
} from './generationPacket';
import type {
  MediaAnalysisManifest,
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
import { compileSceneGraphToMotionPlan } from './sceneGraphMotionPlan';

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
  sourceSceneId: string | null;
  sourceShotId: string | null;
  generationPacketId: string | null;
  sourceType:
    | 'threeScene'
    | 'imageFrame'
    | 'videoClip'
    | 'simulationFrame'
    | 'generatedStill'
    | 'scoutResult'
    | null;
  fps: number | null;
  promptBetweenFrames: string | null;
  narration: {
    text: string | null;
    voice: string | null;
  } | null;
  outputTargets: string[];
  lineageSummary: string | null;
  startFrame: number | null;
  endFrame: number | null;
  durationFrames: number | null;
  cameraIntent: string | null;
  motionInstruction: string | null;
  diffusionInstruction: string | null;
  lockedNonNegotiables: string[];
  cascadeId: string | null;
  cascadeStage: 'scout' | 'finisher' | null;
  parentJobId: string | null;
  correctionPacket: {
    preservedWins: string[];
    requiredFixes: string[];
    summary: string | null;
  } | null;
  resultUrls: string[];
  resultPayload?: unknown;
  errorMessage: string | null;
  updatedAt: string;
};

type OpenRouterPanelState =
  | 'idle'
  | 'submitting'
  | 'running'
  | 'succeeded'
  | 'failed';

type BlockoutGuardProps = {
  children: React.ReactNode;
};

type BlockoutGuardState = {
  hasError: boolean;
  message: string;
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

class BlockoutGuard extends React.Component<BlockoutGuardProps, BlockoutGuardState> {
  state: BlockoutGuardState = {
    hasError: false,
    message: '',
  };

  static getDerivedStateFromError(error: unknown): BlockoutGuardState {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : '3d_runtime_dependency_or_webgl_missing',
    };
  }

  componentDidCatch(): void {}

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div
          style={{
            border: `1px solid ${GRAPH_THEME.drawer.inputBorder}`,
            borderRadius: 10,
            padding: 10,
            fontSize: 12,
            color: '#D98458',
          }}
        >
          3D preview unavailable: {this.state.message}
        </div>
      );
    }
    return this.props.children;
  }
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
  const motionPlanPreview = compileSceneGraphToMotionPlan(activeScene);
  const sceneAssetRegistryPreview = KoolSkoolsSceneAssetRegistry;
  const resolvedSceneAssetsPreview = React.useMemo(
    () =>
      resolveSceneAssetsForSceneGraph(
        activeScene,
        sceneAssetRegistryPreview,
        'warnAndPrimitive',
      ),
    [activeScene, sceneAssetRegistryPreview],
  );
  const objectAwareContextPreview = buildCanvasObjectContext(
    activeScene,
    'video',
    resolvedSceneAssetsPreview,
  );
  const cascadePlan = KoolSkoolsProgressiveVideoCascade;
  const [selectedShotId, setSelectedShotId] = React.useState(
    motionPlanPreview.shots[0]?.shotId ?? '',
  );
  const [submitPrompt, setSubmitPrompt] = React.useState(diffusionPromptPreview);
  const [submitModel, setSubmitModel] = React.useState('google/veo-3');
  const [submitAspectRatio, setSubmitAspectRatio] = React.useState<string>(
    SAMPLE_PROMPT.ratio || '16:9',
  );
  const [submitDurationSec, setSubmitDurationSec] = React.useState(
    String(SAMPLE_PROMPT.durationSeconds || 8),
  );
  const [submitReferenceImageUrls, setSubmitReferenceImageUrls] = React.useState('');
  const [shotBuilderSourceType, setShotBuilderSourceType] =
    React.useState<GenerationPacketSourceType>('threeScene');
  const [shotBuilderImageUrl, setShotBuilderImageUrl] = React.useState('');
  const [shotBuilderVideoUrl, setShotBuilderVideoUrl] = React.useState('');
  const [shotBuilderSimulationRef, setShotBuilderSimulationRef] = React.useState('');
  const [shotBuilderPrompt, setShotBuilderPrompt] = React.useState(
    'Preserve geometry and airflow while improving cinematic quality between frames.',
  );
  const [shotBuilderNarration, setShotBuilderNarration] = React.useState(
    'Concept visual: classroom comfort airflow sequence.',
  );
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
  const panelState: OpenRouterPanelState = React.useMemo(() => {
    if (submitBusy) return 'submitting';
    if (!jobView) return 'idle';
    if (jobView.status === 'succeeded') return 'succeeded';
    if (jobView.status === 'failed') return 'failed';
    return 'running';
  }, [submitBusy, jobView]);

  const selectedShot = React.useMemo(
    () => motionPlanPreview.shots.find((shot) => shot.shotId === selectedShotId) ?? null,
    [motionPlanPreview.shots, selectedShotId],
  );
  const scoutPacketPreview = React.useMemo(() => {
    if (!selectedShot) return null;
    return compileSceneGraphShotToScoutPayload(activeScene, selectedShot, cascadePlan);
  }, [activeScene, selectedShot, cascadePlan]);
  const sampleScoutReview = React.useMemo<GenerationReviewResult | null>(() => {
    if (!scoutPacketPreview) return null;
    return {
      runId: 'scout-review-demo',
      peepshowReportReference: 'peepshow://manifest/scout-review-demo',
      overallScore: 0.84,
      preservedWins: ['Airflow direction held', 'Product silhouette preserved'],
      requiredFixes: ['Strengthen side cutaway labels', 'Reduce motion blur near vent lip'],
      nonNegotiableViolations: [],
      ruleScores: cascadePlan.scoringRules.map((rule) => ({
        ruleId: rule.id,
        score: 0.84,
        passed: 0.84 >= rule.minPassScore,
      })),
    };
  }, [scoutPacketPreview, cascadePlan.scoringRules]);
  const correctionPacketPreview = React.useMemo(() => {
    if (!sampleScoutReview || !selectedShot) return null;
    return compilePeepshowReviewToCorrectionPacket(
      sampleScoutReview,
      selectedShot.lockedNonNegotiables,
    );
  }, [sampleScoutReview, selectedShot]);
  const cascadeScoutScore = React.useMemo(
    () => (sampleScoutReview ? scoreGenerationReviewAgainstNonNegotiables(sampleScoutReview) : 0),
    [sampleScoutReview],
  );
  const cascadeNextAction = React.useMemo(() => {
    if (!selectedShot) return 'Select a shot.';
    if (!sampleScoutReview) return 'Submit scout job.';
    if (sampleScoutReview.nonNegotiableViolations.length > 0) {
      return 'Fix non-negotiables and rerun scout.';
    }
    if (sampleScoutReview.overallScore >= cascadePlan.promotionRule.minOverallScore) {
      return 'Promote to finisher job.';
    }
    return 'Apply correction packet and rerun scout.';
  }, [selectedShot, sampleScoutReview, cascadePlan.promotionRule.minOverallScore]);
  const shotBuilderPacket = React.useMemo<GenerationPacket | null>(() => {
    if (!selectedShot) return null;
    if (shotBuilderSourceType === 'threeScene') {
      const packet = compileSceneGraphShotToGenerationPacket(activeScene, selectedShot);
      return {
        ...packet,
        promptBetweenFrames: { ...packet.promptBetweenFrames, main: shotBuilderPrompt },
        narration: { text: shotBuilderNarration },
      };
    }
    if (shotBuilderSourceType === 'imageFrame' || shotBuilderSourceType === 'generatedStill') {
      const imageUrl = shotBuilderImageUrl.trim() || 'https://example.invalid/image-seed.png';
      return {
        ...compileImageFrameToGenerationPacket({
          packetId: `packet_${activeScene.id}_${selectedShot.shotId}_${shotBuilderSourceType}`,
          sceneId: activeScene.id,
          shotId: selectedShot.shotId,
          imageUrl,
          fps: 30,
          durationSec: Math.max(1, selectedShot.durationFrames / 30),
          prompt: shotBuilderPrompt,
          narration: shotBuilderNarration,
          lockedNonNegotiables: selectedShot.lockedNonNegotiables,
        }),
        sourceType: shotBuilderSourceType,
      };
    }
    if (shotBuilderSourceType === 'videoClip') {
      const videoUrl = shotBuilderVideoUrl.trim() || 'https://example.invalid/video-source.mp4';
      return compileVideoClipToGenerationPacket({
        packetId: `packet_${activeScene.id}_${selectedShot.shotId}_video`,
        sceneId: activeScene.id,
        shotId: selectedShot.shotId,
        videoUrl,
        fps: 30,
        startFrame: selectedShot.startFrame,
        endFrame: selectedShot.endFrame,
        prompt: shotBuilderPrompt,
        correctionPrompt: selectedShot.motionInstruction,
        lockedNonNegotiables: selectedShot.lockedNonNegotiables,
      });
    }
    return compileSimulationFrameToGenerationPacket({
      packetId: `packet_${activeScene.id}_${selectedShot.shotId}_simulation`,
      sceneId: activeScene.id,
      shotId: selectedShot.shotId,
      frameUrl: shotBuilderSimulationRef.trim() || 'https://example.invalid/sim-frame.png',
      fps: 30,
      durationSec: Math.max(1, selectedShot.durationFrames / 30),
      prompt: shotBuilderPrompt,
      narration: shotBuilderNarration,
      lockedNonNegotiables: selectedShot.lockedNonNegotiables,
    });
  }, [
    activeScene,
    selectedShot,
    shotBuilderSourceType,
    shotBuilderImageUrl,
    shotBuilderVideoUrl,
    shotBuilderSimulationRef,
    shotBuilderPrompt,
    shotBuilderNarration,
  ]);

  React.useEffect(() => {
    setSubmitPrompt(diffusionPromptPreview);
  }, [diffusionPromptPreview]);

  React.useEffect(() => {
    if (!selectedShotId && motionPlanPreview.shots.length) {
      setSelectedShotId(motionPlanPreview.shots[0].shotId);
    }
  }, [motionPlanPreview.shots, selectedShotId]);

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

  async function submitVideoJob(mode: 'default' | 'scout' = 'default') {
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
      const cascadePayload =
        mode === 'scout' && scoutPacketPreview
          ? compileFinalGenerationPacketToOpenRouterPayload(scoutPacketPreview, 'scout')
          : null;
      const packetPayload =
        mode === 'scout' && shotBuilderPacket
          ? compileGenerationPacketToOpenRouterPayload(shotBuilderPacket)
          : null;
      const response = await fetch(
        `/api/v3/projects/${encodeURIComponent(projectId)}/media/video/jobs`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            mode === 'scout' && packetPayload
              ? {
                  ...packetPayload,
                  model: cascadePlan.scoutModel.modelId,
                  cascadeId: cascadePlan.id,
                  cascadeStage: 'scout',
                  parentJobId: null,
                  correctionPacket: correctionPacketPreview
                    ? {
                        preservedWins: correctionPacketPreview.preservedWins,
                        requiredFixes: correctionPacketPreview.requiredFixes,
                        summary: correctionPacketPreview.summary,
                      }
                    : undefined,
                  aspectRatio: submitAspectRatio,
                  durationSec,
                  referenceImageUrls: parsedReferenceUrls,
                }
              : cascadePayload
                ? {
                    ...cascadePayload,
                    aspectRatio: submitAspectRatio,
                    durationSec,
                    referenceImageUrls: parsedReferenceUrls,
                  }
                : {
                  prompt: submitPrompt,
                  model: submitModel,
                  aspectRatio: submitAspectRatio,
                  durationSec,
                  sourceSceneId: activeScene.id,
                  sourceVideoGraphId: null,
                  sourceShotId: selectedShot?.shotId,
                  startFrame: selectedShot?.startFrame,
                  endFrame: selectedShot?.endFrame,
                  durationFrames: selectedShot?.durationFrames,
                  cameraIntent: selectedShot?.cameraIntent,
                  motionInstruction: selectedShot?.motionInstruction,
                  diffusionInstruction: selectedShot?.diffusionInstruction,
                  lockedNonNegotiables: selectedShot?.lockedNonNegotiables ?? [],
                  referenceImageUrls: parsedReferenceUrls,
                },
          ),
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
      setLastResponseNote(
        mode === 'scout'
          ? 'Scout stage submitted to backend OpenRouter route.'
          : 'Submitted to backend OpenRouter route.',
      );
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
          title="3D Blockout Preview"
          subtitle="SceneGraph -> Three.js/R3F blockout with airflow and comfort bubble."
        >
          <BlockoutGuard>
            <SceneGraphThreeBlockout scene={activeScene} />
          </BlockoutGuard>
          <div style={{ fontSize: 11, color: GRAPH_THEME.drawer.inputMuted }}>
            Floor/desk/device forms are concept blockout geometry for camera, keyframe, and seed-frame planning.
          </div>
        </StudioPanel>

        <StudioPanel
          title="Motion Plan"
          subtitle="SceneGraph keyframes mapped to shot/frame planning for future Theatre sequencing."
        >
          <div style={{ fontSize: 12, color: GRAPH_THEME.drawer.inputMuted }}>
            Sheet {motionPlanPreview.sheetName} · FPS {motionPlanPreview.fps} · Shots {motionPlanPreview.shots.length}
          </div>
          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            <span style={{ color: GRAPH_THEME.drawer.inputMuted }}>Selected shot for video submit</span>
            <select
              value={selectedShotId}
              onChange={(event) => setSelectedShotId(event.target.value)}
              style={{
                background: GRAPH_THEME.drawer.inputBackground,
                color: GRAPH_THEME.drawer.inputText,
                border: `1px solid ${GRAPH_THEME.drawer.inputBorder}`,
                borderRadius: 8,
                padding: '8px 10px',
                fontSize: 12,
              }}
            >
              {motionPlanPreview.shots.map((shot) => (
                <option key={shot.shotId} value={shot.shotId}>
                  {shot.shotId} · {shot.cameraIntent}
                </option>
              ))}
            </select>
          </label>
          <div style={{ display: 'grid', gap: 6 }}>
            {motionPlanPreview.shots.map((shot) => (
              <div
                key={shot.shotId}
                style={{
                  display: 'grid',
                  gap: 2,
                  border: `1px solid ${GRAPH_THEME.drawer.inputBorder}`,
                  borderRadius: 8,
                  padding: 8,
                  fontSize: 11,
                  background:
                    selectedShotId === shot.shotId
                      ? GRAPH_THEME.drawer.inputBackground
                      : 'transparent',
                }}
              >
                <div>{shot.shotId} · {shot.cameraIntent}</div>
                <div style={{ color: GRAPH_THEME.drawer.inputMuted }}>
                  Frames {shot.startFrame}-{shot.endFrame} ({shot.durationFrames})
                </div>
              </div>
            ))}
          </div>
        </StudioPanel>

        <StudioPanel
          title="Model Cascade"
          subtitle="Scout -> Peepshow review -> correction packet -> finisher -> final review -> Remotion target."
        >
          <div style={{ display: 'grid', gap: 6, fontSize: 12 }}>
            <div style={{ color: GRAPH_THEME.drawer.inputMuted }}>
              Selected shot: {selectedShot?.shotId || 'none'} · Scout model {cascadePlan.scoutModel.modelId} · Finisher model {cascadePlan.finisherModel.modelId}
            </div>
            <div style={{ color: GRAPH_THEME.drawer.inputMuted }}>
              Review score: {Math.round(cascadeScoutScore * 100)}% · Next action: {cascadeNextAction}
            </div>
            <div
              style={{
                border: `1px solid ${GRAPH_THEME.drawer.inputBorder}`,
                borderRadius: 8,
                padding: 8,
                fontSize: 11,
                color: GRAPH_THEME.drawer.inputMuted,
                lineHeight: 1.45,
                display: 'grid',
                gap: 3,
              }}
            >
              <div>Scout stage: cheap run for shot framing and geometry lock.</div>
              <div>Review stage: Peepshow score + non-negotiable checks.</div>
              <div>Correction packet: preserve wins, apply required fixes.</div>
              <div>Finisher stage: premium run after promotion threshold.</div>
              {correctionPacketPreview ? (
                <div>Correction summary: {correctionPacketPreview.summary}</div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => {
                void submitVideoJob('scout');
              }}
              disabled={!projectId || submitBusy || !scoutPacketPreview}
              style={{
                justifySelf: 'start',
                border: `1px solid ${GRAPH_THEME.accent.primary}`,
                color: GRAPH_THEME.accent.primary,
                background: 'transparent',
                borderRadius: 8,
                fontSize: 12,
                padding: '7px 10px',
                cursor:
                  !projectId || submitBusy || !scoutPacketPreview ? 'not-allowed' : 'pointer',
                opacity: !projectId || submitBusy || !scoutPacketPreview ? 0.7 : 1,
              }}
            >
              Submit Scout Job
            </button>
          </div>
        </StudioPanel>

        <StudioPanel
          title="Shot Builder"
          subtitle="Normalize three-scene, image, video, or simulation shot sources into one generation packet."
        >
          <div style={{ display: 'grid', gap: 8 }}>
            <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
              <span style={{ color: GRAPH_THEME.drawer.inputMuted }}>Source type</span>
              <select
                value={shotBuilderSourceType}
                onChange={(event) =>
                  setShotBuilderSourceType(event.target.value as GenerationPacketSourceType)
                }
                style={{
                  background: GRAPH_THEME.drawer.inputBackground,
                  color: GRAPH_THEME.drawer.inputText,
                  border: `1px solid ${GRAPH_THEME.drawer.inputBorder}`,
                  borderRadius: 8,
                  padding: '8px 10px',
                  fontSize: 12,
                }}
              >
                <option value="threeScene">threeScene</option>
                <option value="imageFrame">imageFrame</option>
                <option value="videoClip">videoClip</option>
                <option value="simulationFrame">simulationFrame</option>
                <option value="generatedStill">generatedStill</option>
              </select>
            </label>
            {(shotBuilderSourceType === 'imageFrame' || shotBuilderSourceType === 'generatedStill') ? (
              <input
                value={shotBuilderImageUrl}
                onChange={(event) => setShotBuilderImageUrl(event.target.value)}
                placeholder="Image URL"
                style={{
                  background: GRAPH_THEME.drawer.inputBackground,
                  color: GRAPH_THEME.drawer.inputText,
                  border: `1px solid ${GRAPH_THEME.drawer.inputBorder}`,
                  borderRadius: 8,
                  padding: '8px 10px',
                  fontSize: 12,
                }}
              />
            ) : null}
            {shotBuilderSourceType === 'videoClip' ? (
              <input
                value={shotBuilderVideoUrl}
                onChange={(event) => setShotBuilderVideoUrl(event.target.value)}
                placeholder="Video URL"
                style={{
                  background: GRAPH_THEME.drawer.inputBackground,
                  color: GRAPH_THEME.drawer.inputText,
                  border: `1px solid ${GRAPH_THEME.drawer.inputBorder}`,
                  borderRadius: 8,
                  padding: '8px 10px',
                  fontSize: 12,
                }}
              />
            ) : null}
            {shotBuilderSourceType === 'simulationFrame' ? (
              <input
                value={shotBuilderSimulationRef}
                onChange={(event) => setShotBuilderSimulationRef(event.target.value)}
                placeholder="Simulation frame URL/ref"
                style={{
                  background: GRAPH_THEME.drawer.inputBackground,
                  color: GRAPH_THEME.drawer.inputText,
                  border: `1px solid ${GRAPH_THEME.drawer.inputBorder}`,
                  borderRadius: 8,
                  padding: '8px 10px',
                  fontSize: 12,
                }}
              />
            ) : null}
            <textarea
              value={shotBuilderPrompt}
              onChange={(event) => setShotBuilderPrompt(event.target.value)}
              rows={3}
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
            <input
              value={shotBuilderNarration}
              onChange={(event) => setShotBuilderNarration(event.target.value)}
              placeholder="Narration"
              style={{
                background: GRAPH_THEME.drawer.inputBackground,
                color: GRAPH_THEME.drawer.inputText,
                border: `1px solid ${GRAPH_THEME.drawer.inputBorder}`,
                borderRadius: 8,
                padding: '8px 10px',
                fontSize: 12,
              }}
            />
            {shotBuilderPacket ? (
              <div style={{ fontSize: 11, color: GRAPH_THEME.drawer.inputMuted, display: 'grid', gap: 3 }}>
                <div>Shot: {shotBuilderPacket.sourceShotId || 'n/a'} · FPS {shotBuilderPacket.fps}</div>
                <div>
                  Frames {shotBuilderPacket.startFrame}-{shotBuilderPacket.endFrame} (
                  {shotBuilderPacket.durationFrames})
                </div>
                <div>
                  Output targets: {shotBuilderPacket.outputTargets.join(', ')}
                </div>
                <div>
                  Locked rules: {shotBuilderPacket.lockedNonNegotiables.join(' | ') || 'none'}
                </div>
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => {
                void submitVideoJob('scout');
              }}
              disabled={!projectId || submitBusy || !shotBuilderPacket}
              style={{
                justifySelf: 'start',
                border: `1px solid ${GRAPH_THEME.accent.primary}`,
                color: GRAPH_THEME.accent.primary,
                background: 'transparent',
                borderRadius: 8,
                fontSize: 12,
                padding: '7px 10px',
                cursor: !projectId || submitBusy || !shotBuilderPacket ? 'not-allowed' : 'pointer',
                opacity: !projectId || submitBusy || !shotBuilderPacket ? 0.7 : 1,
              }}
            >
              Use Packet For Scout Job
            </button>
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
            <span
              style={{
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: 999,
                border: `1px solid ${GRAPH_THEME.drawer.inputBorder}`,
                color:
                  panelState === 'failed'
                    ? '#D98458'
                    : panelState === 'succeeded'
                      ? GRAPH_THEME.accent.primary
                      : GRAPH_THEME.drawer.inputMuted,
              }}
            >
              {panelState}
            </span>
            <span style={{ fontSize: 11, color: GRAPH_THEME.drawer.inputMuted }}>
              {!projectId
                ? 'Select a project to enable submit.'
                : lastResponseNote || 'Backend-owned route; key remains server-side.'}
            </span>
          </div>
          {jobView ? (
            <div style={{ display: 'grid', gap: 4, fontSize: 12 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span>Local job: {jobView.id}</span>
                <span style={{ color: GRAPH_THEME.drawer.inputMuted }}>{jobView.status}</span>
              </div>
              <div style={{ color: GRAPH_THEME.drawer.inputMuted }}>
                Updated: {jobView.updatedAt}
              </div>
            </div>
          ) : null}
          {jobView?.providerJobId ? (
            <div style={{ fontSize: 11, color: GRAPH_THEME.drawer.inputMuted }}>
              Provider job: {jobView.providerJobId}
            </div>
          ) : null}
          {jobView?.cascadeId ? (
            <div style={{ fontSize: 11, color: GRAPH_THEME.drawer.inputMuted }}>
              Cascade: {jobView.cascadeId} · Stage {jobView.cascadeStage || 'n/a'} · Parent{' '}
              {jobView.parentJobId || 'none'}
            </div>
          ) : null}
          {jobView?.generationPacketId ? (
            <div style={{ fontSize: 11, color: GRAPH_THEME.drawer.inputMuted }}>
              Packet: {jobView.generationPacketId} · Source {jobView.sourceType || 'n/a'} · FPS{' '}
              {jobView.fps ?? 'n/a'}
            </div>
          ) : null}
          {jobView?.sourceShotId ? (
            <div
              style={{
                border: `1px solid ${GRAPH_THEME.drawer.inputBorder}`,
                borderRadius: 8,
                padding: 8,
                fontSize: 11,
                lineHeight: 1.45,
                color: GRAPH_THEME.drawer.inputMuted,
                display: 'grid',
                gap: 3,
              }}
            >
              <div>
                Shot context: {jobView.sourceShotId} · {jobView.sourceSceneId || 'scene-unknown'}
              </div>
              <div>
                Frames {jobView.startFrame ?? '?'}-{jobView.endFrame ?? '?'} (
                {jobView.durationFrames ?? '?'} frames)
              </div>
              {jobView.cameraIntent ? <div>Camera: {jobView.cameraIntent}</div> : null}
              {jobView.motionInstruction ? <div>Motion: {jobView.motionInstruction}</div> : null}
              {jobView.diffusionInstruction ? (
                <div>Diffusion: {jobView.diffusionInstruction}</div>
              ) : null}
              {jobView.lockedNonNegotiables.length ? (
                <div>
                  Locks: {jobView.lockedNonNegotiables.join(' | ')}
                </div>
              ) : null}
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
          {jobView?.resultUrls?.length === 0 && jobView?.resultPayload ? (
            <div
              style={{
                border: `1px solid ${GRAPH_THEME.drawer.inputBorder}`,
                borderRadius: 8,
                padding: 8,
                fontSize: 11,
                lineHeight: 1.4,
                color: GRAPH_THEME.drawer.inputMuted,
                maxHeight: 120,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
              }}
            >
              {JSON.stringify(jobView.resultPayload, null, 2)}
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

        <StudioPanel title="Object Awareness" subtitle="Structured selected-object context for object-aware agent actions.">
          <div style={{ fontSize: 12, color: GRAPH_THEME.drawer.inputMuted }}>
            Canvas {objectAwareContextPreview.canvasId} · Scene {objectAwareContextPreview.sceneId}
          </div>
          {objectAwareContextPreview.selected ? (
            <div
              style={{
                border: `1px solid ${GRAPH_THEME.drawer.inputBorder}`,
                borderRadius: 8,
                padding: 8,
                fontSize: 11,
                lineHeight: 1.4,
                color: GRAPH_THEME.drawer.inputMuted,
              }}
            >
              {JSON.stringify(objectAwareContextPreview.selected, null, 2)}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: GRAPH_THEME.drawer.inputMuted }}>
              No selected object context yet.
            </div>
          )}
        </StudioPanel>

        <StudioPanel title="Scene Assets" subtitle="Resolved asset templates for blockout/render/simulation context.">
          <div style={{ fontSize: 12, color: GRAPH_THEME.drawer.inputMuted }}>
            {sceneAssetRegistryPreview.name} · Resolved {resolvedSceneAssetsPreview.length}
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {resolvedSceneAssetsPreview.map((asset) => (
              <div
                key={asset.sceneAssetId}
                style={{
                  display: 'grid',
                  gap: 4,
                  fontSize: 12,
                  border: `1px solid ${GRAPH_THEME.drawer.inputBorder}`,
                  borderRadius: 8,
                  padding: 8,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span>{asset.sceneAssetName}</span>
                  <span style={{ color: GRAPH_THEME.drawer.inputMuted }}>
                    {asset.category}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: GRAPH_THEME.drawer.inputMuted }}>
                  source {asset.source} · geometry {asset.geometryKind}
                </div>
                <div style={{ fontSize: 11, color: GRAPH_THEME.drawer.inputMuted }}>
                  render {asset.renderRole} · sim {asset.simulationRole}
                </div>
                <div style={{ fontSize: 11, color: GRAPH_THEME.drawer.inputMuted }}>
                  fallback {asset.fallbackStatus}
                </div>
                {asset.dimensionHint ? (
                  <div style={{ fontSize: 11, color: GRAPH_THEME.drawer.inputMuted }}>
                    dims {asset.dimensionHint.width ?? '?'}x{asset.dimensionHint.height ?? '?'}x
                    {asset.dimensionHint.depth ?? '?'} {asset.dimensionHint.unit}
                  </div>
                ) : null}
                {asset.warnings.length ? (
                  <div style={{ fontSize: 11, color: '#D98458' }}>
                    {asset.warnings.join(' | ')}
                  </div>
                ) : null}
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
                motionPlan: motionPlanPreview,
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
