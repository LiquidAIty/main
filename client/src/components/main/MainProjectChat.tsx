/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: Main Chat
 * Relationship: This file renders the Project conversation and bounded composer, preserving drafts on rejected submissions and showing transport failures outside assistant speech.
 * Entity: Agent Messaging
 * Relationship: This file offers @Card completion only from Main's server-supplied authorized roster without rewriting submitted text or replies.
 * Entity: Card Invocation
 * Relationship: Validates image type, filename, size, and count, then sends unchanged user text and image records through the conversation callback while allowing new drafts during active work.
 * Entity: Voice
 * Relationship: The existing microphone control carries the current draft and images into the same saved-agent conversation without changing layout.
 * Entity: Agent Input
 * Relationship: Shows actual Hermes questions and approval choices beside the existing composer and sends only the user's explicit response.
 * Entity: Project Knowledge Graph
 * Relationship: This file turns exact current assistant-side Entity names into explicit focus actions for the shared Project graph without rewriting message text.
 */

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
import { respondToAgent, type AgentInputRequest } from "../../features/agentbuilder/console/mainSessionClient";
import {
  MAX_MAIN_CHAT_IMAGES,
  type MainChatRunInput,
  type MainChatVoicePhase,
} from "../../features/agentbuilder/console/useAgentBuilderMainChat";
import UploadAttachment from "../knowledge/UploadAttachment";
import {
  prepareChatBubbleText,
  tightChatBubbleTextWidth,
} from "../builder/pretextBubbleLayout";
import type {
  CanonicalEntityFocusTarget,
  CanonicalEntityMatcher,
} from "../builder/canonicalEntityLinks";

type MainProjectChatColors = {
  primary: string;
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

type MainProjectChatMessage = {
  role: string;
  text: string;
  linkedEvidenceIds?: string[];
  status?: "pending" | "complete" | "error";
};

function shouldRenderMessage(message: MainProjectChatMessage): boolean {
  return Boolean(safeText(message.text).trim());
}

type ComposerImage = { name: string; mediaType: string; dataUrl: string; kind: "user-upload" };
const COMPOSER_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_COMPOSER_IMAGE_BYTES = 2 * 1024 * 1024;
const MESSAGE_LANE_MAX_WIDTH = 760;

const CANONICAL_ENTITY_LINK_STYLE = Object.freeze({
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
    return Promise.reject(new Error("Each image must be between 1 byte and 2 MB."));
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

function followLatestOutput(atBottom: boolean): "auto" | false {
  return atBottom ? "auto" : false;
}

function linkedChatText(
  text: string,
  role: MainProjectChatMessage["role"],
  entityMatcher: CanonicalEntityMatcher | null | undefined,
  onEntityFocus: ((target: CanonicalEntityFocusTarget) => void) | undefined,
  keyPrefix: string,
): ReactNode[] {
  const segments = (role === 'assistant' || role === 'user')
    ? entityMatcher?.segmentMessage(role, text) || [{ text }]
    : [{ text }];
  return segments.map((segment, index) => segment.target && onEntityFocus ? (
    <button
      key={`${keyPrefix}:entity:${index}`}
      type="button"
      aria-label={`Open ${segment.text} in graph`}
      onClick={() => onEntityFocus(segment.target!)}
      style={CANONICAL_ENTITY_LINK_STYLE}
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

function isMarkdownWordCharacter(value: string | undefined): boolean {
  return Boolean(value && /[\p{L}\p{N}]/u.test(value));
}

function isIntrawordUnderscore(text: string, index: number): boolean {
  return isMarkdownWordCharacter(text[index - 1])
    && isMarkdownWordCharacter(text[index + 1]);
}

function findClosingUnderscore(text: string, opening: number): number {
  for (
    let candidate = text.indexOf('_', opening + 1);
    candidate >= 0;
    candidate = text.indexOf('_', candidate + 1)
  ) {
    if (
      candidate > opening + 1
      && !isIntrawordUnderscore(text, candidate)
      && !/\s/u.test(text[candidate - 1])
    ) return candidate;
  }
  return -1;
}

function inlineChatMarkdown(
  text: string,
  role: MainProjectChatMessage["role"],
  entityMatcher: CanonicalEntityMatcher | null | undefined,
  onEntityFocus: ((target: CanonicalEntityFocusTarget) => void) | undefined,
  keyPrefix: string,
): ReactNode[] {
  const output: ReactNode[] = [];
  let cursor = 0;
  let token = 0;
  const pushText = (value: string) => {
    if (!value) return;
    output.push(...linkedChatText(
      value, role, entityMatcher, onEntityFocus, `${keyPrefix}:${token++}`,
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
            text.slice(cursor + 2, close), role, entityMatcher, onEntityFocus,
            `${keyPrefix}:strong:${current}`,
          )}
        </strong>);
        cursor = close + 2;
        continue;
      }
    }
    const marker = text[cursor];
    const underscoreCanOpen = marker === '_'
      && !isIntrawordUnderscore(text, cursor)
      && Boolean(text[cursor + 1])
      && !/\s/u.test(text[cursor + 1]);
    if (marker === '*' || underscoreCanOpen) {
      const close = marker === '_'
        ? findClosingUnderscore(text, cursor)
        : text.indexOf(marker, cursor + 1);
      if (close > cursor + 1) {
        const current = token++;
        output.push(<em key={`${keyPrefix}:em:${current}`}>
          {inlineChatMarkdown(
            text.slice(cursor + 1, close), role, entityMatcher, onEntityFocus,
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
              text.slice(cursor + 1, labelEnd), role, entityMatcher,
              onEntityFocus, `${keyPrefix}:link-label`,
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
  role: MainProjectChatMessage["role"],
  entityMatcher: CanonicalEntityMatcher | null | undefined,
  onEntityFocus: ((target: CanonicalEntityFocusTarget) => void) | undefined,
): ReactNode[] {
  const lines = text.split('\n');
  return lines.flatMap((rawLine, index) => {
    const heading = /^(#{1,6})\s+(.+)$/.exec(rawLine);
    const bullet = /^\s*[-*]\s+(.+)$/.exec(rawLine);
    const content = heading?.[2] ?? bullet?.[1] ?? rawLine;
    const inline = inlineChatMarkdown(
      content, role, entityMatcher, onEntityFocus, `line:${index}`,
    );
    const line = heading
      ? <strong key={`line:${index}:heading`}>{inline}</strong>
      : bullet
        ? <span key={`line:${index}:bullet`}><span aria-hidden="true">• </span>{inline}</span>
        : <Fragment key={`line:${index}:plain`}>{inline}</Fragment>;
    return index < lines.length - 1 ? [line, <br key={`line:${index}:break`} />] : [line];
  });
}

function MainProjectChatMessageBubble({
  colors,
  laneWidth,
  message,
  entityMatcher,
  onEntityFocus,
  onEvidenceFocus,
}: {
  colors: MainProjectChatColors;
  laneWidth: number | null;
  message: MainProjectChatMessage;
  entityMatcher?: CanonicalEntityMatcher | null;
  onEntityFocus?: (target: CanonicalEntityFocusTarget) => void;
  onEvidenceFocus?: (episodeId: string) => void;
}) {
  const text = safeText(message.text);
  const isUser = message.role === "user";
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
  return (
    <div
      style={{
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
        width: "100%",
      }}
    >
      <div
        data-testid="main-chat-message-frame"
        style={{
          maxWidth: isUser ? "min(82%, 560px)" : "min(92%, 640px)",
          width: measuredBubbleWidth == null ? "fit-content" : measuredBubbleWidth,
        }}
      >
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
            : renderChatMarkdown(text, message.role, entityMatcher, onEntityFocus)}
          {!isUser && message.linkedEvidenceIds?.length && onEvidenceFocus ? (
            <span data-testid="main-chat-evidence-links" style={{
              display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10,
            }}>
              {message.linkedEvidenceIds.map((episodeId, index) => (
                <button
                  key={episodeId}
                  type="button"
                  aria-label={`Open Know ${index + 1} in graph`}
                  onClick={() => onEvidenceFocus(episodeId)}
                  style={{
                    border: '1px solid rgba(214,148,72,0.42)',
                    borderRadius: 999,
                    background: 'rgba(214,148,72,0.10)',
                    color: '#E2A75E',
                    cursor: 'pointer',
                    fontSize: 11,
                    lineHeight: 1.2,
                    padding: '3px 8px',
                  }}
                >Know{message.linkedEvidenceIds!.length > 1 ? ` ${index + 1}` : ''}</button>
              ))}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function AgentInput({ request }: { request: AgentInputRequest }) {
  const [answer, setAnswer] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [state, setState] = useState<'open' | 'sending' | 'answered'>('open');
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  const respond = async (value: string) => {
    if (sending.current) return;
    sending.current = true;
    setState('sending');
    setError(null);
    try { await respondToAgent(request, value); setState('answered'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'agent_input_response_failed'); setState('open'); }
    finally { sending.current = false; }
  };
  if (state === 'answered') return null;
  return <fieldset disabled={state === 'sending'} aria-label={`${request.address ? `@${request.address} ` : ''}${request.kind}`} style={{ marginBottom: 8 }}>
    {request.address ? <legend>@{request.address}</legend> : null}
    <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{request.question || request.description}</div>
    {request.command ? <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{request.command}</pre> : null}
    {request.choices.map(choice => request.kind === 'clarify' && request.multiSelect
      ? <label key={choice}><input type="checkbox" checked={selected.includes(choice)} onChange={event => setSelected(current =>
        event.target.checked ? [...current, choice] : current.filter(item => item !== choice))} />{choice}</label>
      : <button type="button" key={choice} onClick={() => { void respond(choice); }}>{choice}</button>)}
    {request.kind === 'clarify' ? <form onSubmit={event => { event.preventDefault(); void respond([...selected, answer].filter(Boolean).join('\n')); }}>
      <input aria-label={request.address ? `Answer @${request.address}` : 'Answer'} value={answer} onChange={event => setAnswer(event.target.value)} />
      <button type="submit" disabled={!answer.trim() && !selected.length}>Send answer</button>
    </form> : null}
    {error ? <div role="alert">{error}</div> : null}
  </fieldset>;
}

export default function MainProjectChat({
  messages,
  directChatTargets = [],
  inputRequests = [],
  onSend,
  knowledgeProjectId,
  colors,
  busy = false,
  historyLoading = false,
  error = null,
  voiceError = null,
  voicePhase = "idle",
  onVoiceStart,
  onVoiceStop,
  onStop,
  draft,
  onDraftChange,
  entityMatcher,
  onEntityFocus,
  onEvidenceFocus,
}: {
  messages: MainProjectChatMessage[];
  directChatTargets?: DirectChatTarget[];
  inputRequests?: AgentInputRequest[];
  onSend: (t: string, runInput?: MainChatRunInput) => void | boolean;
  knowledgeProjectId: string;
  colors: MainProjectChatColors;
  /** A real Card turn is active; the composer remains available. */
  busy?: boolean;
  /** The send request is opening. */
  connecting?: boolean;
  /** Project conversation history is loading; prevent a send that could be overwritten by readback. */
  historyLoading?: boolean;
  /** Visible transport/configuration failure; never represented as assistant speech. */
  error?: string | null;
  voiceError?: string | null;
  voicePhase?: MainChatVoicePhase;
  onVoiceStart?: (draft: string, runInput: MainChatRunInput) => void | boolean | Promise<boolean>;
  onVoiceStop?: () => void;
  onStop?: () => void;
  draft?: string;
  onDraftChange?: (value: string) => void;
  entityMatcher?: CanonicalEntityMatcher | null;
  onEntityFocus?: (target: CanonicalEntityFocusTarget) => void;
  onEvidenceFocus?: (episodeId: string) => void;
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
  const interactionDisabled = historyLoading;
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
  const stopActive = busy && !value.trim() && images.length === 0 && Boolean(onStop);
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
      agent.address.toLowerCase().startsWith(addressPrefix)
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

  const renderMessage = useCallback((index: number, message: MainProjectChatMessage) => (
    <div
      data-testid="main-chat-message-row"
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
      <MainProjectChatMessageBubble
        colors={colors}
        laneWidth={messageLaneWidth}
        message={message}
        entityMatcher={entityMatcher}
        onEntityFocus={onEntityFocus}
        onEvidenceFocus={onEvidenceFocus}
      />
    </div>
  ), [
    colors,
    messageLaneWidth,
    onEntityFocus,
    onEvidenceFocus,
    renderableMessages.length,
    entityMatcher,
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
    const accepted = images.length ? onSend(value, { images }) : onSend(value);
    if (accepted === false) return;
    setImages([]);
    setImageError(null);
    setValue("");
  };
  return (
    <div data-testid="main-chat-panel" className="h-full flex flex-col" style={{ gap: 12 }}>
      <style>
        {`
          .main-chat-scroll {
            scrollbar-width: thin;
            scrollbar-color: #4E4E4E transparent;
          }
          .main-chat-scroll::-webkit-scrollbar { width: 7px; }
          .main-chat-scroll::-webkit-scrollbar-track { background: transparent; }
          .main-chat-scroll::-webkit-scrollbar-thumb {
            background: #4E4E4E;
            border-radius: 999px;
            border: 1px solid rgba(0, 0, 0, 0.25);
          }
          .main-chat-scroll::-webkit-scrollbar-thumb:hover {
            background: #616161;
          }
          .main-chat-composer { scrollbar-width: none; }
          .main-chat-composer::-webkit-scrollbar { display: none; }
        `}
      </style>
      <div
        ref={messageViewportRef}
        data-testid="main-chat-message-viewport"
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
          data-testid="main-chat-message-list"
          className="main-chat-scroll"
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
            data-testid="main-chat-return-to-latest"
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
        {inputRequests.filter(request => request.projectId === knowledgeProjectId).map(request => (
          <AgentInput key={`${request.projectId}:${request.cardId}:${request.sessionId}:${request.requestId}`} request={request} />
        ))}
        {imageError || error || voiceError || voicePhase === 'requesting' ? (
          <div
            data-testid="main-chat-error"
            role="status"
            style={{
              color: "#FF9B9B",
              fontSize: 12,
              lineHeight: 1.35,
              padding: "0 6px 8px",
              overflowWrap: "anywhere",
            }}
          >
            {safeText(imageError || error || voiceError || 'Waiting for microphone access from this browser.')}
          </div>
        ) : null}
        {images.length ? (
          <div data-testid="main-chat-images" className="main-chat-composer"
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
            data-testid="main-chat-input"
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
            className="main-chat-composer flex-1"
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
              data-testid="main-chat-address-suggestions"
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
                  data-testid={`main-chat-address-${agent.address}`}
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
          {onVoiceStart && onVoiceStop ? (
            <button
              type="button"
              data-testid="main-chat-voice"
              aria-label={voicePhase === "idle" || voicePhase === "error"
                ? "Start voice"
                : voicePhase === "listening"
                  ? "Stop and transcribe voice"
                  : "Stop voice"}
              title={voicePhase === "idle" || voicePhase === "error"
                ? "Start voice"
                : voicePhase === "requesting"
                  ? "Waiting for browser microphone access"
                : voicePhase === "listening"
                  ? "Listening"
                  : voicePhase === "processing"
                    ? "Processing voice"
                    : "Speaking"}
              onClick={() => {
                if (voicePhase !== "idle" && voicePhase !== "error") { onVoiceStop(); return; }
                const voiceDraft = value;
                const voiceImages = images;
                const epoch = imageReadEpochRef.current;
                void Promise.resolve(onVoiceStart(voiceDraft, { images: voiceImages })).then((accepted) => {
                  if (accepted !== true || epoch !== imageReadEpochRef.current) return;
                  if (inputRef.current?.value === voiceDraft) setValue("");
                  setImages((current) => current === voiceImages ? [] : current);
                });
              }}
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
            type="button"
            data-testid={stopActive ? "main-chat-stop" : "main-chat-submit"}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              if (stopActive) {
                onStop?.();
                return;
              }
              send();
            }}
            disabled={stopActive ? false : interactionDisabled || readingImages}
            aria-label={stopActive ? "Stop" : "Send"}
            className="rounded-full flex items-center justify-center"
            style={{
              width: 40,
              height: 40,
              background: stopActive
                ? colors.primary
                : interactionDisabled
                  ? colors.neutral
                  : colors.primary,
              border: "1px solid rgba(79,162,173,0.36)",
              boxShadow: "0 8px 18px rgba(79,162,173,0.10), inset 0 1px 0 rgba(255,255,255,0.14)",
              cursor: stopActive
                ? "pointer"
                : interactionDisabled
                  ? "not-allowed"
                  : "pointer",
            }}
          >
            {stopActive ? (
              <span
                aria-hidden="true"
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 1.5,
                  background: "#FFFFFF",
                }}
              />
            ) : (
              <svg
                width="19"
                height="19"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#FFFFFF"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 19V5" />
                <path d="M5 12l7-7 7 7" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
