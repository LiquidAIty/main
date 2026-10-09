import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { CardEditorConfiguration } from '../features/agentbuilder/cardConfigurationEditor';

type SaveCardStatus = 'idle' | 'saving' | 'saved' | 'failed';

export function useCardInspectorDraftPersistence<ProfileDraft>({
  buildCurrentLocalPayload,
  onSaveLocalConfig,
  captureProfileDraft,
  saveCapturedProfileDraft,
  hasDirtyProfileDraft,
  registerCardDraftFlush,
}: {
  buildCurrentLocalPayload(): CardEditorConfiguration;
  onSaveLocalConfig(config: CardEditorConfiguration): void | Promise<void>;
  captureProfileDraft(): ProfileDraft;
  saveCapturedProfileDraft(snapshot: ProfileDraft): Promise<void>;
  hasDirtyProfileDraft(): boolean;
  registerCardDraftFlush(save: (() => Promise<boolean>) | null): void;
}) {
  const [saveCardStatus, setSaveCardStatus] = useState<SaveCardStatus>('idle');
  const [saveCardErrorMessage, setSaveCardErrorMessage] = useState<string | null>(null);
  const [draftRevision, setDraftRevision] = useState(0);
  const cardSaveInFlightRef = useRef<Promise<boolean> | null>(null);
  const cardDraftRevisionRef = useRef(0);
  const draftDirtyRef = useRef(false);

  const markDraftDirty = useCallback(() => {
    draftDirtyRef.current = true;
    cardDraftRevisionRef.current += 1;
    setDraftRevision((revision) => revision + 1);
  }, []);

  const markProfileDraftActivity = useCallback(() => {
    setDraftRevision((revision) => revision + 1);
  }, []);

  const isHydrationBlocked = useCallback(() => (
    draftDirtyRef.current || cardSaveInFlightRef.current !== null
  ), []);

  const runSaveConfig = useCallback(async () => {
    if (!draftDirtyRef.current) return;
    const revision = cardDraftRevisionRef.current;
    const payload = buildCurrentLocalPayload();
    await Promise.resolve(onSaveLocalConfig(payload));
    if (cardDraftRevisionRef.current === revision) {
      draftDirtyRef.current = false;
    }
  }, [onSaveLocalConfig, buildCurrentLocalPayload]);

  const saveCurrentDraft = useCallback(async (): Promise<void> => {
    const profileSnapshot = captureProfileDraft();
    await runSaveConfig();
    await saveCapturedProfileDraft(profileSnapshot);
  }, [captureProfileDraft, runSaveConfig, saveCapturedProfileDraft]);

  const saveLatestDraftRef = useRef(saveCurrentDraft);
  useLayoutEffect(() => {
    saveLatestDraftRef.current = saveCurrentDraft;
  }, [saveCurrentDraft]);

  const flushCardDraft = useCallback((): Promise<boolean> => {
    // The canvas clears one selection and sets the other in the same click.
    // Both callers must await the same save, including any newer edits.
    if (cardSaveInFlightRef.current) return cardSaveInFlightRef.current;
    if (!draftDirtyRef.current && !hasDirtyProfileDraft()) return Promise.resolve(true);
    const save = Promise.resolve().then(async () => {
      setSaveCardStatus('saving');
      setSaveCardErrorMessage(null);
      try {
        while (draftDirtyRef.current || hasDirtyProfileDraft()) {
          await saveLatestDraftRef.current();
        }
        setSaveCardStatus('saved');
        return true;
      } catch (error) {
        setSaveCardStatus('failed');
        setSaveCardErrorMessage(error instanceof Error ? error.message : 'Could not save Card.');
        return false;
      } finally {
        cardSaveInFlightRef.current = null;
      }
    });
    cardSaveInFlightRef.current = save;
    return save;
  }, [hasDirtyProfileDraft]);

  useEffect(() => {
    if (!draftDirtyRef.current && !hasDirtyProfileDraft()) return;
    const timer = window.setTimeout(() => { void flushCardDraft(); }, 350);
    return () => window.clearTimeout(timer);
  }, [draftRevision, flushCardDraft, hasDirtyProfileDraft]);

  useEffect(() => {
    registerCardDraftFlush(flushCardDraft);
    return () => registerCardDraftFlush(null);
  }, [registerCardDraftFlush, flushCardDraft]);

  return {
    saveCardStatus,
    saveCardErrorMessage,
    markDraftDirty,
    markProfileDraftActivity,
    isHydrationBlocked,
  };
}
