import type { SkyTile } from './types';

const cosmicCliffsDisplayUrl =
  'https://assets.science.nasa.gov/dynamicimage/assets/science/missions/webb/science/2022/07/STScI-01GA6KKWG229B16K4Q38CH3BXS.png?fit=clip&h=1158&w=2000';

const esaImage = (id: string, size: 'screen' | 'large') =>
  `https://cdn.esawebb.org/archives/images/${size}/${id}.jpg`;

export const skyTiles: SkyTile[] = [
  {
    id: 'cosmic-cliffs-carina',
    panelId: 1,
    healpixId: 1201,
    panelName: 'Panel 01',
    title: 'Cosmic Cliffs in Carina',
    objectType: 'Star-forming region',
    raDeg: 159.2458,
    decDeg: -58.6167,
    jwst: {
      title: 'Cosmic Cliffs in Carina',
      thumbUrl: cosmicCliffsDisplayUrl,
      displayUrl: cosmicCliffsDisplayUrl,
      fullResUrl: cosmicCliffsDisplayUrl,
      sourceUrl:
        'https://science.nasa.gov/asset/webb/cosmic-cliffs-in-the-carina-nebula-nircam-image/',
      summary:
        'A near-infrared Webb view of NGC 3324 showing sculpted gas, dust, young stars, and background galaxies.',
      telescope: 'James Webb Space Telescope',
      instrument: 'NIRCam',
      distanceLabel: '7,600 light-years',
      creditLabel: 'NASA, ESA, CSA, STScI',
    },
    aiContextSummary:
      'Use this tile to reason about star formation, dust erosion, protostellar jets, and infrared views through obscuring material.',
  },
  {
    id: 'pillars-of-creation',
    panelId: 2,
    healpixId: 1202,
    panelName: 'Panel 02',
    title: 'Pillars of Creation',
    objectType: 'Star-forming region',
    jwst: {
      title: 'Pillars of Creation',
      thumbUrl: esaImage('pillarsofcreation_composite', 'screen'),
      displayUrl: esaImage('pillarsofcreation_composite', 'large'),
      sourceUrl: 'https://esawebb.org/images/pillarsofcreation_composite/',
      summary:
        'A Webb composite view of dense columns of gas and dust where new stars form inside the Eagle Nebula.',
      telescope: 'James Webb Space Telescope',
      instrument: 'NIRCam / MIRI',
      creditLabel: 'ESA/Webb',
    },
    aiContextSummary:
      'Use this tile for pillar morphology, embedded star formation, dust lanes, and multi-instrument contrast.',
  },
  {
    id: 'tarantula-nebula',
    panelId: 3,
    healpixId: 1203,
    panelName: 'Panel 03',
    title: 'Tarantula Nebula',
    objectType: 'Nebula',
    jwst: {
      title: 'Tarantula Nebula',
      thumbUrl: esaImage('weic2212a', 'screen'),
      displayUrl: esaImage('weic2212a', 'large'),
      sourceUrl: 'https://esawebb.org/images/weic2212a/',
      summary:
        'A detailed Webb view of 30 Doradus, one of the most active nearby stellar nurseries.',
      telescope: 'James Webb Space Telescope',
      instrument: 'NIRCam',
      creditLabel: 'ESA/Webb',
    },
    aiContextSummary:
      'Use this tile to discuss massive star clusters, stellar feedback, cavities, and Large Magellanic Cloud context.',
  },
  {
    id: 'southern-ring-nebula',
    panelId: 4,
    healpixId: 1204,
    panelName: 'Panel 04',
    title: 'Southern Ring Nebula',
    objectType: 'Planetary nebula',
    jwst: {
      title: 'Southern Ring Nebula',
      thumbUrl: esaImage('weic2207b', 'screen'),
      displayUrl: esaImage('weic2207b', 'large'),
      sourceUrl: 'https://esawebb.org/images/weic2207b/',
      summary:
        'A Webb image of shells of gas and dust expelled by a dying star in NGC 3132.',
      telescope: 'James Webb Space Telescope',
      instrument: 'NIRCam / MIRI',
      creditLabel: 'ESA/Webb',
    },
    aiContextSummary:
      'Use this tile for late stellar evolution, expanding shells, binary-star shaping, and dust chemistry.',
  },
  {
    id: 'stephans-quintet',
    panelId: 5,
    healpixId: 1205,
    panelName: 'Panel 05',
    title: 'Stephan’s Quintet',
    objectType: 'Galaxy group',
    jwst: {
      title: 'Stephan’s Quintet',
      thumbUrl: esaImage('weic2208a', 'screen'),
      displayUrl: esaImage('weic2208a', 'large'),
      sourceUrl: 'https://esawebb.org/images/weic2208a/',
      summary:
        'A Webb view of interacting galaxies with shock fronts, star formation, and an active galactic nucleus.',
      telescope: 'James Webb Space Telescope',
      instrument: 'NIRCam / MIRI',
      creditLabel: 'ESA/Webb',
    },
    aiContextSummary:
      'Use this tile for galaxy interactions, tidal features, shock heating, and black-hole-driven activity.',
  },
  {
    id: 'webbs-first-deep-field',
    panelId: 6,
    healpixId: 1206,
    panelName: 'Panel 06',
    title: 'Webb’s First Deep Field',
    objectType: 'Galaxy cluster field',
    jwst: {
      title: 'Webb’s First Deep Field',
      thumbUrl: esaImage('webb-first-deep-field', 'screen'),
      displayUrl: esaImage('webb-first-deep-field', 'large'),
      sourceUrl: 'https://esawebb.org/images/webb-first-deep-field/',
      summary:
        'A deep Webb view of SMACS 0723 with gravitational lensing and distant background galaxies.',
      telescope: 'James Webb Space Telescope',
      instrument: 'NIRCam',
      redshift: 0.39,
      creditLabel: 'ESA/Webb',
    },
    aiContextSummary:
      'Use this tile for gravitational lensing, deep-field observations, galaxy evolution, and early-universe candidates.',
  },
  {
    id: 'sagittarius-c',
    panelId: 7,
    healpixId: 1207,
    panelName: 'Panel 07',
    title: 'Sagittarius C',
    objectType: 'Galactic center region',
    jwst: {
      title: 'Sagittarius C',
      thumbUrl: esaImage('weic2328a', 'screen'),
      displayUrl: esaImage('weic2328a', 'large'),
      dziUrl: '/telescope-tiles/sagittarius-c/sagittarius-c.dzi',
      sourceUrl: 'https://esawebb.org/images/weic2328a/',
      summary:
        'A Webb view near the Milky Way center containing dense star-forming structures and young stellar objects.',
      telescope: 'James Webb Space Telescope',
      instrument: 'NIRCam',
      creditLabel: 'ESA/Webb',
    },
    aiContextSummary:
      'Use this tile for Galactic Center star formation, crowded fields, infrared penetration, and turbulent clouds.',
  },
  {
    id: 'ngc-604',
    panelId: 8,
    healpixId: 1208,
    panelName: 'Panel 08',
    title: 'NGC 604',
    objectType: 'Star-forming region',
    jwst: {
      title: 'NGC 604',
      thumbUrl: esaImage('weic2407b', 'screen'),
      displayUrl: esaImage('weic2407b', 'large'),
      sourceUrl: 'https://esawebb.org/images/weic2407b/',
      summary:
        'A Webb observation of a large stellar nursery in Messier 33 with cavities carved by massive stars.',
      telescope: 'James Webb Space Telescope',
      instrument: 'NIRCam',
      creditLabel: 'ESA/Webb',
    },
    aiContextSummary:
      'Use this tile for ionized bubbles, massive stars, local-group comparison, and clustered star formation.',
  },
  {
    id: 'n79',
    panelId: 9,
    healpixId: 1209,
    panelName: 'Panel 09',
    title: 'N79',
    objectType: 'Star-forming complex',
    jwst: {
      title: 'N79',
      thumbUrl: esaImage('potm2401a', 'screen'),
      displayUrl: esaImage('potm2401a', 'large'),
      sourceUrl: 'https://esawebb.org/images/potm2401a/',
      summary:
        'A Webb view of a luminous star-forming region in the Large Magellanic Cloud.',
      telescope: 'James Webb Space Telescope',
      instrument: 'MIRI',
      creditLabel: 'ESA/Webb',
    },
    aiContextSummary:
      'Use this tile for mid-infrared dust emission, Magellanic Cloud environments, and starburst analogs.',
  },
  {
    id: 'ngc-1385',
    panelId: 10,
    healpixId: 1210,
    panelName: 'Panel 10',
    title: 'NGC 1385',
    objectType: 'Spiral galaxy',
    jwst: {
      title: 'NGC 1385',
      thumbUrl: esaImage('weic2403g', 'screen'),
      displayUrl: esaImage('weic2403g', 'large'),
      sourceUrl: 'https://esawebb.org/images/weic2403g/',
      summary:
        'A Webb image tracing dust and star-forming structures across a barred spiral galaxy.',
      telescope: 'James Webb Space Telescope',
      instrument: 'MIRI',
      creditLabel: 'ESA/Webb',
    },
    aiContextSummary:
      'Use this tile for galaxy structure, star-forming lanes, dust emission, and spiral-arm morphology.',
  },
  {
    id: 'pair-of-merging-galaxies',
    panelId: 11,
    healpixId: 1211,
    panelName: 'Panel 11',
    title: 'Pair of Merging Galaxies',
    objectType: 'Merging galaxies',
    jwst: {
      title: 'Pair of Merging Galaxies',
      thumbUrl: esaImage('potm2210a', 'screen'),
      displayUrl: esaImage('potm2210a', 'large'),
      sourceUrl: 'https://esawebb.org/images/potm2210a/',
      summary:
        'A Webb image of two interacting galaxies with distorted structures and star-forming material.',
      telescope: 'James Webb Space Telescope',
      instrument: 'MIRI',
      creditLabel: 'ESA/Webb',
    },
    aiContextSummary:
      'Use this tile for merger dynamics, tidal distortion, dust-obscured star formation, and interaction timescales.',
  },
  {
    id: 'hh-30',
    panelId: 12,
    healpixId: 1212,
    panelName: 'Panel 12',
    title: 'HH 30',
    objectType: 'Protostellar disk and jet',
    jwst: {
      title: 'HH 30',
      thumbUrl: esaImage('potm2501b', 'screen'),
      displayUrl: esaImage('potm2501b', 'large'),
      sourceUrl: 'https://esawebb.org/images/potm2501b/',
      summary:
        'A Webb view of a young star system with an edge-on disk and jet activity.',
      telescope: 'James Webb Space Telescope',
      instrument: 'NIRCam / MIRI',
      creditLabel: 'ESA/Webb',
    },
    aiContextSummary:
      'Use this tile for protoplanetary disks, jets, scattered light, and early stellar-system formation.',
  },
];

if (skyTiles.length !== 12) {
  throw new Error('skyTiles must contain exactly 12 records.');
}
