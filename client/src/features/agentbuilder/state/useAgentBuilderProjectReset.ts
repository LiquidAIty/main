import { useEffect } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

type UseAgentBuilderProjectResetArgs = {
  canvasProjectId: string;
  layoutAutosaveAbortRef: MutableRefObject<AbortController | null>;
  setDeckSaveBusy: Dispatch<SetStateAction<boolean>>;
};

export default function useAgentBuilderProjectReset({
  canvasProjectId,
  layoutAutosaveAbortRef,
  setDeckSaveBusy,
}: UseAgentBuilderProjectResetArgs) {
  useEffect(() => {
    layoutAutosaveAbortRef.current?.abort();
    layoutAutosaveAbortRef.current = null;
    setDeckSaveBusy(false);
  }, [
    canvasProjectId,
    layoutAutosaveAbortRef,
    setDeckSaveBusy,
  ]);
}
