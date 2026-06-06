const fs = require('fs');
let code = fs.readFileSync('client/src/pages/agentbuilder.tsx', 'utf8');

// remove import
code = code.replace(/import \{ draftMissionSpecFromChat \} from '\.\.\/components\/builder\/chatPlanCompanion';\r?\n/, '');

// remove startPlanDraftFromChat definition
let startIdx = code.indexOf('  const startPlanDraftFromChat = useCallback(');
if (startIdx !== -1) {
  let endIdx = code.indexOf('  const handleSend = (t: string) => {');
  code = code.substring(0, startIdx) + code.substring(endIdx);
}

// replace handleSend
let handleSendStart = code.indexOf('  const handleSend = (t: string) => {');
let handleSendEnd = code.indexOf('  const planMissionGraphSeed = useMemo(() => {');
if (handleSendStart !== -1 && handleSendEnd !== -1) {
  const newHandleSend = `  const handleSend = (t: string) => {
    const trimmed = t.trim();
    if (!trimmed) return;
    if (sending || deckRunBusy || cardRunBusy || deckLoadBusy) return;
    if (!canvasProjectId) {
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          text: 'Select or create a project before running chat tasks.',
        },
      ]);
      return;
    }
    const interactionId = createWorkspaceTestingInteractionId('chat');
    const sendStartedAt = Date.now();
    const turnId = \`assist:\${Date.now()}:\${uid()}\`;
    chatLoopTelemetryRef.current = {
      interactionId,
      sendStartedAt,
      responseReceivedAt: null,
      refreshRecorded: false,
    };
    emitWorkspaceTestingEvent({
      event: 'chat_send_started',
      interactionId,
      surface:
        largeSurface === 'chat' ? 'chat' : normalizeWorkspaceSurface(tab),
      surfaceRole: largeSurface === 'chat' ? 'large' : 'companion',
      metadata: {
        messageLength: trimmed.length,
        responseMode: 'blocked_honest',
        turnId,
        workspaceView: activeDeckWorkspaceContext.workspaceView,
        objectEditorOpen: activeDeckWorkspaceContext.objectEditor.open,
        objectEditorCardId:
          activeDeckWorkspaceContext.objectEditor.selectedCardId,
        objectEditorTab: activeDeckWorkspaceContext.objectEditor.activeTab,
      },
    });

    setMessages((m) => [...m, { role: 'user', text: trimmed }]);
    
    setTimeout(() => {
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          text: 'Magentic-One ordinary conversational chat path is not yet wired to the backend graph runtime. Real plan requests and approval runs require the backend conductor. Use \\'Run Approved Mission\\' to execute the existing plan if one is ready.',
        },
      ]);
      const responseReceivedAt = Date.now();
      chatLoopTelemetryRef.current = {
        interactionId,
        sendStartedAt,
        responseReceivedAt,
        refreshRecorded: true,
      };
      emitWorkspaceTestingEvent({
        event: 'chat_response_received',
        interactionId,
        durationMs: Math.max(0, responseReceivedAt - sendStartedAt),
        surface: largeSurface === 'chat' ? 'chat' : normalizeWorkspaceSurface(tab),
        surfaceRole: largeSurface === 'chat' ? 'large' : 'companion',
        metadata: {
          responseMode: 'blocked_honest',
          turnId,
          ok: true,
        },
      });
    }, 100);
  };

`;
  code = code.substring(0, handleSendStart) + newHandleSend + code.substring(handleSendEnd);
}

fs.writeFileSync('client/src/pages/agentbuilder.tsx', code);
