import UploadAttachment from '../../../components/knowledge/UploadAttachment';
import type { DirectChatTarget } from './sharedChatClient';
import type { SharedCardRunInput } from './sharedChatTranscript';
import type { SharedCardChatColors } from './SharedCardChatMessage';
import type { SharedCardVoicePhase } from './useSharedCardVoice';
import { useSharedCardChatComposer } from './useSharedCardChatComposer';

type SharedCardChatComposerProps = {
  directChatTargets: DirectChatTarget[];
  onSend: (text: string, runInput?: SharedCardRunInput) => void;
  onKnowledgeUploaded?: () => void;
  knowledgeProjectId: string;
  colors: SharedCardChatColors;
  busy: boolean;
  connecting: boolean;
  error: string | null;
  voiceError: string | null;
  voicePhase: SharedCardVoicePhase;
  onVoiceStart?: () => void;
  onVoiceStop?: () => void;
  onStop?: () => void;
  draft?: string;
  onDraftChange?: (value: string) => void;
};

export function SharedCardChatComposer({
  directChatTargets, onSend, onKnowledgeUploaded, knowledgeProjectId, colors,
  busy, connecting, error, voiceError, voicePhase,
  onVoiceStart, onVoiceStop, onStop, draft, onDraftChange,
}: SharedCardChatComposerProps) {
  const composer = useSharedCardChatComposer({
    directChatTargets, onSend, busy, connecting, knowledgeProjectId, draft, onDraftChange,
  });
  const voiceIdle = voicePhase === 'idle' || voicePhase === 'error';
  const visibleError = composer.imageError || error || voiceError;

  return (
    <div className="px-4 pb-4">
      {visibleError ? (
        <div
          data-testid="shared-card-chat-error"
          role="status"
          style={{
            color: '#FF9B9B', fontSize: 12, lineHeight: 1.35,
            padding: '0 6px 8px', overflowWrap: 'anywhere',
          }}
        >
          {String(visibleError)}
        </div>
      ) : null}
      {composer.images.length ? (
        <div
          data-testid="shared-card-chat-images"
          className="shared-card-chat-composer"
          style={{
            display: 'flex', flexWrap: 'wrap', gap: 8, padding: '5px 5px 8px',
            maxHeight: 144, overflowY: 'auto',
          }}
        >
          {composer.images.map((image, index) => (
            <div key={`${image.name}:${index}`} style={{ position: 'relative', width: 64, height: 64 }}>
              <img
                src={image.dataUrl}
                alt={image.name}
                style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 9 }}
              />
              <button
                type="button"
                aria-label={`Remove ${image.name}`}
                disabled={composer.interactionDisabled}
                onClick={() => composer.removeImage(index)}
                style={{
                  position: 'absolute', top: -5, right: -5, width: 22, height: 22,
                  borderRadius: '50%', background: colors.panel,
                  border: `1px solid ${colors.border}`, color: colors.text,
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div
        ref={composer.composerRef}
        className="flex items-end gap-2"
        style={{
          position: 'relative', borderRadius: 15, background: colors.panel,
          border: `1px solid ${colors.border}`,
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)',
          padding: '5px 6px 5px 7px',
        }}
      >
        <UploadAttachment knowledgeProjectId={knowledgeProjectId} disabled={!knowledgeProjectId}
          appearance="chat-inline" onUploaded={onKnowledgeUploaded} />
        <input
          ref={composer.imageInputRef}
          type="file"
          multiple
          accept={composer.imageTypes.join(',')}
          aria-label="Image files"
          style={{ display: 'none' }}
          onChange={composer.selectImageFiles}
        />
        <button
          type="button"
          aria-label="Attach images"
          title="Attach images"
          disabled={composer.interactionDisabled || composer.readingImages}
          onClick={() => composer.imageInputRef.current?.click()}
          style={{
            width: 30, height: 40, flex: '0 0 auto', border: 0,
            background: 'transparent', color: colors.text,
            opacity: composer.readingImages ? 0.5 : 1,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <circle cx="8" cy="8" r="1.5" />
            <path d="m3 16 5-5 4 4 4-5 5 6" />
          </svg>
        </button>
        <textarea
          ref={composer.inputRef}
          rows={1}
          data-testid="shared-card-chat-input"
          value={composer.value}
          onChange={(event) => composer.setValue(event.target.value)}
          onPaste={composer.pasteImages}
          disabled={composer.interactionDisabled}
          onKeyDown={composer.handleKeyDown}
          aria-label="Message"
          className="shared-card-chat-composer flex-1"
          style={{
            boxSizing: 'border-box', minWidth: 0, width: '100%', minHeight: 40,
            resize: 'none', overflowX: 'hidden', whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere', background: 'transparent', border: 'none',
            outline: 'none', padding: '10px 7px', color: colors.text,
            fontSize: 14, lineHeight: 1.25,
          }}
        />
        {composer.addressSuggestions.length > 0 ? (
          <div
            data-testid="shared-card-chat-address-suggestions"
            role="listbox"
            aria-label="Available agents"
            style={{
              position: 'absolute', left: 48, right: 52, bottom: 'calc(100% + 7px)',
              zIndex: 20, padding: 5, borderRadius: 11,
              background: 'rgba(20,22,26,0.98)', border: `1px solid ${colors.border}`,
              boxShadow: '0 12px 32px rgba(0,0,0,0.42)',
            }}
          >
            {composer.addressSuggestions.map((agent, index) => (
              <button
                key={agent.cardId}
                type="button"
                role="option"
                aria-selected={index === composer.boundedAddressIndex}
                data-testid={`shared-card-chat-address-${agent.address}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  composer.completeAddress(index);
                }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center',
                  justifyContent: 'space-between', gap: 12, padding: '8px 10px',
                  border: 0, borderRadius: 8,
                  background: index === composer.boundedAddressIndex
                    ? 'rgba(79,162,173,0.18)' : 'transparent',
                  color: colors.text, cursor: 'pointer', textAlign: 'left',
                }}
              >
                <span style={{ fontWeight: 700 }}>@{agent.address}</span>
                <span style={{ color: colors.neutral, fontSize: 11 }}>{agent.title}</span>
              </button>
            ))}
          </div>
        ) : null}
        {busy ? (
          <span
            data-testid="shared-card-chat-active-indicator"
            aria-hidden="true"
            style={{
              width: 8, height: 8, borderRadius: '50%', background: colors.primary,
              animation: 'shared-card-chat-active-pulse 1.1s ease-in-out infinite',
            }}
          />
        ) : null}
        {busy && onStop ? (
          <button type="button" data-testid="shared-card-chat-stop" onClick={onStop}>
            Stop
          </button>
        ) : null}
        {onVoiceStart && onVoiceStop ? (
          <button
            type="button"
            data-testid="shared-card-chat-voice"
            aria-label={voiceIdle
              ? 'Start voice'
              : voicePhase === 'listening' ? 'Stop and transcribe voice' : 'Stop voice'}
            title={voiceIdle
              ? 'Start voice'
              : voicePhase === 'listening'
                ? 'Listening'
                : voicePhase === 'processing' ? 'Processing voice' : 'Speaking'}
            onClick={voiceIdle ? onVoiceStart : onVoiceStop}
            disabled={composer.interactionDisabled}
            className="rounded-full flex items-center justify-center"
            style={{
              width: 34, height: 34, flex: '0 0 auto',
              border: voicePhase === 'listening'
                ? '1px solid rgba(255,130,130,0.72)'
                : `1px solid ${colors.border}`,
              background: voicePhase === 'idle'
                ? 'transparent'
                : voicePhase === 'error'
                  ? 'rgba(255,105,105,0.10)' : 'rgba(79,162,173,0.14)',
              color: voicePhase === 'listening' ? '#FF9B9B' : colors.text,
              cursor: composer.interactionDisabled ? 'not-allowed' : 'pointer',
              opacity: composer.interactionDisabled ? 0.45 : 1,
              boxShadow: voicePhase === 'listening'
                ? '0 0 0 4px rgba(255,130,130,0.08)' : 'none',
            }}
          >
            <svg
              width="17" height="17" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"
              strokeLinejoin="round" aria-hidden="true"
            >
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
              <path d="M12 18v3" />
              <path d="M9 21h6" />
            </svg>
          </button>
        ) : null}
        <button
          onClick={composer.send}
          disabled={composer.interactionDisabled || composer.readingImages}
          aria-label="Send"
          className="rounded-full flex items-center justify-center"
          style={{
            width: 40, height: 40,
            background: composer.interactionDisabled ? colors.neutral : colors.primary,
            border: '1px solid rgba(79,162,173,0.36)',
            boxShadow: '0 8px 18px rgba(79,162,173,0.10), inset 0 1px 0 rgba(255,255,255,0.14)',
            cursor: composer.interactionDisabled ? 'not-allowed' : 'pointer',
          }}
        >
          <svg
            width="19" height="19" viewBox="0 0 24 24" fill="none"
            stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          >
            <path d="M12 19V5" />
            <path d="M5 12l7-7 7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}
