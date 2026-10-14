import { useEffect } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

type UseAgentBuilderProjectResetArgs = {
  canvasProjectId: string;
  deckSaveAbortRef: MutableRefObject<AbortController | null>;
  layoutAutosaveAbortRef: MutableRefObject<AbortController | null>;
  setDeckSaveBusy: Dispatch<SetStateAction<boolean>>;
};

export default function useAgentBuilderProjectReset({
  canvasProjectId,
  deckSaveAbortRef,
  layoutAutosaveAbortRef,
  setDeckSaveBusy,
}: UseAgentBuilderProjectResetArgs) {
  useEffect(() => {
    deckSaveAbortRef.current?.abort();
    deckSaveAbortRef.current = null;
    layoutAutosaveAbortRef.current?.abort();
    layoutAutosaveAbortRef.current = null;
    setDeckSaveBusy(false);
  }, [
    canvasProjectId,
    deckSaveAbortRef,
    layoutAutosaveAbortRef,
    setDeckSaveBusy,
  ]);
}
