import { useCallback, useRef, useState } from 'react';

import {
  blankCardInspectorScript,
  type CardInspectorScript,
} from './cardInspectorDraftPayload';

export function useCardInspectorScriptDraft({
  cardId,
  savedScript,
  markDraftDirty,
}: {
  cardId: string;
  savedScript?: CardInspectorScript | null;
  markDraftDirty(): void;
}) {
  const [scriptDraft, setScriptDraft] = useState<CardInspectorScript>(blankCardInspectorScript);
  const scriptDraftCacheRef = useRef<Map<string, CardInspectorScript>>(new Map());
  const dirtyScriptCardsRef = useRef<Set<string>>(new Set());

  const hydrateFromSaved = useCallback(() => {
    const nextSavedScript = savedScript
      ? structuredClone(savedScript)
      : blankCardInspectorScript();
    const cachedScript = scriptDraftCacheRef.current.get(cardId);
    const preserveUnsavedScript = Boolean(
      cachedScript
      && dirtyScriptCardsRef.current.has(cardId)
      && cachedScript.source !== nextSavedScript.source,
    );
    if (preserveUnsavedScript && cachedScript) {
      setScriptDraft(structuredClone(cachedScript));
      return;
    }
    scriptDraftCacheRef.current.set(cardId, structuredClone(nextSavedScript));
    dirtyScriptCardsRef.current.delete(cardId);
    setScriptDraft(nextSavedScript);
  }, [cardId, savedScript]);

  const changeScript = useCallback((next: CardInspectorScript) => {
    const changed = !savedScript
      ? Boolean(next.source.trim())
      : next.source !== savedScript.source;
    const nextDraft = {
      ...next,
      version: changed
        ? Number(savedScript?.version || 0) + 1
        : Number(savedScript?.version || next.version || 1),
      author: changed ? { kind: 'user', id: 'card-editor' } : (next.author || {}),
    };
    scriptDraftCacheRef.current.set(cardId, structuredClone(nextDraft));
    if (changed) dirtyScriptCardsRef.current.add(cardId);
    else dirtyScriptCardsRef.current.delete(cardId);
    setScriptDraft(nextDraft);
    markDraftDirty();
  }, [cardId, savedScript, markDraftDirty]);

  return {
    scriptDraft,
    hydrateFromSaved,
    changeScript,
  };
}
