import { useCallback, useEffect, useRef, useState } from 'react';

import {
  applyHermesCardOperation,
  loadHermesCardProfile,
  loadHermesLearningDetail,
  testHermesMcp,
  type HermesCardProfileView,
} from '../features/agentbuilder/hermesCardProfile';

type HermesLearningDetail = {
  kind: 'memory' | 'skill';
  id: string;
  label: string;
  content: string;
};

type ProfileDraftSnapshot = {
  revision: number;
  readback: HermesCardProfileView | null;
  learningEdits: Array<[string, string]>;
  dirty: boolean;
};

export function useCardInspectorHermesProfile({
  projectId,
  deckId,
  cardId,
  onDraftDirty,
}: {
  projectId: string;
  deckId: string;
  cardId: string;
  onDraftDirty(): void;
}) {
  const [profileState, setProfileState] = useState<HermesCardProfileView | null>(null);
  const [profileStatus, setProfileStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [profileError, setProfileError] = useState<string | null>(null);
  const [learningDetail, setLearningDetail] = useState<HermesLearningDetail | null>(null);
  const [learningDraft, setLearningDraft] = useState('');
  const [learningStatus, setLearningStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [learningError, setLearningError] = useState<string | null>(null);
  const [mcpChecks, setMcpChecks] = useState<Record<string, {
    status: 'checking' | 'connected' | 'failed';
    toolCount: number;
    error: string | null;
  }>>({});
  const profileDraftRevisionRef = useRef(0);
  const profileDraftDirtyRef = useRef(false);
  const profileReadbackRef = useRef<HermesCardProfileView | null>(null);
  const learningEditsRef = useRef(new Map<string, string>());

  const acceptProfileReadback = useCallback((state: HermesCardProfileView | null) => {
    profileReadbackRef.current = state;
    setProfileState(state);
    if (!state) {
      setLearningDetail(null);
      setLearningDraft('');
      setLearningStatus('idle');
      setLearningError(null);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    acceptProfileReadback(null);
    setProfileStatus('loading');
    setProfileError(null);
    setLearningDetail(null);
    setLearningDraft('');
    setLearningStatus('idle');
    setLearningError(null);
    void loadHermesCardProfile({ projectId, deckId, cardId, signal: controller.signal })
      .then((state) => {
        if (controller.signal.aborted) return;
        acceptProfileReadback(state);
        setProfileStatus('ready');
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        acceptProfileReadback(null);
        setProfileStatus('failed');
        setProfileError(error instanceof Error ? error.message : 'Profile unavailable.');
      });
    return () => controller.abort();
  // Hermes profile readback is identity-scoped and deliberately independent from
  // unsaved Card drafts. Card save never mutates the bound profile.
  }, [projectId, deckId, cardId, acceptProfileReadback]);

  const openLearningNode = useCallback(async (nodeId: string) => {
    setLearningStatus('loading');
    setLearningError(null);
    try {
      const detail = await loadHermesLearningDetail({ projectId, deckId, cardId, nodeId });
      setLearningDetail(detail);
      setLearningDraft(learningEditsRef.current.get(nodeId) ?? detail.content);
      setLearningStatus('ready');
    } catch (error) {
      setLearningStatus('failed');
      setLearningError(error instanceof Error ? error.message : 'Hermes learning node unavailable.');
    }
  }, [projectId, deckId, cardId]);

  const changeLearningDraft = useCallback((value: string) => {
    setLearningDraft(value);
    if (!learningDetail) return;
    learningEditsRef.current.set(learningDetail.id, value);
    profileDraftDirtyRef.current = true;
    profileDraftRevisionRef.current += 1;
    onDraftDirty();
  }, [learningDetail, onDraftDirty]);

  const checkMcpServer = useCallback(async (serverName: string) => {
    setMcpChecks((current) => ({
      ...current,
      [serverName]: { status: 'checking', toolCount: 0, error: null },
    }));
    try {
      const result = await testHermesMcp({ projectId, deckId, cardId, serverName });
      setMcpChecks((current) => ({
        ...current,
        [serverName]: {
          status: result.ok ? 'connected' : 'failed',
          toolCount: result.tools.length,
          error: result.error,
        },
      }));
    } catch (error) {
      setMcpChecks((current) => ({
        ...current,
        [serverName]: {
          status: 'failed',
          toolCount: 0,
          error: error instanceof Error ? error.message : 'Connection check failed.',
        },
      }));
    }
  }, [projectId, deckId, cardId]);

  const hasDirtyDraft = useCallback(() => profileDraftDirtyRef.current, []);

  const captureDraft = useCallback((): ProfileDraftSnapshot => {
    const snapshot = {
      revision: profileDraftRevisionRef.current,
      readback: profileReadbackRef.current,
      learningEdits: [...learningEditsRef.current],
      dirty: profileDraftDirtyRef.current,
    };
    if (snapshot.dirty && !snapshot.readback) {
      throw new Error('Hermes profile unavailable.');
    }
    return snapshot;
  }, []);

  const saveCapturedDraft = useCallback(async (snapshot: ProfileDraftSnapshot) => {
    if (!snapshot.dirty) return;
    let latestReadback = snapshot.readback;
    for (const [id, content] of snapshot.learningEdits) {
      latestReadback = await applyHermesCardOperation({ projectId, deckId, cardId,
        change: { method: 'learning.edit', params: { id, content } } });
      profileReadbackRef.current = latestReadback;
      setProfileState(latestReadback);
      if (learningEditsRef.current.get(id) === content) learningEditsRef.current.delete(id);
    }
    if (profileDraftRevisionRef.current === snapshot.revision) {
      profileDraftDirtyRef.current = false;
      if (latestReadback) acceptProfileReadback(latestReadback);
    }
  }, [projectId, deckId, cardId, acceptProfileReadback]);

  return {
    profileState,
    profileStatus,
    profileError,
    learningDetail,
    learningDraft,
    learningStatus,
    learningError,
    mcpChecks,
    openLearningNode,
    changeLearningDraft,
    checkMcpServer,
    hasDirtyDraft,
    captureDraft,
    saveCapturedDraft,
  };
}
