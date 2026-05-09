// @graph entity: BuilderDeckRuntimeActions
// @graph role: deck-run-actions
// @graph relates_to: AgentBuilderWorkspace, DeckRuntime, CardRuntime
// @graph depends_on: DeckRunState, React
// @graph feeds_to: DeckRunRoute
import { useCallback } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import { resolveEffectiveAgent } from "./deckRuntime";
import { streamDeckRunRequest } from "./deckRunState";
import { isAbortLikeError, safeJson } from "./requestGuards";
import type {
  AgentCardInstance,
  AgentTemplate,
  CardRunResult,
  DeckDocument,
  DeckRun,
  DeckRuntimeEvent,
  RuntimeBinding,
  WorkspaceObjectContext,
} from "../../types/agentgraph";

function safeText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    const json = JSON.stringify(value);
    if (typeof json === "string") return json;
  } catch {
    // fallback below
  }
  return String(value);
}

export type LatestCardRunRecord = {
  cardId: string;
  title: string;
  templateId: string;
  runtimeBinding?: RuntimeBinding | null;
  input: string;
  effectiveAgent: AgentTemplate;
  result: CardRunResult;
};

export function useBuilderDeckRuntimeActions({
  builderDev,
  buildSingleCardRunDocument,
  canvasProjectId,
  deck,
  deckExecutionAbortRef,
  deckExecutionPlan,
  deckId,
  deckRevision,
  deckRunInput,
  deckSaveAbortRef,
  deckUsingDisplayFallback,
  deckValidation,
  effectiveAgent,
  formatBuilderStatusMessage,
  hydrateDeckDocument,
  selectedCard,
  workspaceContext,
  workspaceObjectContext,
  setCardRunBusy,
  setDeck,
  setDeckRevision,
  setDeckRunBusy,
  setDeckSaveBusy,
  setDeckStatusMessage,
  setLatestCardRun,
  setLatestDeckRun,
  setLiveDeckEvents,
  templates,
  uid,
  v3ProjectsApi,
  activeProjectLatestRef,
  recordDeckWriteReason,
}: {
  builderDev: boolean;
  buildSingleCardRunDocument: (document: DeckDocument, cardId: string) => DeckDocument | null;
  canvasProjectId: string;
  deck: DeckDocument;
  deckExecutionAbortRef: MutableRefObject<AbortController | null>;
  deckExecutionPlan: {
    startCardIds: string[];
    simpleOrderCardIds: string[];
    expandedSteps: Array<{ executionId: string }>;
  };
  deckId: string;
  deckRevision: string | null;
  deckRunInput: string;
  deckSaveAbortRef: MutableRefObject<AbortController | null>;
  deckUsingDisplayFallback: boolean;
  deckValidation: {
    ok: boolean;
    errors: Array<{ message: string }>;
    warnings: Array<{ message: string }>;
  };
  effectiveAgent: AgentTemplate | null;
  formatBuilderStatusMessage: (message: unknown, fallback: string) => string;
  hydrateDeckDocument: (value: Partial<DeckDocument> | null | undefined) => DeckDocument;
  selectedCard: AgentCardInstance | null;
  workspaceContext?: unknown;
  workspaceObjectContext?: WorkspaceObjectContext | null;
  setCardRunBusy: Dispatch<SetStateAction<boolean>>;
  setDeck: Dispatch<SetStateAction<DeckDocument>>;
  setDeckRevision: Dispatch<SetStateAction<string | null>>;
  setDeckRunBusy: Dispatch<SetStateAction<boolean>>;
  setDeckSaveBusy: Dispatch<SetStateAction<boolean>>;
  setDeckStatusMessage: Dispatch<SetStateAction<string | null>>;
  setLatestCardRun: Dispatch<SetStateAction<LatestCardRunRecord | null>>;
  setLatestDeckRun: Dispatch<SetStateAction<DeckRun | null>>;
  setLiveDeckEvents: Dispatch<SetStateAction<DeckRuntimeEvent[]>>;
  templates: AgentTemplate[];
  uid: () => string;
  v3ProjectsApi: string;
  activeProjectLatestRef: MutableRefObject<string>;
  recordDeckWriteReason: (reason: string) => void;
}) {
  const handleSaveDeck = useCallback(async () => {
    if (!canvasProjectId) {
      setDeckStatusMessage("Open a canvas before saving.");
      return;
    }
    if (deckUsingDisplayFallback) {
      setDeckStatusMessage(
        "This canvas is a temporary display fallback and will not overwrite the saved deck.",
      );
      return;
    }

    const requestedDeckVersion = deck.version;

    // Persist contract:
    // - canvas/deck state is the only persisted graph source of truth
    // - right-panel edits write only explicit node/edge fields into that deck state
    // - selection, tab, and drawer are non-persisted view state only
    setDeckSaveBusy(true);
    setDeckStatusMessage("Saving deck...");
    const requestProjectId = canvasProjectId;
    deckSaveAbortRef.current?.abort();
    const controller = new AbortController();
    deckSaveAbortRef.current = controller;

    try {
      const endpoint = `${v3ProjectsApi}/${requestProjectId}/decks/${deckId}`;
      const response = await fetch(endpoint, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          document: {
            ...deck,
            id: deckId,
          },
          expectedRevision: deckRevision,
        }),
        signal: controller.signal,
      });
      const data = await safeJson(response);
      if (controller.signal.aborted || activeProjectLatestRef.current !== requestProjectId) {
        return;
      }

      if (!response.ok) {
        throw new Error(safeText(data?.error || "deck_save_failed"));
      }

      if (data?.deck && typeof data.deck === "object") {
        recordDeckWriteReason("deck-save-merge");
        setDeck((currentDeck) => {
          if (currentDeck.version !== requestedDeckVersion) {
            if (builderDev) {
              console.warn("[builder] skipped stale deck save merge", {
                requestVersion: requestedDeckVersion,
                currentVersion: currentDeck.version,
              });
            }
            return currentDeck;
          }
          return hydrateDeckDocument({ ...(data.deck as DeckDocument), id: deckId });
        });
      }
      setDeckRevision(
        typeof data?.meta?.deckRevision === "string" ? data.meta.deckRevision : deckRevision,
      );
      setDeckStatusMessage("Board saved.");
    } catch (err: any) {
      if (isAbortLikeError(err) || activeProjectLatestRef.current !== requestProjectId) {
        return;
      }
      const fallbackMessage =
        safeText(err?.message) === "deck_conflict"
          ? "A newer saved canvas exists. Reload the workspace before saving again."
          : "Could not save the current board.";
      setDeckStatusMessage(formatBuilderStatusMessage(err?.message, fallbackMessage));
    } finally {
      if (deckSaveAbortRef.current === controller) {
        deckSaveAbortRef.current = null;
      }
      setDeckSaveBusy(false);
    }
  }, [
    activeProjectLatestRef,
    builderDev,
    canvasProjectId,
    deck,
    deckId,
    deckRevision,
    deckSaveAbortRef,
    deckUsingDisplayFallback,
    formatBuilderStatusMessage,
    hydrateDeckDocument,
    recordDeckWriteReason,
    setDeck,
    setDeckRevision,
    setDeckSaveBusy,
    setDeckStatusMessage,
    v3ProjectsApi,
  ]);

  const handleRunSelectedCard = useCallback(async () => {
    if (!canvasProjectId) {
      setDeckStatusMessage("Canvas data is unavailable for this selection.");
      return;
    }
    if (!selectedCard || !effectiveAgent) {
      setDeckStatusMessage("Select a card before running it.");
      return;
    }
    const singleCardDeck = buildSingleCardRunDocument(deck, selectedCard.id);
    if (!singleCardDeck) {
      setDeckStatusMessage("Selected card could not be isolated for execution.");
      return;
    }

    setCardRunBusy(true);
    setLatestCardRun(null);
    setLiveDeckEvents([]);
    setDeckStatusMessage("Running selected card...");
    const requestProjectId = canvasProjectId;
    deckExecutionAbortRef.current?.abort();
    const controller = new AbortController();
    deckExecutionAbortRef.current = controller;

    try {
      const selectedCardRunAgent = resolveEffectiveAgent(selectedCard, templates);
      const endpoint = `${v3ProjectsApi}/${requestProjectId}/decks/run`;
      const data = await streamDeckRunRequest({
        endpoint,
        body: {
          deckId,
          document: {
            ...singleCardDeck,
            id: deckId,
          },
          templates,
          input: deckRunInput,
          workspaceContext,
          workspaceObjectContext,
        },
        signal: controller.signal,
        onEvent: (event) => {
          if (controller.signal.aborted || activeProjectLatestRef.current !== requestProjectId) return;
          setLiveDeckEvents((current) => [...current, event]);
        },
      });
      if (controller.signal.aborted || activeProjectLatestRef.current !== requestProjectId) {
        return;
      }

      if (!data?.run || typeof data.run !== "object") {
        const failure = data as { message?: unknown; error?: unknown };
        throw new Error(safeText(failure.message || failure.error || "Card run failed."));
      }

      const run = data.run as DeckRun;
      const step = run.steps.find((entry) => entry.cardId === selectedCard.id);
      if (!step) {
        throw new Error("Selected card did not produce a run step.");
      }
      const result: CardRunResult = {
        output: step.output,
        status: step.status,
        error: step.error,
        startedAt: step.startedAt,
        endedAt: step.endedAt,
        runtimeBinding: step.runtimeBinding,
        seed: step.seed,
        contract: step.contract,
        handshake: step.handshake,
        score: step.score,
        passed: step.passed,
        scoreDetail: step.scoreDetail,
        improvementPromptBit: step.improvementPromptBit,
        inputSummary: step.inputSummary,
        outputSummary: step.outputSummary,
      };

      setLatestCardRun({
        cardId: selectedCard.id,
        title: selectedCard.title,
        templateId: selectedCard.templateId,
        runtimeBinding: selectedCard.runtimeBinding ?? null,
        input: deckRunInput,
        effectiveAgent: selectedCardRunAgent || effectiveAgent,
        result,
      });
      setLatestDeckRun(run);
      setLiveDeckEvents([]);

      if (result.status === "error") {
        setDeckStatusMessage(formatBuilderStatusMessage(result.error, "Card run failed."));
      } else {
        setDeckStatusMessage("Selected card run complete.");
      }
    } catch (err: any) {
      if (isAbortLikeError(err) || activeProjectLatestRef.current !== requestProjectId) {
        return;
      }
      setLatestCardRun({
        cardId: selectedCard.id,
        title: selectedCard.title,
        templateId: selectedCard.templateId,
        runtimeBinding: selectedCard.runtimeBinding ?? null,
        input: deckRunInput,
        effectiveAgent,
        result: {
          output: null,
          status: "error",
          error: err?.message || "Card run failed.",
          startedAt: new Date().toISOString(),
          endedAt: new Date().toISOString(),
        },
      });
      setLiveDeckEvents([]);
      setDeckStatusMessage(formatBuilderStatusMessage(err?.message, "Card run failed."));
    } finally {
      if (deckExecutionAbortRef.current === controller) {
        deckExecutionAbortRef.current = null;
      }
      setCardRunBusy(false);
    }
  }, [
    activeProjectLatestRef,
    buildSingleCardRunDocument,
    canvasProjectId,
    deck,
    deckExecutionAbortRef,
    deckId,
    deckRunInput,
    effectiveAgent,
    formatBuilderStatusMessage,
    selectedCard,
    setCardRunBusy,
    setDeckStatusMessage,
    setLatestCardRun,
    setLatestDeckRun,
    setLiveDeckEvents,
    templates,
    v3ProjectsApi,
    workspaceContext,
    workspaceObjectContext,
  ]);

  const handleRunDeck = useCallback(async () => {
    if (!canvasProjectId) {
      const now = new Date().toISOString();
      setLatestDeckRun({
        id: `deck_run_${uid()}`,
        deckId,
        startedAt: now,
        endedAt: now,
        status: "error",
        input: deckRunInput,
        error: "Select a project before running the deck.",
        steps: [],
        validationSummary: {
          ok: deckValidation.ok,
          errors: deckValidation.errors.map((issue) => issue.message),
          warnings: deckValidation.warnings.map((issue) => issue.message),
        },
        executionPlanSummary: {
          startCardIds: deckExecutionPlan.startCardIds,
          simpleOrderCardIds: deckExecutionPlan.simpleOrderCardIds,
          expandedStepIds: deckExecutionPlan.expandedSteps.map((step) => step.executionId),
        },
      });
      return;
    }

    const requestedDeckVersion = deck.version;

    setDeckRunBusy(true);
    setLatestCardRun(null);
    setLatestDeckRun(null);
    setLiveDeckEvents([]);
    setDeckStatusMessage("Running deck...");
    const requestProjectId = canvasProjectId;
    deckExecutionAbortRef.current?.abort();
    const controller = new AbortController();
    deckExecutionAbortRef.current = controller;

    try {
      const endpoint = `${v3ProjectsApi}/${requestProjectId}/decks/run`;
      const data = await streamDeckRunRequest({
        endpoint,
        body: {
          deckId,
          document: {
            ...deck,
            id: deckId,
          },
          templates,
          input: deckRunInput,
          workspaceContext,
          workspaceObjectContext,
        },
        signal: controller.signal,
        onEvent: (event) => {
          if (controller.signal.aborted || activeProjectLatestRef.current !== requestProjectId) return;
          setLiveDeckEvents((current) => [...current, event]);
        },
      });
      if (controller.signal.aborted || activeProjectLatestRef.current !== requestProjectId) {
        return;
      }

      if (!data?.run) {
        const failure = data as { error?: unknown };
        throw new Error(safeText(failure.error || "Deck run failed."));
      }

      const run = data.run as DeckRun;
      setLatestDeckRun(run);
      setLiveDeckEvents([]);
      if (data?.deck && typeof data.deck === "object") {
        recordDeckWriteReason("deck-run-merge");
        setDeck((currentDeck) => {
          if (currentDeck.version !== requestedDeckVersion) {
            if (builderDev) {
              console.warn("[builder] skipped stale deck run merge", {
                requestVersion: requestedDeckVersion,
                currentVersion: currentDeck.version,
              });
            }
            return currentDeck;
          }
          return hydrateDeckDocument({ ...(data.deck as DeckDocument), id: deckId });
        });
      }
      setDeckStatusMessage("Board run complete.");
    } catch (err: any) {
      if (isAbortLikeError(err) || activeProjectLatestRef.current !== requestProjectId) {
        return;
      }
      const friendlyError = formatBuilderStatusMessage(err?.message, "Board run failed.");
      const now = new Date().toISOString();
      setLatestDeckRun({
        id: `deck_run_${uid()}`,
        deckId,
        startedAt: now,
        endedAt: now,
        status: "error",
        input: deckRunInput,
        error: friendlyError,
        steps: [],
        validationSummary: {
          ok: deckValidation.ok,
          errors: deckValidation.errors.map((issue) => issue.message),
          warnings: deckValidation.warnings.map((issue) => issue.message),
        },
        executionPlanSummary: {
          startCardIds: deckExecutionPlan.startCardIds,
          simpleOrderCardIds: deckExecutionPlan.simpleOrderCardIds,
          expandedStepIds: deckExecutionPlan.expandedSteps.map((step) => step.executionId),
        },
      });
      setLiveDeckEvents([]);
      setDeckStatusMessage(friendlyError);
    } finally {
      if (deckExecutionAbortRef.current === controller) {
        deckExecutionAbortRef.current = null;
      }
      setDeckRunBusy(false);
    }
  }, [
    activeProjectLatestRef,
    builderDev,
    canvasProjectId,
    deck,
    deckExecutionAbortRef,
    deckExecutionPlan,
    deckId,
    deckRunInput,
    deckValidation,
    formatBuilderStatusMessage,
    hydrateDeckDocument,
    recordDeckWriteReason,
    setDeck,
    setDeckRunBusy,
    setDeckStatusMessage,
    setLatestCardRun,
    setLatestDeckRun,
    setLiveDeckEvents,
    templates,
    uid,
    v3ProjectsApi,
    workspaceContext,
    workspaceObjectContext,
  ]);

  return {
    handleSaveDeck,
    handleRunSelectedCard,
    handleRunDeck,
  };
}
