import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";

import type { DirectChatTarget } from "../../features/agentbuilder/console/mainSessionClient";
import {
  MAX_MAIN_CHAT_IMAGES,
  type MainChatRunInput,
  type MainChatVoicePhase,
} from "../../features/agentbuilder/console/useAgentBuilderMainChat";
import UploadAttachment from "../knowledge/UploadAttachment";
import {
  prepareChatBubbleText,
  tightChatBubbleTextWidth,
} from "./pretextBubbleLayout";
import type {
  CanonicalSubjectFocusTarget,
  CanonicalSubjectMatcher,
} from "./canonicalSubjectLinks";

type BuilderChatColors = {
  primary: string;
  bg: string;
  panel: string;
  border: string;
  text: string;
  neutral: string;
};

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

/** Render ordinary Card output without a research-specific response protocol. */
export function chatDisplayText(value: unknown): string {
  return safeText(value);
}

type BuilderChatMessage = {
  role: "assistant" | "user";
  text: string;
  speaker: { kind: "user" | "card"; label: string; cardId?: string; profile?: string; address?: string };
  target?: { kind: "user" | "card"; label: string; cardId?: string; profile?: string; address?: string };
  status?: "pending" | "complete" | "error";
};

function shouldRenderMessage(message: BuilderChatMessage): boolean {
  return message.role !== "assistant" || Boolean(safeText(message.text).trim());
}

type ComposerImage = { name: string; mediaType: string; dataUrl: string; kind: "user-upload" };
const COMPOSER_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_COMPOSER_IMAGE_BYTES = 10 * 1024 * 1024;
const MESSAGE_LANE_MAX_WIDTH = 760;

export const CANONICAL_SUBJECT_LINK_STYLE = Object.freeze({
  display: "inline",
  margin: 0,
  padding: 0,
  border: 0,
  background: "transparent",
  color: "#A7B0BA",
  cursor: "pointer",
  font: "inherit",
  fontStyle: "italic",
  letterSpacing: "inherit",
  lineHeight: "inherit",
  textAlign: "inherit",
  textDecoration: "underline",
  textDecorationStyle: "dotted",
  textUnderlineOffset: 3,
} as const);

function readComposerImage(file: File): Promise<ComposerImage> {
  if (!COMPOSER_IMAGE_TYPES.includes(file.type)) {
    return Promise.reject(new Error("Choose a PNG, JPEG, WebP or GIF image."));
  }
  if (file.size < 1 || file.size > MAX_COMPOSER_IMAGE_BYTES) {
    return Promise.reject(new Error("Each image must be between 1 byte and 10 MB."));
  }
  const name = (file.name || "image.png").trim();
  if (name.length > 200 || /[\\/]/.test(name)) {
    return Promise.reject(new Error("The image filename must be at most 200 characters without path separators."));
  }
  if (!/\.(png|jpe?g|webp|gif)$/i.test(name)) {
    return Promise.reject(new Error("Use a PNG, JPEG, WebP or GIF filename."));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${name}.`));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error(`Could not read ${name}.`));
        return;
      }
      resolve({ name, mediaType: file.type, dataUrl: reader.result, kind: "user-upload" });
    };
    reader.readAsDataURL(file);
  });
}

export function followLatestOutput(atBottom: boolean): "auto" | false {
  return atBottom ? "auto" : false;
}

function linkedChatText(
  text: string,
  role: BuilderChatMessage["role"],
  subjectMatcher: CanonicalSubjectMatcher | null | undefined,
  onSubjectFocus: ((target: CanonicalSubjectFocusTarget) => void) | undefined,
  keyPrefix: string,
): ReactNode[] {
  const segments = subjectMatcher?.segmentMessage(role, text) || [{ text }];
  return segments.map((segment, index) => segment.target && onSubjectFocus ? (
    <button
      key={`${keyPrefix}:subject:${index}`}
      type="button"
      aria-label={`Open ${segment.text} in graph`}
      onClick={() => onSubjectFocus(segment.target!)}
      style={CANONICAL_SUBJECT_LINK_STYLE}
    >
      {segment.text}
    </button>
  ) : <Fragment key={`${keyPrefix}:text:${index}`}>{segment.text}</Fragment>);
}

function safeMarkdownUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function inlineChatMarkdown(
  text: string,
  role: BuilderChatMessage["role"],
  subjectMatcher: CanonicalSubjectMatcher | null | undefined,
  onSubjectFocus: ((target: CanonicalSubjectFocusTarget) => void) | undefined,
  keyPrefix: string,
): ReactNode[] {
  const output: ReactNode[] = [];
  let cursor = 0;
  let token = 0;
  const pushText = (value: string) => {
    if (!value) return;
    output.push(...linkedChatText(
      value, role, subjectMatcher, onSubjectFocus, `${keyPrefix}:${token++}`,
    ));
  };
  while (cursor < text.length) {
    if (text[cursor] === '\\' && cursor + 1 < text.length
      && ['*', '_', '`', '\\'].includes(text[cursor + 1])) {
      pushText(text[cursor + 1]);
      cursor += 2;
      continue;
    }
    if (text.startsWith('**', cursor)) {
      const close = text.indexOf('**', cursor + 2);
      if (close > cursor + 2) {
        const current = token++;
        output.push(<strong key={`${keyPrefix}:strong:${current}`}>
          {inlineChatMarkdown(
            text.slice(cursor + 2, close), role, subjectMatcher, onSubjectFocus,
            `${keyPrefix}:strong:${current}`,
          )}
        </strong>);
        cursor = close + 2;
        continue;
      }
    }
    if (text[cursor] === '*' || text[cursor] === '_') {
      const marker = text[cursor];
      const close = text.indexOf(marker, cursor + 1);
      if (close > cursor + 1) {
        const current = token++;
        output.push(<em key={`${keyPrefix}:em:${current}`}>
          {inlineChatMarkdown(
            text.slice(cursor + 1, close), role, subjectMatcher, onSubjectFocus,
            `${keyPrefix}:em:${current}`,
          )}
        </em>);
        cursor = close + 1;
        continue;
      }
    }
    if (text[cursor] === '`') {
      const close = text.indexOf('`', cursor + 1);
      if (close > cursor + 1) {
        output.push(<code key={`${keyPrefix}:code:${token++}`}>
          {text.slice(cursor + 1, close)}
        </code>);
        cursor = close + 1;
        continue;
      }
    }
    if (text[cursor] === '[') {
      const labelEnd = text.indexOf('](', cursor + 1);
      const urlEnd = labelEnd >= 0 ? text.indexOf(')', labelEnd + 2) : -1;
      if (labelEnd > cursor + 1 && urlEnd > labelEnd + 2) {
        const url = safeMarkdownUrl(text.slice(labelEnd + 2, urlEnd));
        if (url) {
          output.push(<a key={`${keyPrefix}:link:${token++}`} href={url}
            target="_blank" rel="noreferrer">
            {inlineChatMarkdown(
              text.slice(cursor + 1, labelEnd), role, subjectMatcher,
              onSubjectFocus, `${keyPrefix}:link-label`,
            )}
          </a>);
          cursor = urlEnd + 1;
          continue;
        }
      }
    }
    const next = [
      text.indexOf('\\', cursor + 1),
      text.indexOf('*', cursor + 1),
      text.indexOf('_', cursor + 1),
      text.indexOf('`', cursor + 1),
      text.indexOf('[', cursor + 1),
    ].filter(index => index >= 0).sort((left, right) => left - right)[0] ?? text.length;
    pushText(text.slice(cursor, next));
    cursor = next;
  }
  return output;
}

function renderChatMarkdown(
  text: string,
  role: BuilderChatMessage["role"],
  subjectMatcher: CanonicalSubjectMatcher | null | undefined,
  onSubjectFocus: ((target: CanonicalSubjectFocusTarget) => void) | undefined,
): ReactNode[] {
  const lines = text.split('\n');
  return lines.flatMap((rawLine, index) => {
    const heading = /^(#{1,6})\s+(.+)$/.exec(rawLine);
    const bullet = /^\s*[-*]\s+(.+)$/.exec(rawLine);
    const content = heading?.[2] ?? bullet?.[1] ?? rawLine;
    const inline = inlineChatMarkdown(
      content, role, subjectMatcher, onSubjectFocus, `line:${index}`,
    );
    const line = heading
      ? <strong key={`line:${index}:heading`}>{inline}</strong>
      : bullet
        ? <span key={`line:${index}:bullet`}><span aria-hidden="true">• </span>{inline}</span>
        : <Fragment key={`line:${index}:plain`}>{inline}</Fragment>;
    return index < lines.length - 1 ? [line, <br key={`line:${index}:break`} />] : [line];
  });
}

function BuilderChatMessageBubble({
  colors,
  laneWidth,
  mainCardId,
  message,
  subjectMatcher,
  onSubjectFocus,
}: {
  colors: BuilderChatColors;
  laneWidth: number | null;
  mainCardId?: string;
  message: BuilderChatMessage;
  subjectMatcher?: CanonicalSubjectMatcher | null;
  onSubjectFocus?: (target: CanonicalSubjectFocusTarget) => void;
}) {
  const text = chatDisplayText(message.text);
  const isUser = message.role !== "assistant";
  const horizontalPadding = isUser ? 30 : 32;
  const maximumBubbleWidth = laneWidth == null
    ? null
    : Math.max(
        horizontalPadding + 1,
        Math.min(isUser ? 560 : 640, laneWidth * (isUser ? 0.82 : 0.92)),
      );
  const measurementEnabled = laneWidth != null;
  const prepared = useMemo(
    () => measurementEnabled ? prepareChatBubbleText(text) : null,
    [measurementEnabled, text],
  );
  const measuredContentWidth = useMemo(
    () => tightChatBubbleTextWidth(
      prepared,
      maximumBubbleWidth == null ? 0 : maximumBubbleWidth - horizontalPadding,
    ),
    [maximumBubbleWidth, prepared],
  );
  const measuredBubbleWidth = measuredContentWidth == null
    ? null
    : Math.ceil(measuredContentWidth + horizontalPadding);
  const showSpeaker = !isUser
    && Boolean(message.speaker.cardId)
    && message.speaker.cardId !== mainCardId;
  const speakerAddress = safeText(message.speaker.address || message.speaker.label)
    .replace(/^@/, "");

  return (
    <div
      style={{
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
        width: "100%",
      }}
    >
      <div
        data-testid="builder-chat-message-frame"
        style={{
          maxWidth: isUser ? "min(82%, 560px)" : "min(92%, 640px)",
          width: measuredBubbleWidth == null ? "fit-content" : measuredBubbleWidth,
        }}
      >
        {showSpeaker ? (
          <div
            data-testid="builder-chat-speaker"
            style={{
              color: message.status === "error" ? "#FF9B9B" : colors.neutral,
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: "0.04em",
              margin: "0 6px 5px",
              textTransform: "uppercase",
              textAlign: "left",
            }}
          >
            @{speakerAddress}
          </div>
        ) : null}
        <div
          style={{
            boxSizing: "border-box",
            width: "100%",
            padding: isUser ? "11px 15px 12px 15px" : "11px 16px 12px 16px",
            color: colors.text,
            whiteSpace: "pre-wrap",
            overflowWrap: "break-word",
            wordBreak: "normal",
            lineHeight: 1.55,
            fontSize: 13.5,
            letterSpacing: "-0.01em",
            borderRadius: isUser
              ? "16px 16px 5px 16px"
              : "16px 16px 16px 6px",
            background: isUser
              ? "linear-gradient(165deg, rgba(52,56,62,0.98) 0%, rgba(36,40,46,0.99) 55%, rgba(30,34,40,1) 100%)"
              : "linear-gradient(180deg, rgba(28,30,34,0.55) 0%, rgba(22,24,28,0.72) 100%)",
            border: isUser
              ? "1px solid rgba(79,162,173,0.22)"
              : "1px solid rgba(255,255,255,0.06)",
            boxShadow: isUser
              ? "inset 0 1px 0 rgba(255,255,255,0.07), 0 1px 0 rgba(0,0,0,0.35), 0 10px 28px rgba(0,0,0,0.22), 0 0 0 1px rgba(79,162,173,0.06)"
              : "inset 0 1px 0 rgba(255,255,255,0.04), inset 0 -1px 0 rgba(0,0,0,0.18), 0 4px 18px rgba(0,0,0,0.14)",
          }}
        >
          {isUser
            ? text
            : renderChatMarkdown(text, message.role, subjectMatcher, onSubjectFocus)}
        </div>
      </div>
    </div>
  );
}

export default function BuilderChat({
  messages,
  mainCardId,
  directChatTargets = [],
  onSend,
  knowledgeProjectId,
  colors,
  busy = false,
  connecting = false,
  historyLoading = false,
  error = null,
  voiceError = null,
  voicePhase = "idle",
  onVoiceStart,
  onVoiceStop,
  onStop,
  draft,
  onDraftChange,
  subjectMatcher,
  onSubjectFocus,
}: {
  messages: BuilderChatMessage[];
  /** Main is the ambient voice of this chat; only directly addressed non-Main Cards need a label. */
  mainCardId?: string;
  directChatTargets?: DirectChatTarget[];
  onSend: (t: string, runInput?: MainChatRunInput) => void;
  knowledgeProjectId: string;
  colors: BuilderChatColors;
  /** The real Hermes turn is still open; the composer remains available. */
  busy?: boolean;
  /** The request is connecting to the saved Card's Hermes session. */
  connecting?: boolean;
  /** Persisted conversation history is loading and reconciles with visible submissions by message ID. */
  historyLoading?: boolean;
  /** Visible transport/configuration failure; never represented as assistant speech. */
  error?: string | null;
  voiceError?: string | null;
  voicePhase?: MainChatVoicePhase;
  onVoiceStart?: () => void;
  onVoiceStop?: () => void;
  onStop?: () => void;
  draft?: string;
  onDraftChange?: (value: string) => void;
  subjectMatcher?: CanonicalSubjectMatcher | null;
  onSubjectFocus?: (target: CanonicalSubjectFocusTarget) => void;
}) {
  const [localDraft, setLocalDraft] = useState("");
  const [selectedAddressIndex, setSelectedAddressIndex] = useState(0);
  const [messageLaneWidth, setMessageLaneWidth] = useState<number | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [images, setImages] = useState<ComposerImage[]>([]);
  const [imageError, setImageError] = useState<string | null>(null);
  const [readingImages, setReadingImages] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const imageReadRef = useRef(false);
  const imageReadEpochRef = useRef(0);
  const interactionDisabled = false;
  useEffect(() => {
    imageReadEpochRef.current += 1;
    imageReadRef.current = false;
    setReadingImages(false);
    setImages([]);
    setImageError(null);
  }, [knowledgeProjectId]);
  const attachImages = async (files: File[]) => {
    if (!files.length || interactionDisabled || imageReadRef.current) return;
    if (files.length + images.length > MAX_MAIN_CHAT_IMAGES) {
      setImageError(`A message can include at most ${MAX_MAIN_CHAT_IMAGES} images.`);
      return;
    }
    const epoch = imageReadEpochRef.current;
    imageReadRef.current = true;
    setReadingImages(true);
    setImageError(null);
    try {
      const loaded = await Promise.all(files.map(readComposerImage));
      if (imageReadEpochRef.current === epoch) setImages((current) => [...current, ...loaded]);
    } catch (reason) {
      if (imageReadEpochRef.current === epoch) {
        setImageError(reason instanceof Error ? reason.message : "Could not attach the images.");
      }
    } finally {
      if (imageReadEpochRef.current === epoch) {
        imageReadRef.current = false;
        setReadingImages(false);
      }
    }
  };
  const value = draft === undefined ? localDraft : draft;
  const composerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const resizeComposer = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "0px";
    const maximumHeight = Math.max(40, Math.min(240, window.innerHeight * 0.35));
    const height = Math.min(maximumHeight, Math.max(40, input.scrollHeight));
    input.style.height = `${height}px`;
    input.style.overflowY = input.scrollHeight > height ? "auto" : "hidden";
  }, []);
  useLayoutEffect(resizeComposer, [resizeComposer, value]);
  useEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;
    let previousWidth = composer.clientWidth;
    const observer = typeof ResizeObserver === "function"
      ? new ResizeObserver(() => {
          const width = composer.clientWidth;
          if (width === previousWidth) return;
          previousWidth = width;
          resizeComposer();
        })
      : null;
    observer?.observe(composer);
    window.addEventListener("resize", resizeComposer);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", resizeComposer);
    };
  }, [resizeComposer]);
  const setValue = (next: string) => {
    if (draft === undefined) setLocalDraft(next);
    onDraftChange?.(next);
  };
  const addressMatch = /^@([a-z0-9_-]*)$/i.exec(value);
  const addressPrefix = addressMatch?.[1]?.toLowerCase() ?? null;
  const addressSuggestions = addressPrefix === null
    ? []
    : directChatTargets.filter((agent) => (
      Boolean(agent.address)
      &&
      agent.aliases.some((alias) => alias.toLowerCase().startsWith(addressPrefix))
    ));
  const boundedAddressIndex = addressSuggestions.length > 0
    ? Math.min(selectedAddressIndex, addressSuggestions.length - 1)
    : 0;
  useEffect(() => {
    setSelectedAddressIndex(0);
  }, [addressPrefix]);
  const completeAddress = (index = boundedAddressIndex) => {
    const agent = addressSuggestions[index];
    if (!agent?.address) return;
    setValue(`@${agent.address} `);
    setSelectedAddressIndex(0);
  };
  const messageViewportRef = useRef<HTMLDivElement>(null);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const renderableMessages = useMemo(
    () => messages.filter(shouldRenderMessage),
    [messages],
  );

  useEffect(() => {
    const viewport = messageViewportRef.current;
    if (!viewport || typeof ResizeObserver !== "function") return;
    const syncWidth = () => {
      // Pretext needs the actual text lane width. This observes the one
      // continuously-resizable chat viewport; Virtuoso remains the sole row
      // height/scroll measurement owner.
      const nextWidth = Math.max(
        0,
        Math.min(MESSAGE_LANE_MAX_WIDTH, viewport.clientWidth - 40),
      );
      setMessageLaneWidth((current) => current === nextWidth ? current : nextWidth);
    };
    syncWidth();
    const observer = new ResizeObserver(syncWidth);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  const renderMessage = useCallback((index: number, message: BuilderChatMessage) => (
    <div
      data-testid="builder-chat-message-row"
      style={{
        boxSizing: "border-box",
        width: "100%",
        maxWidth: MESSAGE_LANE_MAX_WIDTH + 40,
        margin: "0 auto",
        padding: `${index === 0 ? 16 : 7}px 20px ${
          index === renderableMessages.length - 1 ? 18 : 7
        }px`,
      }}
    >
      <BuilderChatMessageBubble
        colors={colors}
        laneWidth={messageLaneWidth}
        mainCardId={mainCardId}
        message={message}
        subjectMatcher={subjectMatcher}
        onSubjectFocus={onSubjectFocus}
      />
    </div>
  ), [
    colors,
    mainCardId,
    messageLaneWidth,
    onSubjectFocus,
    renderableMessages.length,
    subjectMatcher,
  ]);

  const returnToLatest = useCallback(() => {
    virtuosoRef.current?.scrollToIndex({
      index: "LAST",
      align: "end",
      behavior: "smooth",
    });
  }, []);

  const send = () => {
    if (!value.trim() || interactionDisabled || imageReadRef.current) return;
    if (images.length) onSend(value, { images });
    else onSend(value);
    setImages([]);
    setImageError(null);
    setValue("");
  };
  return (
    <div data-testid="builder-chat-panel" className="h-full flex flex-col" style={{ gap: 12 }}>
      <style>
        {`
          .builder-chat-scroll {
            scrollbar-width: thin;
            scrollbar-color: #4E4E4E transparent;
          }
          .builder-chat-scroll::-webkit-scrollbar { width: 7px; }
          .builder-chat-scroll::-webkit-scrollbar-track { background: transparent; }
          .builder-chat-scroll::-webkit-scrollbar-thumb {
            background: #4E4E4E;
            border-radius: 999px;
            border: 1px solid rgba(0, 0, 0, 0.25);
          }
          .builder-chat-scroll::-webkit-scrollbar-thumb:hover {
            background: #616161;
          }
          .builder-chat-composer { scrollbar-width: none; }
          .builder-chat-composer::-webkit-scrollbar { display: none; }
          @keyframes builder-chat-active-pulse {
            0%, 100% { opacity: 0.3; transform: scale(0.82); }
            50% { opacity: 1; transform: scale(1); }
          }
        `}
      </style>
      <div
        ref={messageViewportRef}
        data-testid="builder-chat-message-viewport"
        className="flex-1"
        style={{
          position: "relative",
          flex: "1 1 0",
          minHeight: 0,
        }}
      >
        <Virtuoso
          ref={virtuosoRef}
          data={renderableMessages}
          data-testid="builder-chat-message-list"
          className="builder-chat-scroll"
          style={{ height: "100%", width: "100%" }}
          alignToBottom
          initialTopMostItemIndex={{
            index: Math.max(0, renderableMessages.length - 1),
            align: "end",
          }}
          followOutput={followLatestOutput}
          atBottomStateChange={setIsAtBottom}
          computeItemKey={(index) => index}
          itemContent={renderMessage}
        />
        {!isAtBottom && renderableMessages.length > 0 ? (
          <button
            type="button"
            data-testid="builder-chat-return-to-latest"
            aria-label="Return to latest"
            title="Return to latest"
            onClick={returnToLatest}
            style={{
              position: "absolute",
              right: 16,
              bottom: 10,
              zIndex: 3,
              width: 32,
              height: 32,
              display: "grid",
              placeItems: "center",
              borderRadius: "50%",
              border: `1px solid ${colors.border}`,
              background: colors.panel,
              color: colors.text,
              boxShadow: "0 7px 18px rgba(0,0,0,0.28)",
              cursor: "pointer",
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 5v14" />
              <path d="m19 12-7 7-7-7" />
            </svg>
          </button>
        ) : null}
      </div>
      <div className="px-4 pb-4">
        {imageError || error || voiceError ? (
          <div
            data-testid="builder-chat-error"
            role="status"
            style={{
              color: "#FF9B9B",
              fontSize: 12,
              lineHeight: 1.35,
              padding: "0 6px 8px",
              overflowWrap: "anywhere",
            }}
          >
            {safeText(imageError || error || voiceError)}
          </div>
        ) : null}
        {images.length ? (
          <div data-testid="builder-chat-images" className="builder-chat-composer"
            style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "5px 5px 8px", maxHeight: 144, overflowY: "auto" }}>
            {images.map((image, index) => (
              <div key={`${image.name}:${index}`} style={{ position: "relative", width: 64, height: 64 }}>
                <img src={image.dataUrl} alt={image.name} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 9 }} />
                <button type="button" aria-label={`Remove ${image.name}`} disabled={interactionDisabled}
                  onClick={() => { setImages((current) => current.filter((_, itemIndex) => itemIndex !== index)); setImageError(null); }}
                  style={{ position: "absolute", top: -5, right: -5, width: 22, height: 22, borderRadius: "50%", background: colors.panel, border: `1px solid ${colors.border}`, color: colors.text }}>
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <div
          ref={composerRef}
          className="flex items-end gap-2"
          style={{
            position: "relative",
            borderRadius: 15,
            background: colors.panel,
            border: `1px solid ${colors.border}`,
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
            padding: "5px 6px 5px 7px",
          }}
        >
          <UploadAttachment
            knowledgeProjectId={knowledgeProjectId}
            disabled={!knowledgeProjectId}
            appearance="chat-inline"
          />
          <input ref={imageInputRef} type="file" multiple accept={COMPOSER_IMAGE_TYPES.join(",")}
            aria-label="Image files" style={{ display: "none" }}
            onChange={(event) => {
              const files = Array.from(event.target.files || []);
              event.target.value = "";
              void attachImages(files);
            }} />
          <button type="button" aria-label="Attach images" title="Attach images"
            disabled={interactionDisabled || readingImages}
            onClick={() => imageInputRef.current?.click()}
            style={{ width: 30, height: 40, flex: "0 0 auto", border: 0, background: "transparent", color: colors.text, opacity: readingImages ? 0.5 : 1 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <circle cx="8" cy="8" r="1.5" />
              <path d="m3 16 5-5 4 4 4-5 5 6" />
            </svg>
          </button>
          <textarea
            ref={inputRef}
            rows={1}
            data-testid="builder-chat-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onPaste={(event) => {
              const pastedImages = Array.from(event.clipboardData.items || [])
                .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
                .map((item) => item.getAsFile())
                .filter((file): file is File => file !== null);
              if (!pastedImages.length) return;
              event.preventDefault();
              void attachImages(pastedImages);
            }}
            disabled={interactionDisabled}
            onKeyDown={(e) => {
              if (e.key === "Tab" && addressSuggestions.length > 0) {
                e.preventDefault();
                completeAddress();
                return;
              }
              if (e.key === "ArrowDown" && addressSuggestions.length > 1) {
                e.preventDefault();
                setSelectedAddressIndex((current) => (current + 1) % addressSuggestions.length);
                return;
              }
              if (e.key === "ArrowUp" && addressSuggestions.length > 1) {
                e.preventDefault();
                setSelectedAddressIndex((current) => (
                  (current - 1 + addressSuggestions.length) % addressSuggestions.length
                ));
                return;
              }
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            aria-label="Message"
            className="builder-chat-composer flex-1"
            style={{
              boxSizing: "border-box",
              minWidth: 0,
              width: "100%",
              minHeight: 40,
              resize: "none",
              overflowX: "hidden",
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              background: "transparent",
              border: "none",
              outline: "none",
              padding: "10px 7px",
              color: colors.text,
              fontSize: 14,
              lineHeight: 1.25,
            }}
          />
          {addressSuggestions.length > 0 ? (
            <div
              data-testid="builder-chat-address-suggestions"
              role="listbox"
              aria-label="Available agents"
              style={{
                position: "absolute",
                left: 48,
                right: 52,
                bottom: "calc(100% + 7px)",
                zIndex: 20,
                padding: 5,
                borderRadius: 11,
                background: "rgba(20,22,26,0.98)",
                border: `1px solid ${colors.border}`,
                boxShadow: "0 12px 32px rgba(0,0,0,0.42)",
              }}
            >
              {addressSuggestions.map((agent, index) => (
                <button
                  key={agent.cardId}
                  type="button"
                  role="option"
                  aria-selected={index === boundedAddressIndex}
                  data-testid={`builder-chat-address-${agent.address}`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    completeAddress(index);
                  }}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "8px 10px",
                    border: 0,
                    borderRadius: 8,
                    background: index === boundedAddressIndex
                      ? "rgba(79,162,173,0.18)" : "transparent",
                    color: colors.text,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span style={{ fontWeight: 700 }}>@{agent.address}</span>
                  <span style={{ color: colors.neutral, fontSize: 11 }}>{agent.title}</span>
                </button>
              ))}
            </div>
          ) : null}
          {busy || connecting ? (
            <span
              data-testid="builder-chat-active-indicator"
              aria-hidden="true"
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: colors.primary,
                animation: "builder-chat-active-pulse 1.1s ease-in-out infinite",
              }}
            />
          ) : null}
          {busy && onStop ? (
            <button type="button" data-testid="builder-chat-stop" onClick={onStop}>
              Stop
            </button>
          ) : null}
          {onVoiceStart && onVoiceStop ? (
            <button
              type="button"
              data-testid="builder-chat-voice"
              aria-label={voicePhase === "idle" || voicePhase === "error"
                ? "Start voice"
                : voicePhase === "listening"
                  ? "Stop and transcribe voice"
                  : "Stop voice"}
              title={voicePhase === "idle" || voicePhase === "error"
                ? "Start voice"
                : voicePhase === "listening"
                  ? "Listening"
                  : voicePhase === "processing"
                    ? "Processing voice"
                    : "Speaking"}
              onClick={voicePhase === "idle" || voicePhase === "error"
                ? onVoiceStart
                : onVoiceStop}
              disabled={interactionDisabled}
              className="rounded-full flex items-center justify-center"
              style={{
                width: 34,
                height: 34,
                flex: "0 0 auto",
                border: voicePhase === "listening"
                  ? "1px solid rgba(255,130,130,0.72)"
                  : `1px solid ${colors.border}`,
                background: voicePhase === "idle"
                  ? "transparent"
                  : voicePhase === "error"
                    ? "rgba(255,105,105,0.10)"
                    : "rgba(79,162,173,0.14)",
                color: voicePhase === "listening" ? "#FF9B9B" : colors.text,
                cursor: interactionDisabled ? "not-allowed" : "pointer",
                opacity: interactionDisabled ? 0.45 : 1,
                boxShadow: voicePhase === "listening"
                  ? "0 0 0 4px rgba(255,130,130,0.08)"
                  : "none",
              }}
            >
              <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
                <path d="M12 18v3" />
                <path d="M9 21h6" />
              </svg>
            </button>
          ) : null}
          <button
            onClick={send}
            disabled={interactionDisabled || readingImages}
            aria-label="Send"
            className="rounded-full flex items-center justify-center"
            style={{
              width: 40,
              height: 40,
              background: interactionDisabled ? colors.neutral : colors.primary,
              border: "1px solid rgba(79,162,173,0.36)",
              boxShadow: "0 8px 18px rgba(79,162,173,0.10), inset 0 1px 0 rgba(255,255,255,0.14)",
              cursor: interactionDisabled ? "not-allowed" : "pointer",
            }}
          >
            <svg
              width="19"
              height="19"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#FFFFFF"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 19V5" />
              <path d="M5 12l7-7 7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
