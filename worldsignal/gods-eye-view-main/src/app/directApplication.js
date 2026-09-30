import * as Cesium from 'cesium';
import { createApplication } from './application.js';
import { createApplicationViewer, installTrackpadPinchZoom } from './viewer.js';
import { StyleManager } from '../ui.js';
import { flyToAustin } from '../camera.js';
import { DataLayerManager } from '../data/manager.js';
import flightsLayer from '../data/flights.js';
import militaryFlightsLayer from '../data/militaryFlights.js';
import earthquakesLayer from '../data/earthquakes.js';
import satellitesLayer from '../data/satellites.js';
import rocketLaunchesLayer from '../data/rocketLaunches.js';
import trafficLayer from '../data/traffic.js';
import cctvLayer from '../data/cctv.js';
import radioLayer from '../data/radio.js';
import bikeshareLayer from '../data/bikeshare.js';
import aisLiveVesselsLayer from '../data/aisLiveVessels.js';
import militaryInstallationsLayer from '../data/militaryInstallations.js';
import militaryAwarenessLayer from '../data/militaryAwareness.js';
import localDataLayers from '../data/localLayers.js';
import { LAYER_STATE_REGISTRY } from '../data/layerState.js';
import { registerDataCredits } from '../data/dataCredits.js';
import { SceneDirector } from '../scenes/director.js';
import { initGevVoiceCommands } from '../voice/gevRealtime.js';
import { createGevActionRunner } from '../voice/gevActions.js';
import { captureViewportImage } from '../voice/realtimeViewport.js';
import { MapStackController } from '../mapStackController.js';
import { initAnnotations } from '../annotations/index.js';
import { initLogoGaze } from '../logoGaze.js';
import { initCockpitCloudEffects } from '../cockpitCloudEffects.js';
import {
  installRenderGovernor,
  uninstallRenderGovernor,
  getRenderGovernorDiagnostics,
  governorRequestRender,
  holdContinuousRender,
  releaseContinuousRender,
} from '../renderGovernor.js';
import { installScopeMask, destroyScopeMask } from '../scopeMask.js';
import { initFirstRunExperience } from '../firstRunExperience.js';
import { resetContextStore } from '../data/contextStore.js';
import { createDirectHostBridge } from './directBridge.js';
import {
  getExposedApplicationViewport,
  getExposedPerspectiveXOffset,
} from './viewport.js';

function describeError(error) {
  if (!error) return 'Unknown initialization error';
  if (error instanceof Error) return error.message?.trim() || error.name || 'Initialization error';
  if (typeof error === 'string' && error.trim()) return error.trim();
  if (typeof error === 'object') {
    const message = String(error.message || error.error || '').trim();
    if (message) return message;
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== '{}') return serialized;
    } catch { /* best effort */ }
  }
  return String(error);
}

function requiredElement(root, selector) {
  const element = root.querySelector(selector);
  if (!element) throw new Error(`worldview_native_element_missing:${selector}`);
  return element;
}

function installRootResize(root, viewer) {
  let lastWidth = 0;
  let lastHeight = 0;
  let lastVisibleWidth = -1;
  let lastOccludedLeft = -1;
  let managedFrustum = null;
  let baseXOffset = 0;
  let exposedViewport = null;
  const previousSafeInset = root.style.getPropertyValue('--worldview-occluded-left');
  const syncProjection = () => {
    const frustum = viewer.camera?.frustum;
    if (frustum !== managedFrustum) {
      managedFrustum = frustum;
      baseXOffset = Number.isFinite(frustum?.xOffset) ? frustum.xOffset : 0;
    }
    const offset = getExposedPerspectiveXOffset(
      frustum,
      exposedViewport,
      baseXOffset,
    );
    if (offset !== null && Math.abs(frustum.xOffset - offset) > 1e-9) {
      frustum.xOffset = offset;
    }
  };
  const resize = () => {
    const rect = root.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const exposed = getExposedApplicationViewport(root);
    exposedViewport = exposed?.width > 0 ? exposed : null;
    const visibleWidth = Math.round(exposed?.width ?? width);
    const occludedLeft = exposed?.width > 0
      ? Math.round(exposed.occludedLeft) : 0;
    if (width === lastWidth && height === lastHeight
      && visibleWidth === lastVisibleWidth && occludedLeft === lastOccludedLeft) return;
    const rootChanged = width !== lastWidth || height !== lastHeight;
    lastWidth = width;
    lastHeight = height;
    lastVisibleWidth = visibleWidth;
    lastOccludedLeft = occludedLeft;
    root.style.setProperty('--worldview-occluded-left', `${occludedLeft}px`);
    if (rootChanged) viewer.resize?.();
    syncProjection();
    governorRequestRender('worldview-root-resize');
    window.dispatchEvent(new CustomEvent('gev:viewport-resize', {
      detail: { width, height, left: rect.left, top: rect.top,
        visibleWidth, occludedLeft },
    }));
    // Retained native controllers historically subscribe to window.resize.
    // A React pane can resize without the browser window changing, so mirror
    // that native signal after the root-local dimensions have settled.
    window.dispatchEvent(new Event('resize'));
  };
  const removePreRender = viewer.scene?.preRender?.addEventListener?.(syncProjection);
  const clip = root.closest?.('[data-companion-visible-viewport="true"]');
  const cleanup = (stopObserving) => () => {
    stopObserving();
    removePreRender?.();
    if (managedFrustum && Number.isFinite(managedFrustum.xOffset)) {
      managedFrustum.xOffset = baseXOffset;
    }
    if (previousSafeInset) root.style.setProperty('--worldview-occluded-left', previousSafeInset);
    else root.style.removeProperty('--worldview-occluded-left');
  };
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(resize);
    observer.observe(root);
    if (clip) observer.observe(clip);
    resize();
    return cleanup(() => observer.disconnect());
  }
  window.addEventListener('resize', resize);
  resize();
  return cleanup(() => window.removeEventListener('resize', resize));
}

function registerNativeLayers(dataManager) {
  dataManager.register(flightsLayer);
  dataManager.register(militaryFlightsLayer);
  dataManager.register(earthquakesLayer);
  dataManager.register(satellitesLayer);
  dataManager.register(rocketLaunchesLayer);
  rocketLaunchesLayer.attachDataManager(dataManager);
  dataManager.register(trafficLayer);
  dataManager.register(cctvLayer);
  dataManager.register(radioLayer);
  dataManager.register(bikeshareLayer);
  dataManager.register(aisLiveVesselsLayer);
  dataManager.register(militaryInstallationsLayer);
  dataManager.register(militaryAwarenessLayer);
  militaryAwarenessLayer.attachDataManager(dataManager);
  for (const layer of localDataLayers) dataManager.register(layer);
  dataManager.finalizeRegistrations(
    LAYER_STATE_REGISTRY.filter((entry) => entry.id !== 'telegeography-submarine-cables'),
  );
}

/**
 * Compose the controlled fork into the current upstream modular lifecycle.
 * The constructors deliberately keep the local native implementations intact.
 */
export function createWorldViewApplication({
  root,
  projectId = null,
  cardId = null,
  callbacks = {},
  supervised = true,
  allowQaRegistration = import.meta.env.DEV,
  googleApiKey = import.meta.env.GOOGLE_MAPS_API_KEY,
  cesiumToken = import.meta.env.CESIUM_ION_TOKEN,
  sourceVersion = '0.1.1',
} = {}) {
  if (!root?.querySelector) throw new TypeError('A caller-owned WorldView root is required');
  resetContextStore();
  const loadingScreen = requiredElement(root, '#loading-screen');
  const loaderStatus = requiredElement(loadingScreen, '.loader-status');

  return createApplication({
    createScene: async ({ signal, defer }) => {
      defer(() => resetContextStore());
      loaderStatus.textContent = 'Configuring viewer...';
      if (cesiumToken) Cesium.Ion.defaultAccessToken = cesiumToken;
      // The mounted app may use Cesium ion's cached Google Photorealistic
      // asset without a direct Google Maps key. Reset the module-global key
      // when none was supplied so Cesium takes its native ion branch rather
      // than a key left behind by an earlier mount.
      Cesium.GoogleMaps.defaultApiKey = googleApiKey || undefined;
      if (!googleApiKey && !supervised) {
        throw new Error('GOOGLE_MAPS_API_KEY not found. Set it as an environment variable.');
      }
      const canAttemptPhotoreal = Boolean(googleApiKey || (supervised && cesiumToken));
      const previousGoogleKey = window.__GOOGLE_MAPS_API_KEY__;
      window.__GOOGLE_MAPS_API_KEY__ = googleApiKey;
      defer(() => {
        if (window.__GOOGLE_MAPS_API_KEY__ !== googleApiKey) return;
        if (previousGoogleKey === undefined) delete window.__GOOGLE_MAPS_API_KEY__;
        else window.__GOOGLE_MAPS_API_KEY__ = previousGoogleKey;
      });

      const container = requiredElement(root, '#cesiumContainer');
      const creditContainer = document.createElement('div');
      creditContainer.id = 'cesium-credits';
      root.appendChild(creditContainer);
      defer(() => creditContainer.remove());
      const viewer = createApplicationViewer({ container, creditContainer });
      defer(() => { if (!viewer.isDestroyed?.()) viewer.destroy(); });
      defer(installTrackpadPinchZoom(viewer));
      defer(installRootResize(root, viewer));
      registerDataCredits(viewer);
      viewer.scene.globe.show = !canAttemptPhotoreal;

      loaderStatus.textContent = canAttemptPhotoreal
        ? 'Loading Google 3D Tiles...'
        : 'Using the keyless OSM globe stack...';
      let tileset = null;
      if (canAttemptPhotoreal) {
        try {
          tileset = await Cesium.createGooglePhotorealistic3DTileset({
            onlyUsingWithGoogleGeocoder: true,
          });
          signal.throwIfAborted();
          viewer.scene.primitives.add(tileset);
          viewer.scene.globe.show = false;
        } catch (error) {
          if (signal.aborted) throw error;
          console.warn('[WorldView] Google 3D Tiles unavailable; using Cesium globe:', error);
          loaderStatus.textContent = `Google 3D Tiles unavailable (${describeError(error)}). Continuing in fallback mode...`;
          viewer.scene.globe.show = true;
        }
      } else {
        viewer.scene.globe.show = true;
      }

      loaderStatus.textContent = 'Initializing systems...';
      const mapStackController = new MapStackController(viewer, {
        googleTileset: tileset,
        cesiumToken,
        initialStack: tileset ? 'photoreal' : 'osm',
        onChange: (state) => {
          window.dispatchEvent(new CustomEvent('gev:map-stack-changed', { detail: state }));
        },
        onError: (message) => console.warn('[MapStack]', message),
      });
      await mapStackController.setStack(tileset ? 'photoreal' : 'osm', { silent: true });
      signal.throwIfAborted();
      return { viewer, tileset, mapStackController };
    },

    createControls: ({ scene, defer }) => {
      const { viewer, mapStackController } = scene;
      const styleManager = new StyleManager(viewer, {
        mapStackController,
        supervisedEmbed: supervised,
      });
      defer(() => styleManager.dispose());
      const cockpitCloudEffects = initCockpitCloudEffects(viewer);
      defer(() => cockpitCloudEffects?.destroy?.());
      const disposeLogoGaze = initLogoGaze(root);
      defer(disposeLogoGaze);

      if (styleManager.hasShareState) loaderStatus.textContent = 'Restoring shared view...';
      else if (supervised) loaderStatus.textContent = 'WorldView ready.';
      else {
        loaderStatus.textContent = 'Flying to Austin, TX...';
        flyToAustin(viewer);
      }
      return { styleManager, cockpitCloudEffects };
    },

    createData: ({ scene, controls, defer }) => {
      const dataManager = new DataLayerManager(scene.viewer, { allowQaRegistration });
      defer(() => dataManager.destroyAll());
      registerNativeLayers(dataManager);
      if (allowQaRegistration) {
        const qaRegister = (targetManager, layerModule) => {
          if (targetManager !== dataManager) throw new Error('QA layer manager mismatch');
          return dataManager.registerForQa(layerModule);
        };
        const qaUnregister = (targetManager, layerId) => {
          if (targetManager !== dataManager) throw new Error('QA layer manager mismatch');
          return dataManager.unregisterForQa(layerId);
        };
        window.__gevQaRegisterLayer = qaRegister;
        window.__gevQaUnregisterLayer = qaUnregister;
        defer(() => {
          if (window.__gevQaRegisterLayer === qaRegister) delete window.__gevQaRegisterLayer;
          if (window.__gevQaUnregisterLayer === qaUnregister) delete window.__gevQaUnregisterLayer;
        });
      }
      dataManager.buildTogglePanel(requiredElement(root, '#data-toggles'));
      controls.styleManager.attachDataManager(dataManager);
      return { dataManager };
    },

    createTools: ({ scene, controls, data, defer }) => {
      const { viewer, tileset, mapStackController } = scene;
      const { styleManager, cockpitCloudEffects } = controls;
      const { dataManager } = data;
      const sceneDirector = new SceneDirector(viewer, styleManager, dataManager);
      defer(() => sceneDirector.destroy());
      const annotations = initAnnotations({ viewer, tileset });
      defer(() => annotations.destroy());

      installRenderGovernor(viewer);
      defer(() => uninstallRenderGovernor(viewer));
      installScopeMask(viewer);
      defer(() => destroyScopeMask());

      const onTrackedEntityChanged = () => {
        if (viewer.trackedEntity) holdContinuousRender('tracked-entity');
        else releaseContinuousRender('tracked-entity');
      };
      viewer.trackedEntityChanged.addEventListener(onTrackedEntityChanged);
      defer(() => {
        viewer.trackedEntityChanged.removeEventListener(onTrackedEntityChanged);
        releaseContinuousRender('tracked-entity');
      });

      const syncVisibilitySuspension = () => {
        const hidden = document.hidden;
        viewer.useDefaultRenderLoop = !hidden;
        cockpitCloudEffects?.setSuspended?.(hidden);
        if (!hidden) {
          if (dataManager._panelRefreshPendingOnVisible) {
            dataManager._panelRefreshPendingOnVisible = false;
            dataManager._refreshTogglePanel();
          }
          governorRequestRender('visibility-restore');
        }
      };
      document.addEventListener('visibilitychange', syncVisibilitySuspension);
      defer(() => document.removeEventListener('visibilitychange', syncVisibilitySuspension));
      syncVisibilitySuspension();

      // LiquidAIty's supervised mount is a capability surface for the saved
      // WorldView Hermes Card. It must not create the upstream standalone
      // Realtime voice agent or inject its second microphone/conversation UI.
      // Keep that upstream controller only for the fork's unsupervised app.
      const voiceCommands = supervised ? null : initGevVoiceCommands({
        viewer,
        root,
        styleManager,
        dataManager,
        sceneDirector,
        annotations,
      });
      if (voiceCommands) {
        defer(() => {
          voiceCommands.stop?.({ removeUi: true });
          if (window.__gevVoiceCommands === voiceCommands) delete window.__gevVoiceCommands;
        });
      }

      const runAction = supervised
        ? createGevActionRunner({ viewer, styleManager, dataManager, sceneDirector, annotations })
        : null;
      const captureViewport = supervised ? async () => {
        let metadata = null;
        const dataUrl = await captureViewportImage({
          viewer,
          root,
          onCapture: (value) => { metadata = value; },
        });
        return dataUrl ? { dataUrl, ...metadata } : null;
      } : null;

      const directBridge = supervised ? createDirectHostBridge({
        dataManager,
        contextController: styleManager,
        runAction,
        captureViewport,
        focusPosition: ({ longitude, latitude }) => new Promise((resolve, reject) => {
          if (viewer.scene.mode === Cesium.SceneMode.MORPHING) {
            reject(new Error('Focus unavailable while globe mode is changing'));
            return;
          }
          viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(longitude, latitude, 800000),
            duration: 1.2,
            complete: resolve,
            cancel: () => reject(new Error('Focus flight cancelled')),
          });
        }),
        projectCartesianPosition: (position) => {
          const cartographic = Cesium.Cartographic.fromCartesian(position);
          return cartographic ? {
            longitude: Cesium.Math.toDegrees(cartographic.longitude),
            latitude: Cesium.Math.toDegrees(cartographic.latitude),
          } : null;
        },
        sourceStateReady: styleManager.sourceStateReadyPromise,
        sourceVersion,
        projectId,
        cardId,
        callbacks,
      }) : null;
      defer(() => directBridge?.destroy?.());

      const runtime = {
        root,
        viewer,
        styleManager,
        tileset,
        dataManager,
        sceneDirector,
        mapStackController,
        annotations,
        weatherEffects: null,
        cockpitCloudEffects,
        voiceCommands,
        runAction,
        bridge: directBridge,
        getRenderGovernorDiagnostics,
        requestRender: governorRequestRender,
      };
      window.__godsEyeView = runtime;
      defer(() => {
        if (window.__godsEyeView === runtime) delete window.__godsEyeView;
      });

      let revealTimer = null;
      let firstRun = null;
      let active = true;
      Promise.allSettled([
        styleManager.initialRestorePromise,
        new Promise((resolve) => { revealTimer = window.setTimeout(resolve, 1000); }),
      ]).then(() => {
        if (!active) return;
        loadingScreen.classList.add('hidden');
        if (!supervised) firstRun = initFirstRunExperience({ styleManager, dataManager });
      });
      defer(() => {
        active = false;
        if (revealTimer !== null) window.clearTimeout(revealTimer);
        firstRun?.dismiss?.();
      });
      return { sceneDirector, annotations, voiceCommands, runAction, bridge: directBridge };
    },
  });
}
