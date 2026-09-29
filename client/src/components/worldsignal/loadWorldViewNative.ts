import nativeDocument from '../../../../worldsignal/gods-eye-view-main/index.html?raw';
import scopedStyles from 'virtual:worldview-native-css';

export type NativeWorldViewCallbacks = {
  onReady?: (sourceVersion: string) => void;
  onSelectionChange?: (selection: unknown) => void;
  onLayerStateChange?: (state: unknown) => void;
  onLayerVisibilityChange?: (change: { layerId: string; enabled: boolean }) => void;
  onCommandResult?: (result: unknown) => void;
  onError?: (error: { code: string; message: string }) => void;
};

export type NativeWorldViewMount = {
  attachInspectorControls: (host: HTMLElement) => { detach: () => void };
  selectInspectorTab: (tab: string) => boolean;
  setLayerVisibility: (
    layerId: string,
    enabled: boolean,
    options?: { exitIncompatibleContext?: boolean; origin?: 'user' | 'restore' },
  ) => string | null;
  setSatelliteParams: (params: {
    catalog?: 'core' | 'dense';
    showPoints?: boolean;
    showOrbits?: boolean;
  }) => string | null;
  focusSelection: (selection: unknown) => string | null;
  executeAction: (
    name: string,
    args?: Record<string, unknown>,
    options?: { disabledLayerIds?: string[]; signal?: AbortSignal },
  ) => Promise<unknown>;
  prepareRunImages: () => Promise<Array<Record<string, unknown>>>;
  destroy: () => Promise<void>;
};

/** Load the controlled native fork only when the WorldView surface is shown. */
export async function loadWorldViewNative(
  root: HTMLElement,
  config: {
    projectId: string;
    cardId: string;
    callbacks: NativeWorldViewCallbacks;
  },
): Promise<NativeWorldViewMount> {
  const { mountWorldView } = await import(
    '../../../../worldsignal/gods-eye-view-main/src/app/mount.js'
  );
  return mountWorldView(root, {
    ...config,
    documentMarkup: nativeDocument,
    scopedStyles,
    runtimeBaseUrl: '/worldview-native/',
    sourceVersion: '0.1.1',
  });
}
