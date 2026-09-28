import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

import {
  loadWorldViewNative,
  type NativeWorldViewMount,
} from './loadWorldViewNative';

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
  setLayerVisibility: (
    layerId: string,
    enabled: boolean,
    options?: { exitIncompatibleContext?: boolean },
  ) => string | null;
  focusSelection: (selection: GodsEyeSelectionRef) => string | null;
  executeAction: (name: string, args?: Record<string, unknown>) => Promise<unknown>;
  prepareRunImages: () => Promise<Array<Record<string, unknown>>>;
};

export type GodsEyeCommandResult = {
  schemaVersion: 'gev.direct.layer-visibility.result.v1' | 'gev.direct.focus.result.v1';
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

type GodsEyeSurfaceProps = {
  projectId: string;
  cardId: string;
  onReady?: (sourceVersion: string) => void;
  onBridgeUnavailable?: () => void;
  onSelectionChange?: (selection: GodsEyeSelectionRef | null) => void;
  onLayerStateChange?: (state: GodsEyeLayerState) => void;
  onCommandResult?: (result: GodsEyeCommandResult) => void;
  onError?: (error: { code: string; message: string }) => void;
};

/** React owns the pane; the controlled native app owns everything inside it. */
const GodsEyeSurface = forwardRef<GodsEyeBridge, GodsEyeSurfaceProps>(function GodsEyeSurface({
  projectId,
  cardId,
  onReady,
  onBridgeUnavailable,
  onSelectionChange,
  onLayerStateChange,
  onCommandResult,
  onError,
}, bridgeRef): React.ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const mountRef = useRef<NativeWorldViewMount | null>(null);
  const [status, setStatus] = useState<'starting' | 'ready' | 'failed'>('starting');
  const [failure, setFailure] = useState<string | null>(null);
  const callbacksRef = useRef({
    onReady,
    onBridgeUnavailable,
    onSelectionChange,
    onLayerStateChange,
    onCommandResult,
    onError,
  });
  useEffect(() => {
    callbacksRef.current = {
      onReady,
      onBridgeUnavailable,
      onSelectionChange,
      onLayerStateChange,
      onCommandResult,
      onError,
    };
  });

  useImperativeHandle(bridgeRef, () => ({
    setLayerVisibility(layerId, enabled, options) {
      return mountRef.current?.setLayerVisibility(layerId, enabled, options) ?? null;
    },
    focusSelection(selection) {
      return mountRef.current?.focusSelection(selection) ?? null;
    },
    executeAction(name, args) {
      return mountRef.current?.executeAction(name, args)
        ?? Promise.reject(new Error('worldview_action_unavailable'));
    },
    prepareRunImages() {
      return mountRef.current?.prepareRunImages()
        ?? Promise.reject(new Error('worldview_turn_context_unavailable'));
    },
  }), []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    let cancelled = false;
    let pendingReadyVersion: string | null = null;
    setStatus('starting');
    setFailure(null);
    mountRef.current = null;
    callbacksRef.current.onBridgeUnavailable?.();

    void loadWorldViewNative(root, {
      projectId,
      cardId,
      callbacks: {
        onReady(sourceVersion) {
          if (cancelled) return;
          if (!mountRef.current) {
            pendingReadyVersion = sourceVersion;
            return;
          }
          setStatus('ready');
          callbacksRef.current.onReady?.(sourceVersion);
        },
        onSelectionChange(selection) {
          if (!cancelled) callbacksRef.current.onSelectionChange?.(
            selection as GodsEyeSelectionRef | null,
          );
        },
        onLayerStateChange(state) {
          if (!cancelled) callbacksRef.current.onLayerStateChange?.(
            state as GodsEyeLayerState,
          );
        },
        onCommandResult(result) {
          if (!cancelled) callbacksRef.current.onCommandResult?.(
            result as GodsEyeCommandResult,
          );
        },
        onError(error) {
          if (cancelled) return;
          setFailure(`${error.code}: ${error.message}`);
          callbacksRef.current.onError?.(error);
        },
      },
    }).then((mounted) => {
      if (cancelled) {
        void mounted.destroy();
        return;
      }
      mountRef.current = mounted;
      if (pendingReadyVersion) {
        setStatus('ready');
        callbacksRef.current.onReady?.(pendingReadyVersion);
        pendingReadyVersion = null;
      }
    }).catch((error) => {
      if (cancelled) return;
      const message = error instanceof Error ? error.message : String(error);
      setStatus('failed');
      setFailure(message);
      callbacksRef.current.onError?.({
        code: 'worldview_native_mount_failed',
        message,
      });
    });

    return () => {
      cancelled = true;
      const mounted = mountRef.current;
      mountRef.current = null;
      callbacksRef.current.onBridgeUnavailable?.();
      if (mounted) void mounted.destroy();
    };
  }, [cardId, projectId]);

  return (
    <section style={styles.root} aria-label="WorldView globe">
      <div ref={rootRef} id="worldview-native-root" style={styles.mount} />
      {status === 'failed' ? (
        <div style={styles.failed} role="alert">
          <strong>WorldView could not start</strong>
          <code style={styles.error}>{failure}</code>
        </div>
      ) : null}
    </section>
  );
});

export default GodsEyeSurface;

const styles: Record<string, React.CSSProperties> = {
  root: {
    position: 'relative',
    width: '100%',
    height: '100%',
    minHeight: 0,
    overflow: 'hidden',
    background: '#050b10',
  },
  mount: { position: 'absolute', inset: 0, minWidth: 0, minHeight: 0 },
  failed: {
    position: 'absolute',
    inset: 0,
    zIndex: 1001,
    display: 'grid',
    placeContent: 'center',
    gap: 10,
    padding: 32,
    textAlign: 'center',
    color: '#d9f7f2',
    background: '#050b10',
  },
  error: { maxWidth: 640, color: '#e5a069', whiteSpace: 'pre-wrap' },
};
