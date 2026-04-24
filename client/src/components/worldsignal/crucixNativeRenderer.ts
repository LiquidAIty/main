import Globe from 'globe.gl';
import * as THREE from 'three';
import * as d3 from 'd3';

type CrucixPoint = {
  lat: number;
  lon: number;
  size: number;
  color: string;
  label: string;
};

type CrucixArc = {
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  color: string;
};

type CrucixData = any;

type GlobeInstance = {
  globeImageUrl: (url: string) => GlobeInstance;
  bumpImageUrl: (url: string) => GlobeInstance;
  backgroundImageUrl: (url: string) => GlobeInstance;
  showAtmosphere: (show: boolean) => GlobeInstance;
  atmosphereColor: (color: string) => GlobeInstance;
  atmosphereAltitude: (altitude: number) => GlobeInstance;
  pointAltitude: (value: string) => GlobeInstance;
  pointRadius: (value: number) => GlobeInstance;
  arcColor: (value: string) => GlobeInstance;
  arcAltitude: (value: number) => GlobeInstance;
  arcStroke: (value: number) => GlobeInstance;
  arcDashLength: (value: number) => GlobeInstance;
  arcDashGap: (value: number) => GlobeInstance;
  arcDashAnimateTime: (value: number) => GlobeInstance;
  globeMaterial?: () => any;
  width: (value: number) => GlobeInstance;
  height: (value: number) => GlobeInstance;
  controls?: () => any;
  pointsData: (value: any[]) => GlobeInstance;
  arcsData: (value: any[]) => GlobeInstance;
  pointOfView: (value?: any, duration?: number) => any;
  renderer?: () => any;
  pauseAnimation?: () => void;
  resumeAnimation?: () => void;
};

type TopoJsonClient = {
  feature: (topology: any, object: any) => any;
  mesh: (topology: any, object: any, filter: (a: any, b: any) => boolean) => any;
};

const REGION_POV = {
  world: { lat: 20, lng: 20, altitude: 1.8 },
  americas: { lat: 35, lng: -95, altitude: 1.0 },
  europe: { lat: 50, lng: 15, altitude: 1.0 },
  middleEast: { lat: 28, lng: 45, altitude: 1.1 },
  asiaPacific: { lat: 25, lng: 110, altitude: 1.2 },
  africa: { lat: 5, lng: 20, altitude: 1.2 },
} as const;

const FLAT_REGION_BOUNDS = {
  world: [[-180, -60], [180, 80]],
  americas: [[-130, 10], [-60, 55]],
  europe: [[-12, 34], [45, 72]],
  middleEast: [[24, 10], [65, 45]],
  asiaPacific: [[60, -12], [180, 55]],
  africa: [[-20, -36], [55, 38]],
} as const;

const WORLD_ATLAS_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';
const TOPOJSON_ESM_URL = 'https://cdn.jsdelivr.net/npm/topojson-client@3/+esm';

let worldAtlasPromise: Promise<any> | null = null;
let topojsonPromise: Promise<TopoJsonClient> | null = null;

function loadWorldAtlas() {
  if (!worldAtlasPromise) {
    worldAtlasPromise = fetch(WORLD_ATLAS_URL).then(async (response) => {
      if (!response.ok) {
        throw new Error(`worldsignal_world_atlas_http_${response.status}`);
      }
      return response.json();
    });
  }
  return worldAtlasPromise;
}

function loadTopoJsonClient() {
  if (!topojsonPromise) {
    topojsonPromise = import(/* @vite-ignore */ TOPOJSON_ESM_URL) as Promise<TopoJsonClient>;
  }
  return topojsonPromise;
}


export type CrucixRegion = keyof typeof REGION_POV;

export type CrucixRenderer = {
  update: (data: CrucixData | null) => void;
  setFlatMode: (enabled: boolean) => void;
  setRegion: (region: CrucixRegion) => void;
  zoom: (factor: number) => void;
  setFlightsVisible: (enabled: boolean) => void;
  destroy: () => void;
};

function toNum(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function setContainerRenderStats(container: HTMLElement, points: CrucixPoint[], arcs: CrucixArc[]) {
  container.dataset.worldsignalVisualReady = '1';
  container.dataset.worldsignalFallback = '0';
  container.dataset.worldsignalPointCount = String(points.length);
  container.dataset.worldsignalArcCount = String(arcs.length);
}

function buildPoints(data: CrucixData | null): CrucixPoint[] {
  if (!data) return [];
  const points: CrucixPoint[] = [];
  const add = (lat: unknown, lon: unknown, label: string, color: string, size = 0.18) => {
    const latN = toNum(lat);
    const lonN = toNum(lon);
    if (latN == null || lonN == null) return;
    points.push({ lat: latN, lon: lonN, label, color, size });
  };

  const weather = Array.isArray(data?.noaa?.alerts) ? data.noaa.alerts : [];
  weather.slice(0, 40).forEach((row: any) =>
    add(row?.lat, row?.lon, String(row?.event || 'Weather'), 'rgba(255,184,76,0.95)', 0.14),
  );

  const maritime = Array.isArray(data?.chokepoints?.items)
    ? data.chokepoints.items
    : Array.isArray(data?.chokepoints)
      ? data.chokepoints
      : [];
  maritime.slice(0, 40).forEach((row: any) =>
    add(row?.lat, row?.lon, String(row?.label || 'Maritime'), 'rgba(179,136,255,0.95)', 0.16),
  );

  const tgUrgent = Array.isArray(data?.tg?.urgent) ? data.tg.urgent : [];
  tgUrgent.slice(0, 70).forEach((row: any) =>
    add(
      row?.lat,
      row?.lon,
      String(row?.text || 'Open Intelligence'),
      'rgba(255,95,99,0.95)',
      0.15,
    ),
  );

  const gdelt = Array.isArray(data?.gdelt?.geoPoints)
    ? data.gdelt.geoPoints
    : Array.isArray(data?.gdelt?.geo)
      ? data.gdelt.geo
      : [];
  gdelt.slice(0, 60).forEach((row: any) =>
    add(
      row?.lat,
      row?.lon,
      String(row?.name || row?.title || 'Open Intelligence'),
      'rgba(129,212,250,0.9)',
      0.12,
    ),
  );

  const conflict = Array.isArray(data?.acled?.deadliestEvents)
    ? data.acled.deadliestEvents
    : Array.isArray(data?.acled?.events)
      ? data.acled.events
      : [];
  conflict.slice(0, 50).forEach((row: any) =>
    add(
      row?.lat,
      row?.lon,
      String(row?.location || row?.event_type || 'Geopolitical Risk'),
      'rgba(255,100,110,0.92)',
      0.17,
    ),
  );

  const sats = Array.isArray(data?.space?.stationPositions) ? data.space.stationPositions : [];
  sats.slice(0, 20).forEach((row: any) =>
    add(row?.lat, row?.lon, String(row?.name || 'Satellite'), 'rgba(224,176,255,0.92)', 0.13),
  );

  return points;
}

function buildArcs(data: CrucixData | null, flightsVisible: boolean): CrucixArc[] {
  if (!flightsVisible || !data) return [];
  const arcs: CrucixArc[] = [];
  const hubs = [
    { lat: 25.27, lon: 55.29 },
    { lat: 1.35, lon: 103.82 },
    { lat: 51.5, lon: -0.12 },
    { lat: 40.71, lon: -74.0 },
  ];

  const chokepoints = Array.isArray(data?.chokepoints?.items)
    ? data.chokepoints.items
    : Array.isArray(data?.chokepoints)
      ? data.chokepoints
      : [];

  chokepoints.slice(0, 30).forEach((cp: any, index: number) => {
    const lat = toNum(cp?.lat);
    const lon = toNum(cp?.lon);
    if (lat == null || lon == null) return;
    const hub = hubs[index % hubs.length];
    arcs.push({
      startLat: hub.lat,
      startLng: hub.lon,
      endLat: lat,
      endLng: lon,
      color: 'rgba(100,240,200,0.72)',
    });
  });

  return arcs;
}

function waitForContainerSize(container: HTMLElement, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const tick = () => {
      const rect = container.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        resolve();
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error('worldsignal_container_no_size'));
        return;
      }
      window.requestAnimationFrame(tick);
    };
    tick();
  });
}

export async function mountCrucixRenderer(
  container: HTMLElement,
  initialData: CrucixData | null,
): Promise<CrucixRenderer> {
  await waitForContainerSize(container);

  if (getComputedStyle(container).position === 'static') {
    container.style.position = 'relative';
  }

  const globeHost = document.createElement('div');
  globeHost.style.position = 'absolute';
  globeHost.style.inset = '0';
  globeHost.style.display = 'block';
  globeHost.setAttribute('data-testid', 'worldsignal-globe-host');

  const flatSvgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  flatSvgEl.style.position = 'absolute';
  flatSvgEl.style.inset = '0';
  flatSvgEl.style.width = '100%';
  flatSvgEl.style.height = '100%';
  flatSvgEl.style.display = 'none';
  flatSvgEl.style.cursor = 'grab';
  flatSvgEl.setAttribute('data-testid', 'worldsignal-flat-map');

  container.innerHTML = '';
  container.appendChild(globeHost);
  container.appendChild(flatSvgEl);

  const globe = ((Globe as unknown as () => (node: HTMLElement) => GlobeInstance)())(globeHost)
    .globeImageUrl('//unpkg.com/three-globe/example/img/earth-night.jpg')
    .bumpImageUrl('//unpkg.com/three-globe/example/img/earth-topology.png')
    .backgroundImageUrl('//unpkg.com/three-globe/example/img/night-sky.png')
    .showAtmosphere(true)
    .atmosphereColor('#64f0c8')
    .atmosphereAltitude(0.16)
    .pointAltitude('size')
    .pointRadius(0.35)
    .arcColor('color')
    .arcAltitude(0.15)
    .arcStroke(0.6)
    .arcDashLength(0.7)
    .arcDashGap(0.22)
    .arcDashAnimateTime(1900);

  const globeMaterial = globe.globeMaterial?.();
  if (globeMaterial) {
    globeMaterial.color = new THREE.Color('#12324a');
    globeMaterial.emissive = new THREE.Color('#071922');
    globeMaterial.emissiveIntensity = 0.38;
    globeMaterial.shininess = 0.18;
  }

  const globeCanvas =
    (globeHost.querySelector('canvas') as HTMLCanvasElement | null) ||
    (globe.renderer?.()?.domElement as HTMLCanvasElement | undefined) ||
    null;
  if (!globeCanvas) throw new Error('worldsignal_canvas_missing');
  if (!globeHost.contains(globeCanvas)) globeHost.appendChild(globeCanvas);
  globeCanvas.setAttribute('data-testid', 'worldsignal-visible-map');
  globeCanvas.style.width = '100%';
  globeCanvas.style.height = '100%';
  globeCanvas.style.display = 'block';

  const flatSvg = d3.select(flatSvgEl);
  let flatProjection: d3.GeoProjection | null = null;
  let flatPath: d3.GeoPath<any, d3.GeoPermissibleObjects> | null = null;
  let flatRoot = flatSvg.append('g').attr('class', 'flat-root');
  let flatZoomBehavior: d3.ZoomBehavior<SVGSVGElement, unknown> | null = null;
  let flatTransform = d3.zoomIdentity;
  let flatDrawRun = 0;

  let flatMode = false;
  let showFlights = true;
  let latestData = initialData;
  let activeRegion: CrucixRegion = 'world';

  const controls = globe.controls?.();
  if (controls) {
    controls.enableDamping = true;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.33;
  }

  const resizeGlobe = () => {
    const rect = container.getBoundingClientRect();
    const width = Math.max(Math.floor(rect.width || container.clientWidth), 420);
    const height = Math.max(Math.floor(rect.height || container.clientHeight), 420);
    globe.width(width).height(height);
    globeCanvas.style.width = '100%';
    globeCanvas.style.height = '100%';
  };

  const initFlatProjection = () => {
    const rect = container.getBoundingClientRect();
    const width = Math.max(Math.floor(rect.width || container.clientWidth), 420);
    const height = Math.max(Math.floor(rect.height || container.clientHeight), 420);
    flatSvgEl.style.width = `${width}px`;
    flatSvgEl.style.height = `${height}px`;
    flatSvgEl.setAttribute('width', String(width));
    flatSvgEl.setAttribute('height', String(height));
    flatSvg.attr('viewBox', `0 0 ${width} ${height}`).attr('preserveAspectRatio', 'xMidYMid meet');
    flatProjection = d3
      .geoNaturalEarth1()
      .fitSize([width - 20, height - 20], { type: 'Sphere' })
      .translate([width / 2, height / 2]);
    flatPath = d3.geoPath(flatProjection);
  };

  const applyFlatRegion = (region: CrucixRegion) => {
    if (!flatProjection || !flatZoomBehavior) return;
    if (region === 'world') {
      flatSvg.transition().duration(750).call(flatZoomBehavior.transform, d3.zoomIdentity);
      return;
    }
    const bounds = FLAT_REGION_BOUNDS[region] as readonly [readonly [number, number], readonly [number, number]];
    const p0 = flatProjection(bounds[0] as [number, number]);
    const p1 = flatProjection(bounds[1] as [number, number]);
    if (!p0 || !p1) return;
    const rect = container.getBoundingClientRect();
    const width = Math.max(Math.floor(rect.width || container.clientWidth), 420);
    const height = Math.max(Math.floor(rect.height || container.clientHeight), 420);
    const dx = Math.abs(p1[0] - p0[0]);
    const dy = Math.abs(p1[1] - p0[1]);
    const cx = (p0[0] + p1[0]) / 2;
    const cy = (p0[1] + p1[1]) / 2;
    const scale = Math.min(width / dx, height / dy) * 0.85;
    const target = d3.zoomIdentity.translate(width / 2 - scale * cx, height / 2 - scale * cy).scale(scale);
    flatSvg.transition().duration(750).call(flatZoomBehavior.transform, target);
  };

  const drawFlatMap = (data: CrucixData | null) => {
    initFlatProjection();
    if (!flatProjection || !flatPath) return;

    flatDrawRun += 1;
    const drawRun = flatDrawRun;

    flatRoot.remove();
    flatRoot = flatSvg.append('g').attr('class', 'flat-root');
    flatRoot.attr('transform', flatTransform.toString());

    flatRoot
      .append('path')
      .datum(d3.geoGraticule()())
      .attr('class', 'graticule')
      .attr('fill', 'none')
      .attr('stroke', 'rgba(100,240,200,0.04)')
      .attr('stroke-width', 0.4)
      .attr('d', flatPath);

    void Promise.all([loadTopoJsonClient(), loadWorldAtlas()])
      .then(([topojson, world]) => {
        if (drawRun !== flatDrawRun) return;
        const countries = topojson.feature(world, world.objects.countries);
        flatRoot
          .selectAll('path.land')
          .data(countries.features)
          .enter()
          .append('path')
          .attr('class', 'land')
          .attr('fill', 'rgba(180,200,210,0.08)')
          .attr('stroke', 'rgba(200,220,230,0.15)')
          .attr('stroke-width', 0.5)
          .attr('d', flatPath as any);

        flatRoot
          .append('path')
          .datum(topojson.mesh(world, world.objects.countries, (a, b) => a !== b))
          .attr('class', 'border')
          .attr('fill', 'none')
          .attr('stroke', 'rgba(200,220,230,0.08)')
          .attr('stroke-width', 0.3)
          .attr('d', flatPath as any);

        const points = buildPoints(data);
        const arcs = buildArcs(data, showFlights);

        if (showFlights) {
          const arcsLayer = flatRoot.append('g').attr('class', 'corridors-layer');
          arcs.forEach((arc) => {
            const interp = d3.geoInterpolate([arc.startLng, arc.startLat], [arc.endLng, arc.endLat]);
            const coordinates: [number, number][] = [];
            for (let i = 0; i <= 40; i += 1) {
              coordinates.push(interp(i / 40) as [number, number]);
            }
            arcsLayer
              .append('path')
              .datum({ type: 'Feature', geometry: { type: 'LineString', coordinates } } as any)
              .attr('class', 'corridor-flow')
              .attr('fill', 'none')
              .attr('stroke', arc.color)
              .attr('stroke-width', 1.1)
              .attr('opacity', 0.75)
              .attr('d', flatPath as any);
          });
        }

        const markerLayer = flatRoot.append('g').attr('class', 'markers');
        points.forEach((point) => {
          const projected = flatProjection?.([point.lon, point.lat]);
          if (!projected) return;
          markerLayer
            .append('circle')
            .attr('class', 'marker-circle')
            .attr('cx', projected[0])
            .attr('cy', projected[1])
            .attr('r', Math.max(2, point.size * 8))
            .attr('data-base-r', Math.max(2, point.size * 8))
            .attr('fill', point.color)
            .attr('stroke', 'rgba(255,255,255,0.35)')
            .attr('stroke-width', 0.5)
            .append('title')
            .text(point.label);
        });

        setContainerRenderStats(container, points, arcs);
        applyFlatRegion(activeRegion);
      })
      .catch((error) => {
        container.dataset.worldsignalVisualReady = '0';
        throw new Error(`worldsignal_flat_mode_load_failed:${String(error)}`);
      });
  };

  flatZoomBehavior = d3
    .zoom<SVGSVGElement, unknown>()
    .scaleExtent([1, 12])
    .on('zoom', (event) => {
      flatTransform = event.transform;
      flatRoot.attr('transform', flatTransform.toString());
      const k = Math.max(1, event.transform.k);
      flatRoot
        .selectAll<SVGCircleElement, unknown>('circle.marker-circle')
        .attr('r', function updateRadius() {
          const base = Number((this as SVGCircleElement).dataset.baseR || '3');
          return base / Math.sqrt(k);
        });
    });

  flatSvg.call(flatZoomBehavior as any);

  const applyGlobeData = (data: CrucixData | null) => {
    const points = buildPoints(data);
    const arcs = buildArcs(data, showFlights);
    globe.pointsData(points as any);
    globe.arcsData(arcs as any);
    setContainerRenderStats(container, points, arcs);
  };

  const setMode = (useFlat: boolean) => {
    flatMode = useFlat;
    if (flatMode) {
      globe.pauseAnimation?.();
      globeHost.style.display = 'none';
      flatSvgEl.style.display = 'block';
      drawFlatMap(latestData);
    } else {
      flatSvgEl.style.display = 'none';
      globeHost.style.display = 'block';
      resizeGlobe();
      applyGlobeData(latestData);
      globe.resumeAnimation?.();
      globe.pointOfView(REGION_POV[activeRegion] || REGION_POV.world, 900);
    }
  };

  resizeGlobe();
  window.requestAnimationFrame(() => {
    resizeGlobe();
  });
  const handleResize = () => {
    resizeGlobe();
    if (flatMode) {
      drawFlatMap(latestData);
    }
  };
  window.addEventListener('resize', handleResize);
  const resizeObserver =
    typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
          handleResize();
        })
      : null;
  resizeObserver?.observe(container);

  setMode(flatMode);

  return {
    update(data: CrucixData | null) {
      latestData = data;
      if (flatMode) {
        drawFlatMap(data);
      } else {
        applyGlobeData(data);
      }
    },
    setFlatMode(enabled: boolean) {
      setMode(enabled);
    },
    setRegion(region: CrucixRegion) {
      activeRegion = region;
      if (flatMode) {
        applyFlatRegion(region);
      } else {
        globe.pointOfView(REGION_POV[region] || REGION_POV.world, 1000);
      }
    },
    zoom(factor: number) {
      if (!Number.isFinite(factor) || factor <= 0) return;
      if (flatMode && flatZoomBehavior) {
        flatSvg.transition().duration(300).call(flatZoomBehavior.scaleBy, factor);
        return;
      }
      const pov = globe.pointOfView();
      const nextAltitude = Math.max(0.35, Math.min(3.2, Number(pov?.altitude || 1.8) / factor));
      globe.pointOfView(
        {
          lat: Number(pov?.lat || 20),
          lng: Number(pov?.lng || 20),
          altitude: nextAltitude,
        },
        300,
      );
    },
    setFlightsVisible(enabled: boolean) {
      showFlights = Boolean(enabled);
      if (flatMode) {
        drawFlatMap(latestData);
      } else {
        applyGlobeData(latestData);
      }
    },
    destroy() {
      window.removeEventListener('resize', handleResize);
      resizeObserver?.disconnect();
      try {
        const renderer = globe.renderer?.();
        renderer?.dispose?.();
      } catch {
        // best-effort cleanup
      }
      if (globeHost.parentElement === container) {
        container.removeChild(globeHost);
      }
      if (flatSvgEl.parentElement === container) {
        container.removeChild(flatSvgEl);
      }
    },
  };
}
