// @graph entity: BuilderDeckPersistenceActions
// @graph role: deck-save-actions
// @graph relates_to: AgentBuilderWorkspace
// @graph depends_on: React
// @graph feeds_to: DeckStore
import { useCallback } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import { isAbortLikeError, safeJson } from "./requestGuards";
import type { DeckDocument } from "../../types/agentgraph";

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

export function useBuilderDeckPersistenceActions({
  builderDev,
  canvasProjectId,
  deck,
  deckId,
  deckRevision,
  deckSaveAbortRef,
  formatBuilderStatusMessage,
  hydrateDeckDocument,
  setDeck,
  setDeckRevision,
  setDeckSaveBusy,
  setDeckStatusMessage,
  projectsApi,
  activeProjectLatestRef,
  recordDeckWriteReason,
  onDeckPersistProof,
}: {
  builderDev: boolean;
  canvasProjectId: string;
  deck: DeckDocument;
  deckId: string;
  deckRevision: string | null;
  deckSaveAbortRef: MutableRefObject<AbortController | null>;
  formatBuilderStatusMessage: (message: unknown, fallback: string) => string;
  hydrateDeckDocument: (value: Partial<DeckDocument> | null | undefined) => DeckDocument;
  setDeck: Dispatch<SetStateAction<DeckDocument>>;
  setDeckRevision: Dispatch<SetStateAction<string | null>>;
  setDeckSaveBusy: Dispatch<SetStateAction<boolean>>;
  setDeckStatusMessage: Dispatch<SetStateAction<string | null>>;
  projectsApi: string;
  activeProjectLatestRef: MutableRefObject<string>;
  recordDeckWriteReason: (reason: string) => void;
  onDeckPersistProof?: (entry: {
    projectId: string;
    deckId: string;
    reason: string;
    nodeCount: number;
    edgeCount: number;
    revisionBefore: string | null;
    revisionAfter: string | null;
    ok: boolean;
    error?: string;
  }) => void;
}) {
  const handleSaveDeck = useCallback(async () => {
    if (!canvasProjectId) {
      setDeckStatusMessage("Open a canvas before saving.");
      return;
    }

    const requestedDeckVersion = deck.version;
    setDeckSaveBusy(true);
    setDeckStatusMessage("Saving deck...");
    const requestProjectId = canvasProjectId;
    deckSaveAbortRef.current?.abort();
    const controller = new AbortController();
    deckSaveAbortRef.current = controller;

    try {
      const endpoint = `${projectsApi}/${requestProjectId}/decks/${deckId}`;
      const revisionBefore = deckRevision;
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
        onDeckPersistProof?.({
          projectId: requestProjectId,
          deckId,
          reason: "manual-save",
          nodeCount: deck.nodes.length,
          edgeCount: deck.edges.length,
          revisionBefore,
          revisionAfter: null,
          ok: false,
          error: safeText(data?.error || "deck_save_failed"),
        });
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
      const revisionAfter =
        typeof data?.meta?.deckRevision === "string" ? data.meta.deckRevision : deckRevision;
      setDeckRevision(revisionAfter);
      onDeckPersistProof?.({
        projectId: requestProjectId,
        deckId,
        reason: "manual-save",
        nodeCount: deck.nodes.length,
        edgeCount: deck.edges.length,
        revisionBefore,
        revisionAfter,
        ok: true,
      });
      setDeckStatusMessage("Board saved.");
    } catch (err: any) {
      if (isAbortLikeError(err) || activeProjectLatestRef.current !== requestProjectId) {
        return;
      }
      const fallbackMessage =
        safeText(err?.message) === "deck_conflict"
          ? "A newer saved canvas exists. Reload the workspace before saving again."
          : "Could not save the current board.";
      onDeckPersistProof?.({
        projectId: requestProjectId,
        deckId,
        reason: "manual-save",
        nodeCount: deck.nodes.length,
        edgeCount: deck.edges.length,
        revisionBefore: deckRevision,
        revisionAfter: null,
        ok: false,
        error: safeText(err?.message || "deck_save_failed"),
      });
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
    formatBuilderStatusMessage,
    hydrateDeckDocument,
    recordDeckWriteReason,
    setDeck,
    setDeckRevision,
    setDeckSaveBusy,
    setDeckStatusMessage,
    projectsApi,
    onDeckPersistProof,
  ]);

  return {
    handleSaveDeck,
  };
}
