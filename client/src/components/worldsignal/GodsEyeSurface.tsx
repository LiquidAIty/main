import React, { useEffect, useMemo, useRef, useState } from 'react';

export type GodsEyeSelectionRef = {
  id: string;
  type: string;
  label: string | null;
  position: { longitude: number; latitude: number } | null;
};

export type GodsEyeLayerState = {
  enabledLayerIds: string[];
  sourceClocks: Record<string, string | null>;
};

type GodsEyeReadyMessage = {
  schemaVersion: 'gev.embed.ready.v1';
  sourceVersion: string;
  agentRuntime: 'host';
  voiceEnabled: false;
};

type GodsEyeSelectionMessage = {
  schemaVersion: 'gev.embed.selection.v1';
  selection: GodsEyeSelectionRef | null;
};

type GodsEyeLayerStateMessage = {
  schemaVersion: 'gev.embed.layer-state.v1';
  state: GodsEyeLayerState;
};

type GodsEyeErrorMessage = {
  schemaVersion: 'gev.embed.error.v1';
  code: string;
  message: string;
};

export type GodsEyeHostMessage =
  | GodsEyeReadyMessage
  | GodsEyeSelectionMessage
  | GodsEyeLayerStateMessage
  | GodsEyeErrorMessage;

type GodsEyeSurfaceProps = {
  /** URL of a separately built God’s Eye embed with the providerless host contract. */
  embedUrl: string | null;
  projectId: string;
  cardId: string;
  onReady?: (sourceVersion: string) => void;
  onSelectionChange?: (selection: GodsEyeSelectionRef | null) => void;
  onLayerStateChange?: (state: GodsEyeLayerState) => void;
  onError?: (error: { code: string; message: string }) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isFiniteCoordinate(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

export function parseGodsEyeHostMessage(value: unknown): GodsEyeHostMessage | null {
  if (!isRecord(value) || typeof value.schemaVersion !== 'string') return null;
  if (value.schemaVersion === 'gev.embed.ready.v1') {
    if (
      typeof value.sourceVersion !== 'string'
      || !value.sourceVersion.trim()
      || value.agentRuntime !== 'host'
      || value.voiceEnabled !== false
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
      !Array.isArray(value.state.enabledLayerIds)
      || !value.state.enabledLayerIds.every((item) => typeof item === 'string' && item.length > 0)
      || !isRecord(value.state.sourceClocks)
      || !Object.values(value.state.sourceClocks).every(
        (item) => item === null || typeof item === 'string',
      )
    ) return null;
    return value as GodsEyeLayerStateMessage;
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
  url.searchParams.set('agentRuntime', 'host');
  url.searchParams.set('voice', 'disabled');
  return url;
}

/**
 * Host boundary for God’s Eye as the WorldView globe.
 *
 * This deliberately does not import, clone, or imitate the upstream app. It
 * mounts a separately built copy in an isolated origin and accepts readiness
 * only after upstream proves its own AI/voice runtime is disabled. The supplied
 * upstream archive does not implement this handshake yet, so callers must keep
 * this component disconnected until that small upstream patch is available.
 */
export default function GodsEyeSurface({
  embedUrl,
  projectId,
  cardId,
  onReady,
  onSelectionChange,
  onLayerStateChange,
  onError,
}: GodsEyeSurfaceProps): React.ReactElement {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [ready, setReady] = useState(false);
  const callbacksRef = useRef({ onReady, onSelectionChange, onLayerStateChange, onError });
  useEffect(() => {
    callbacksRef.current = { onReady, onSelectionChange, onLayerStateChange, onError };
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

  useEffect(() => {
    setReady(false);
    if (!resolved.url) return;
    const expectedOrigin = resolved.url.origin;
    const receive = (event: MessageEvent<unknown>) => {
      if (event.origin !== expectedOrigin || event.source !== frameRef.current?.contentWindow) return;
      const message = parseGodsEyeHostMessage(event.data);
      if (!message) return;
      if (message.schemaVersion === 'gev.embed.ready.v1') {
        setReady(true);
        callbacksRef.current.onReady?.(message.sourceVersion);
      } else if (message.schemaVersion === 'gev.embed.selection.v1') {
        callbacksRef.current.onSelectionChange?.(message.selection);
      } else if (message.schemaVersion === 'gev.embed.layer-state.v1') {
        callbacksRef.current.onLayerStateChange?.(message.state);
      } else {
        callbacksRef.current.onError?.({ code: message.code, message: message.message });
      }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [resolved.url]);

  if (resolved.error) {
    return <Unavailable title="God’s Eye embed rejected" detail={resolved.error} />;
  }
  if (!resolved.url) {
    return (
      <Unavailable
        title="God’s Eye embed unavailable"
        detail="A providerless, isolated upstream build has not been connected."
      />
    );
  }

  return (
    <section style={styles.root} aria-label="God’s Eye WorldView globe">
      <iframe
        ref={frameRef}
        src={resolved.url.toString()}
        title="God’s Eye WorldView globe"
        sandbox="allow-scripts allow-same-origin"
        allow="fullscreen"
        referrerPolicy="no-referrer"
        style={styles.frame}
        onLoad={() => {
          frameRef.current?.contentWindow?.postMessage({
            schemaVersion: 'gev.embed.host-config.v1',
            projectId,
            cardId,
            agentRuntime: 'host',
            voiceEnabled: false,
          }, resolved.url?.origin || '*');
        }}
      />
      {!ready ? (
        <div style={styles.waiting} role="status">
          Waiting for God’s Eye providerless embed handshake…
        </div>
      ) : null}
    </section>
  );
}

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
