import { useEffect } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

type UseAgentBuilderProjectResetArgs = {
  canvasProjectId: string;
  deckSaveAbortRef: MutableRefObject<AbortController | null>;
  layoutAutosaveAbortRef: MutableRefObject<AbortController | null>;
  deckExecutionAbortRef: MutableRefObject<AbortController | null>;
  setSending: Dispatch<SetStateAction<boolean>>;
  setDeckSaveBusy: Dispatch<SetStateAction<boolean>>;
  setDeckRunBusy: Dispatch<SetStateAction<boolean>>;
  setCardRunBusy: Dispatch<SetStateAction<boolean>>;
};

export default function useAgentBuilderProjectReset({
  canvasProjectId,
  deckSaveAbortRef,
  layoutAutosaveAbortRef,
  deckExecutionAbortRef,
  setSending,
  setDeckSaveBusy,
  setDeckRunBusy,
  setCardRunBusy,
}: UseAgentBuilderProjectResetArgs) {
  useEffect(() => {
    deckSaveAbortRef.current?.abort();
    deckSaveAbortRef.current = null;
    layoutAutosaveAbortRef.current?.abort();
    layoutAutosaveAbortRef.current = null;
    deckExecutionAbortRef.current?.abort();
    deckExecutionAbortRef.current = null;
    setSending(false);
    setDeckSaveBusy(false);
    setDeckRunBusy(false);
    setCardRunBusy(false);
  }, [
    canvasProjectId,
    deckExecutionAbortRef,
    deckSaveAbortRef,
    layoutAutosaveAbortRef,
    setCardRunBusy,
    setDeckRunBusy,
    setDeckSaveBusy,
    setSending,
  ]);
}
