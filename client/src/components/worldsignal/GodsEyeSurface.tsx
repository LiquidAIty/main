import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';

export type GodsEyeSelectionRef = {
  id: string;
  type: string;
  label: string | null;
  position: { longitude: number; latitude: number } | null;
  updatedAt?: string | null;
};

export type GodsEyeSourceDescriptor = {
  id: string;
  name: string | null;
  provider: string | null;
  enabled: boolean;
  lifecycleState: string | null;
  lifecycleUncertain: boolean;
  feedState: string | null;
  available: boolean | null;
  loading: boolean;
  refreshing: boolean;
  count: number | null;
  lastRefreshAt: string | null;
  error: string | null;
};

export type GodsEyeLayerState = {
  sourceStateReady: boolean;
  enabledLayerIds: string[];
  sourceClocks: Record<string, string | null>;
  sources: GodsEyeSourceDescriptor[];
};

export type GodsEyeBridge = {
  setLayerVisibility: (layerId: string, enabled: boolean) => string | null;
  focusSelection: (selection: GodsEyeSelectionRef) => string | null;
};

export type GodsEyeNativeAgentState = {
  available: boolean;
  active: boolean;
};

type GodsEyeReadyMessage = {
  schemaVersion: 'gev.embed.ready.v1';
  projectId: string;
  cardId: string;
  sourceVersion: string;
  agentRuntime: 'supervised';
  nativeAgentAvailable: boolean;
  nativeAgentActive: boolean;
};

type GodsEyeSelectionMessage = {
  schemaVersion: 'gev.embed.selection.v1';
  projectId: string;
  cardId: string;
  selection: GodsEyeSelectionRef | null;
};

type GodsEyeLayerStateMessage = {
  schemaVersion: 'gev.embed.layer-state.v1';
  projectId: string;
  cardId: string;
  state: GodsEyeLayerState;
};

export type GodsEyeCommandResult = {
  schemaVersion: 'gev.embed.layer-visibility.result.v1' | 'gev.embed.focus.result.v1';
  projectId: string;
  cardId: string;
  requestId: string;
  ok: boolean;
  error: string | null;
  layerId?: string;
  requestedEnabled?: boolean;
  targetId?: string;
  state?: GodsEyeLayerState;
};

type GodsEyeErrorMessage = {
  schemaVersion: 'gev.embed.error.v1';
  projectId: string;
  cardId: string;
  code: string;
  message: string;
};

export type GodsEyeHostMessage =
  | GodsEyeReadyMessage
  | GodsEyeSelectionMessage
  | GodsEyeLayerStateMessage
  | GodsEyeCommandResult
  | GodsEyeErrorMessage;

type GodsEyeSurfaceProps = {
  /** URL of a separately built God’s Eye embed with the supervised host contract. */
  embedUrl: string | null;
  projectId: string;
  cardId: string;
  onReady?: (sourceVersion: string) => void;
  onBridgeUnavailable?: () => void;
  onNativeAgentState?: (state: GodsEyeNativeAgentState) => void;
  onSelectionChange?: (selection: GodsEyeSelectionRef | null) => void;
  onLayerStateChange?: (state: GodsEyeLayerState) => void;
  onCommandResult?: (result: GodsEyeCommandResult) => void;
  onError?: (error: { code: string; message: string }) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isFiniteCoordinate(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function isScopedMessage(value: Record<string, unknown>): boolean {
  return typeof value.projectId === 'string' && value.projectId.length > 0
    && typeof value.cardId === 'string' && value.cardId.length > 0;
}

function isSourceDescriptor(value: unknown): value is GodsEyeSourceDescriptor {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string' && Boolean(value.id)
    && ['name', 'provider', 'lifecycleState'].every(
      (key) => value[key] === null || typeof value[key] === 'string',
    ) && ['enabled', 'lifecycleUncertain', 'loading', 'refreshing'].every(
    (key) => typeof value[key] === 'boolean',
  ) && (value.available === null || typeof value.available === 'boolean')
    && (value.feedState === null || typeof value.feedState === 'string')
    && (value.count === null || (typeof value.count === 'number' && Number.isFinite(value.count)))
    && (value.lastRefreshAt === null || typeof value.lastRefreshAt === 'string')
    && (value.error === null || typeof value.error === 'string');
}

export function parseGodsEyeHostMessage(value: unknown): GodsEyeHostMessage | null {
  if (!isRecord(value) || typeof value.schemaVersion !== 'string') return null;
  if (!isScopedMessage(value)) return null;
  if (value.schemaVersion === 'gev.embed.ready.v1') {
    if (
      typeof value.sourceVersion !== 'string'
      || !value.sourceVersion.trim()
      || value.agentRuntime !== 'supervised'
      || typeof value.nativeAgentAvailable !== 'boolean'
      || typeof value.nativeAgentActive !== 'boolean'
    ) return null;
    return value as GodsEyeReadyMessage;
  }
  if (value.schemaVersion === 'gev.embed.selection.v1') {
    if (value.selection === null) return value as GodsEyeSelectionMessage;
    if (!isRecord(value.selection)) return null;
    const position = value.selection.position;
    if (
      typeof value.selection.id !== 'string'
      || !value.selection.id.trim()
      || typeof value.selection.type !== 'string'
      || !value.selection.type.trim()
      || !(value.selection.label === null || typeof value.selection.label === 'string')
      || !(
        value.selection.updatedAt === undefined
        || value.selection.updatedAt === null
        || typeof value.selection.updatedAt === 'string'
      )
      || !(
        position === null
        || (
          isRecord(position)
          && isFiniteCoordinate(position.longitude, -180, 180)
          && isFiniteCoordinate(position.latitude, -90, 90)
        )
      )
    ) return null;
    return value as GodsEyeSelectionMessage;
  }
  if (value.schemaVersion === 'gev.embed.layer-state.v1') {
    if (!isRecord(value.state)) return null;
    if (
      typeof value.state.sourceStateReady !== 'boolean'
      || !Array.isArray(value.state.enabledLayerIds)
      || !value.state.enabledLayerIds.every((item) => typeof item === 'string' && item.length > 0)
      || !isRecord(value.state.sourceClocks)
      || !Object.values(value.state.sourceClocks).every(
        (item) => item === null || typeof item === 'string',
      )
      || !Array.isArray(value.state.sources)
      || !value.state.sources.every(isSourceDescriptor)
    ) return null;
    return value as GodsEyeLayerStateMessage;
  }
  if (value.schemaVersion === 'gev.embed.layer-visibility.result.v1'
    || value.schemaVersion === 'gev.embed.focus.result.v1') {
    if (typeof value.requestId !== 'string' || !value.requestId
      || typeof value.ok !== 'boolean'
      || !(value.error === null || typeof value.error === 'string')) return null;
    if (value.schemaVersion === 'gev.embed.layer-visibility.result.v1') {
      if (typeof value.layerId !== 'string' || !value.layerId
        || typeof value.requestedEnabled !== 'boolean'
        || !isRecord(value.state)
        || !parseGodsEyeHostMessage({
          schemaVersion: 'gev.embed.layer-state.v1',
          projectId: value.projectId,
          cardId: value.cardId,
          state: value.state,
        })) return null;
    } else if (typeof value.targetId !== 'string' || !value.targetId) return null;
    return value as GodsEyeCommandResult;
  }
  if (value.schemaVersion === 'gev.embed.error.v1') {
    if (
      typeof value.code !== 'string'
      || !value.code.trim()
      || typeof value.message !== 'string'
      || !value.message.trim()
    ) return null;
    return value as GodsEyeErrorMessage;
  }
  return null;
}

export function resolveGodsEyeEmbedUrl(rawUrl: string, hostOrigin: string): URL {
  const source = String(rawUrl || '').trim();
  if (!source) throw new Error('gods_eye_embed_url_required');
  const url = new URL(source, hostOrigin);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('gods_eye_embed_protocol_invalid');
  }
  const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);
  if (!loopback.has(url.hostname)) throw new Error('gods_eye_embed_must_be_loopback');
  if (url.origin === hostOrigin) throw new Error('gods_eye_embed_requires_isolated_origin');
  url.searchParams.set('embed', '1');
  url.searchParams.set('agentRuntime', 'supervised');
  url.searchParams.set('hostOrigin', hostOrigin);
  return url;
}

/**
 * Host boundary for God’s Eye as the WorldView globe.
 *
 * This deliberately does not import, clone, or imitate the upstream app. It
 * mounts a separately built copy in an isolated origin and accepts readiness
 * only after upstream reports its native Realtime agent as a supervised,
 * explicitly user-started subsystem. Hermes remains the parent Card runtime;
 * the upstream agent retains its native globe-interaction lifecycle.
 */
let nextRequestId = 0;

const GodsEyeSurface = forwardRef<GodsEyeBridge, GodsEyeSurfaceProps>(function GodsEyeSurface({
  embedUrl,
  projectId,
  cardId,
  onReady,
  onBridgeUnavailable,
  onNativeAgentState,
  onSelectionChange,
  onLayerStateChange,
  onCommandResult,
  onError,
}, bridgeRef): React.ReactElement {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const readyRef = useRef(false);
  const pendingRef = useRef(new Map<string, {
    kind: 'layer' | 'focus'; targetId: string; requestedEnabled?: boolean;
  }>());
  const [ready, setReady] = useState(false);
  const callbacksRef = useRef({
    onReady, onBridgeUnavailable, onNativeAgentState, onSelectionChange,
    onLayerStateChange, onCommandResult, onError,
  });
  useEffect(() => {
    callbacksRef.current = {
      onReady, onBridgeUnavailable, onNativeAgentState, onSelectionChange,
      onLayerStateChange, onCommandResult, onError,
    };
  });

  const resolved = useMemo(() => {
    if (!embedUrl || typeof window === 'undefined') return { url: null, error: null };
    try {
      return { url: resolveGodsEyeEmbedUrl(embedUrl, window.location.origin), error: null };
    } catch (error) {
      return {
        url: null,
        error: error instanceof Error ? error.message : 'gods_eye_embed_url_invalid',
      };
    }
  }, [embedUrl]);

  useImperativeHandle(bridgeRef, () => ({
    setLayerVisibility(layerId, enabled) {
      const target = frameRef.current?.contentWindow;
      if (!readyRef.current || !resolved.url || !target || !layerId) return null;
      const requestId = `worldview-${++nextRequestId}`;
      pendingRef.current.set(requestId, { kind: 'layer', targetId: layerId, requestedEnabled: enabled });
      target.postMessage({
        schemaVersion: 'gev.embed.layer-visibility.v1', requestId,
        projectId, cardId, layerId, enabled,
      }, resolved.url.origin);
      return requestId;
    },
    focusSelection(selection) {
      const target = frameRef.current?.contentWindow;
      if (!readyRef.current || !resolved.url || !target || !selection.position) return null;
      const requestId = `worldview-${++nextRequestId}`;
      pendingRef.current.set(requestId, { kind: 'focus', targetId: selection.id });
      target.postMessage({
        schemaVersion: 'gev.embed.focus.v1', requestId,
        projectId, cardId, targetId: selection.id, position: selection.position,
      }, resolved.url.origin);
      return requestId;
    },
  }), [cardId, projectId, resolved.url]);

  useEffect(() => {
    readyRef.current = false;
    pendingRef.current.clear();
    setReady(false);
    callbacksRef.current.onBridgeUnavailable?.();
    if (!resolved.url) return;
    const expectedOrigin = resolved.url.origin;
    const receive = (event: MessageEvent<unknown>) => {
      if (event.origin !== expectedOrigin || event.source !== frameRef.current?.contentWindow) return;
      if (isRecord(event.data) && event.data.schemaVersion === 'gev.embed.bootstrap.v1') {
        readyRef.current = false;
        pendingRef.current.clear();
        setReady(false);
        callbacksRef.current.onBridgeUnavailable?.();
        frameRef.current?.contentWindow?.postMessage({
          schemaVersion: 'gev.embed.host-config.v1', projectId, cardId,
          parentRuntime: 'hermes', nativeAgentPolicy: 'user-initiated',
        }, expectedOrigin);
        return;
      }
      const message = parseGodsEyeHostMessage(event.data);
      if (!message || message.projectId !== projectId || message.cardId !== cardId) return;
      if (message.schemaVersion === 'gev.embed.ready.v1') {
        readyRef.current = true;
        setReady(true);
        callbacksRef.current.onReady?.(message.sourceVersion);
        callbacksRef.current.onNativeAgentState?.({
          available: message.nativeAgentAvailable,
          active: message.nativeAgentActive,
        });
      } else if (!readyRef.current) {
        return;
      } else if (message.schemaVersion === 'gev.embed.selection.v1') {
        callbacksRef.current.onSelectionChange?.(message.selection);
      } else if (message.schemaVersion === 'gev.embed.layer-state.v1') {
        callbacksRef.current.onLayerStateChange?.(message.state);
      } else if (message.schemaVersion === 'gev.embed.layer-visibility.result.v1'
        || message.schemaVersion === 'gev.embed.focus.result.v1') {
        const pending = pendingRef.current.get(message.requestId);
        if (!pending || (pending.kind === 'layer'
          && (message.schemaVersion !== 'gev.embed.layer-visibility.result.v1'
            || message.layerId !== pending.targetId
            || message.requestedEnabled !== pending.requestedEnabled))
          || (pending.kind === 'focus'
            && (message.schemaVersion !== 'gev.embed.focus.result.v1'
              || message.targetId !== pending.targetId))) return;
        pendingRef.current.delete(message.requestId);
        if (message.schemaVersion === 'gev.embed.layer-visibility.result.v1' && message.state) {
          callbacksRef.current.onLayerStateChange?.(message.state);
        }
        callbacksRef.current.onCommandResult?.(message);
      } else if (message.schemaVersion === 'gev.embed.error.v1') {
        callbacksRef.current.onError?.({ code: message.code, message: message.message });
      }
    };
    window.addEventListener('message', receive);
    return () => {
      readyRef.current = false;
      pendingRef.current.clear();
      window.removeEventListener('message', receive);
    };
  }, [cardId, projectId, resolved.url]);

  if (resolved.error) {
    return <Unavailable title="God’s Eye embed rejected" detail={resolved.error} />;
  }
  if (!resolved.url) {
    return (
      <Unavailable
        title="God’s Eye embed unavailable"
        detail="A supervised, isolated upstream build has not been connected."
      />
    );
  }

  return (
    <section style={styles.root} aria-label="God’s Eye WorldView globe">
      <iframe
        key={`${projectId}:${cardId}`}
        ref={frameRef}
        src={resolved.url.toString()}
        title="God’s Eye WorldView globe"
        sandbox="allow-scripts allow-same-origin"
        allow="fullscreen; microphone"
        referrerPolicy="no-referrer"
        style={styles.frame}
        onLoad={() => {
          readyRef.current = false;
          pendingRef.current.clear();
          setReady(false);
          callbacksRef.current.onBridgeUnavailable?.();
          frameRef.current?.contentWindow?.postMessage({
            schemaVersion: 'gev.embed.host-config.v1',
            projectId,
            cardId,
            parentRuntime: 'hermes',
            nativeAgentPolicy: 'user-initiated',
          }, resolved.url?.origin || '*');
        }}
      />
      {!ready ? (
        <div style={styles.waiting} role="status">
          Waiting for God’s Eye supervised embed handshake…
        </div>
      ) : null}
    </section>
  );
});

export default GodsEyeSurface;

function Unavailable({ title, detail }: { title: string; detail: string }): React.ReactElement {
  return (
    <section style={styles.unavailable} aria-label="God’s Eye unavailable">
      <h2 style={styles.title}>{title}</h2>
      <code style={styles.error}>{detail}</code>
    </section>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: { position: 'relative', width: '100%', height: '100%', minHeight: 0, background: '#050b10' },
  frame: { display: 'block', width: '100%', height: '100%', border: 0, background: '#050b10' },
  waiting: {
    position: 'absolute',
    inset: 'auto 16px 16px',
    padding: 10,
    color: '#d9f7f2',
    background: 'rgba(5, 11, 16, 0.9)',
    border: '1px solid rgba(217, 247, 242, 0.22)',
    borderRadius: 8,
    textAlign: 'center',
  },
  unavailable: {
    display: 'grid',
    placeContent: 'center',
    gap: 10,
    width: '100%',
    height: '100%',
    minHeight: 280,
    padding: 32,
    textAlign: 'center',
    color: '#d9f7f2',
    background: '#050b10',
  },
  title: { margin: 0, fontSize: 22, fontWeight: 650 },
  error: { maxWidth: 640, color: '#e5a069', whiteSpace: 'pre-wrap' },
};
