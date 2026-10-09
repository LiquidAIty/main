import type { DirectChatTarget } from './sharedChatClient';
import { SharedCardChatComposer } from './SharedCardChatComposer';
import type {
  SharedCardChatColors,
  SharedCardChatDisplayMessage,
} from './SharedCardChatMessage';
import { SharedCardChatViewport } from './SharedCardChatViewport';
import type { SharedCardRunInput } from './sharedChatTranscript';
import type { SharedCardVoicePhase } from './useSharedCardVoice';
import type {
  CanonicalSubjectFocusTarget,
  CanonicalSubjectMatcher,
} from '../../../components/knowledge/canonicalSubjectLinks';

type SharedCardChatProps = {
  messages: SharedCardChatDisplayMessage[];
  /** Main is the ambient voice of this chat; only directly addressed non-Main Cards need a label. */
  mainCardId?: string;
  directChatTargets?: DirectChatTarget[];
  onSend: (text: string, runInput?: SharedCardRunInput) => void;
  onKnowledgeUploaded?: () => void;
  knowledgeProjectId: string;
  colors: SharedCardChatColors;
  /** The real Hermes turn is still open; the composer remains available. */
  busy?: boolean;
  /** The request is connecting to the saved Card's Hermes session. */
  connecting?: boolean;
  /** Visible transport/configuration failure; never represented as assistant speech. */
  error?: string | null;
  voiceError?: string | null;
  voicePhase?: SharedCardVoicePhase;
  onVoiceStart?: () => void;
  onVoiceStop?: () => void;
  onStop?: () => void;
  draft?: string;
  onDraftChange?: (value: string) => void;
  subjectMatcher?: CanonicalSubjectMatcher | null;
  onSubjectFocus?: (target: CanonicalSubjectFocusTarget) => void;
};

export default function SharedCardChat({
  messages,
  mainCardId,
  directChatTargets = [],
  onSend,
  onKnowledgeUploaded,
  knowledgeProjectId,
  colors,
  busy = false,
  connecting = false,
  error = null,
  voiceError = null,
  voicePhase = 'idle',
  onVoiceStart,
  onVoiceStop,
  onStop,
  draft,
  onDraftChange,
  subjectMatcher,
  onSubjectFocus,
}: SharedCardChatProps) {
  return (
    <div data-testid="shared-card-chat-panel" className="h-full flex flex-col" style={{ gap: 12 }}>
      <style>
        {`
          .shared-card-chat-scroll {
            scrollbar-width: thin;
            scrollbar-color: #4E4E4E transparent;
          }
          .shared-card-chat-scroll::-webkit-scrollbar { width: 7px; }
          .shared-card-chat-scroll::-webkit-scrollbar-track { background: transparent; }
          .shared-card-chat-scroll::-webkit-scrollbar-thumb {
            background: #4E4E4E;
            border-radius: 999px;
            border: 1px solid rgba(0, 0, 0, 0.25);
          }
          .shared-card-chat-scroll::-webkit-scrollbar-thumb:hover {
            background: #616161;
          }
          .shared-card-chat-composer { scrollbar-width: none; }
          .shared-card-chat-composer::-webkit-scrollbar { display: none; }
          @keyframes shared-card-chat-active-pulse {
            0%, 100% { opacity: 0.3; transform: scale(0.82); }
            50% { opacity: 1; transform: scale(1); }
          }
        `}
      </style>
      <SharedCardChatViewport
        messages={messages}
        mainCardId={mainCardId}
        colors={colors}
        subjectMatcher={subjectMatcher}
        onSubjectFocus={onSubjectFocus}
      />
      <SharedCardChatComposer
        directChatTargets={directChatTargets}
        onSend={onSend}
        onKnowledgeUploaded={onKnowledgeUploaded}
        knowledgeProjectId={knowledgeProjectId}
        colors={colors}
        busy={busy}
        connecting={connecting}
        error={error}
        voiceError={voiceError}
        voicePhase={voicePhase}
        onVoiceStart={onVoiceStart}
        onVoiceStop={onVoiceStop}
        onStop={onStop}
        draft={draft}
        onDraftChange={onDraftChange}
      />
    </div>
  );
}
