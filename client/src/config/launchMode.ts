/**
 * LiquidAIty Launch Mode Configuration
 *
 * Controls which surfaces and workbench cards are visible in the current
 * launch context. Change flags here to show/hide features without touching
 * scattered component logic.
 *
 * Stage 0 — Agent Workspace Launch Cleanup + Security Fence
 * Status: Trading Desk MVP launch configuration.
 *
 * To restore a hidden surface, set its flag to `true` and consult
 * docs/disabled-features.md for full restore steps.
 */

export type LaunchModeConfig = {
  /** Trading Desk — primary launch workflow. Always true. */
  showTrading: boolean;

  /**
   * WorldSignals / Crucix — preserved as a show-off and evidence surface.
   * Will later become the SignalEvidence layer for the Trading Desk.
   * Keep true. Do not remove.
   */
  showWorldSignalDemo: boolean;

  /**
   * Knowledge / Graph rail — always visible, used by Trading Desk
   * for KnowGraph (EDGAR, news, signals) and ThinkGraph (reasoning).
   */
  showKnowledge: boolean;

  /**
   * Plan rail — always visible, used by the agent canvas orchestration.
   */
  showPlan: boolean;

  // ── Hidden for Trading Desk MVP ───────────────────────────────────────────

  /**
   * NRGSim / Energy Surface — building modeling / NRGSIM.
   * Future: Building Mode.
   * Restore condition: Building Mode approved by user.
   */
  showEnergy: boolean;

  /**
   * Media Studio Canvas — image and video generation.
   * Future: Media Mode (social sharing, trade reports, signal explainers).
   * Restore condition: Media Mode approved by user.
   */
  showMedia: boolean;

  /**
   * Image Workbench card — image generation surface.
   * Future: Media Mode.
   */
  showImage: boolean;

  /**
   * Video Workbench card — video generation surface.
   * Future: Media Mode.
   */
  showVideo: boolean;

  /**
   * Data Formulator — not working; must not weaken the MVP.
   * Future: Only if directly useful for trading data transforms,
   * chart transforms, EDGAR data shaping, or WorldSignals data shaping.
   * Restore condition: Explicit user approval + working implementation.
   */
  showDataFormulator: boolean;

  /**
   * Understand Anything — UA dashboard/workbench surface.
   * Future: Design Mode or Code Mode.
   * Restore condition: Useful for stock research, EDGAR interpretation,
   * news research, or company explainers.
   */
  showUnderstandAnything: boolean;

  /**
   * CodeGraph surface — developer code analysis surface.
   * Future: Code Mode (developer mode flag).
   * Restore condition: Internal developer mode explicitly enabled.
   */
  showCodeGraph: boolean;

  /**
   * Telescope / Skyview / citizen science.
   * Future: Science Mode.
   * Restore condition: Science Mode approved by user.
   */
  showTelescope: boolean;

  /**
   * Detailed Mode page — model training experiment scaffold.
   * Future: Code Mode.
   * Restore condition: Working implementation with real backend contract.
   */
  showDetailedMode: boolean;

  /**
   * Shopping agents — not yet built.
   * Future: Shopping Mode.
   */
  showShopping: boolean;

  /**
   * Code Workbench card — local coder / canvas-owned code bridge.
   * Future: Code Mode.
   * Restore condition: Canvas-owned code bridge restored.
   */
  showCode: boolean;
};

/**
 * Stage 0 — Trading Desk MVP launch flags.
 *
 * Primary visible surfaces:
 *   - Trading (primary)
 *   - WorldSignals (evidence/demo)
 *   - Knowledge (KnowGraph + ThinkGraph rail)
 *   - Plan (agent canvas rail)
 *
 * All other surfaces hidden until their future mode is approved.
 */
const LAUNCH_MODE: LaunchModeConfig = {
  // ── Visible ───────────────────────────────────────────────────────────────
  showTrading: true,
  showWorldSignalDemo: true,
  showKnowledge: true,
  showPlan: true,

  // ── Hidden (Trading Desk MVP) ─────────────────────────────────────────────
  showEnergy: false,
  showMedia: false,
  showImage: false,
  showVideo: false,
  showDataFormulator: false,
  showUnderstandAnything: false,
  showCodeGraph: false,
  showTelescope: false,
  showDetailedMode: false,
  showShopping: false,
  showCode: false,
} as const;

export default LAUNCH_MODE;
