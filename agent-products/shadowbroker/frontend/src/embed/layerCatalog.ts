/**
 * The one WorldSignals layer catalog — the single authority for layer
 * identity, i18n label keys, presentation grouping and the specialist
 * classification behind the `world_intelligence_default_v1` embedded profile.
 *
 * IDs are `keyof ActiveLayers` and the compile-time checks at the bottom fail
 * the build if this catalog and the ActiveLayers type ever drift apart.
 * WorldviewLeftPanel stays the standalone renderer (it adds live counts,
 * icons and provider strings on top); a host embeds against THIS surface and
 * must never hand-copy layer ids or labels.
 */
import type { ActiveLayers } from '@/types/dashboard';

export type WorldSignalsLayerCatalogEntry = {
  id: keyof ActiveLayers;
  /** i18n key from the same dictionary WorldviewLeftPanel renders with. */
  labelKey: string;
  /** i18n key of the section heading the standalone panel groups this under. */
  groupKey: string;
  /** true = conflict/recon/SIGINT/cyber — OFF in the embedded default profile. */
  specialist: boolean;
};

export const WORLD_INTELLIGENCE_PROFILE_ID = 'world_intelligence_default_v1';
export const WORLD_INTELLIGENCE_PROFILE_VERSION = 1;

export const WORLDSIGNALS_LAYER_CATALOG = [
  // Aircraft
  { id: 'flights', labelKey: 'layers.commercialFlights', groupKey: 'layers.aircraft', specialist: false },
  { id: 'private', labelKey: 'layers.privateAircraft', groupKey: 'layers.aircraft', specialist: false },
  { id: 'jets', labelKey: 'layers.privateJets', groupKey: 'layers.aircraft', specialist: false },
  { id: 'military', labelKey: 'layers.militaryFlights', groupKey: 'layers.aircraft', specialist: true },
  { id: 'tracked', labelKey: 'layers.trackedAircraft', groupKey: 'layers.aircraft', specialist: false },
  { id: 'gps_jamming', labelKey: 'layers.gpsJamming', groupKey: 'layers.aircraft', specialist: true },
  // Maritime
  { id: 'ships_military', labelKey: 'layers.militaryVessels', groupKey: 'layers.maritime', specialist: true },
  { id: 'ships_cargo', labelKey: 'layers.cargoShips', groupKey: 'layers.maritime', specialist: false },
  { id: 'ships_civilian', labelKey: 'layers.civilianShips', groupKey: 'layers.maritime', specialist: false },
  { id: 'ships_passenger', labelKey: 'layers.passengerShips', groupKey: 'layers.maritime', specialist: false },
  { id: 'ships_tracked_yachts', labelKey: 'layers.trackedYachts', groupKey: 'layers.maritime', specialist: false },
  { id: 'fishing_activity', labelKey: 'layers.fishingActivity', groupKey: 'layers.maritime', specialist: false },
  // Space & imagery
  { id: 'satellites', labelKey: 'layers.satellites', groupKey: 'layers.space', specialist: false },
  { id: 'gibs_imagery', labelKey: 'layers.gibsImagery', groupKey: 'layers.space', specialist: false },
  { id: 'highres_satellite', labelKey: 'layers.highresSatellite', groupKey: 'layers.space', specialist: false },
  { id: 'sentinel_hub', labelKey: 'layers.sentinelHub', groupKey: 'layers.space', specialist: false },
  { id: 'viirs_nightlights', labelKey: 'layers.viirsNightlights', groupKey: 'layers.space', specialist: false },
  { id: 'road_corridor_trends', labelKey: 'layers.roadCorridorTrends', groupKey: 'layers.space', specialist: false },
  // Hazards & environment
  { id: 'earthquakes', labelKey: 'layers.earthquakes', groupKey: 'layers.hazards', specialist: false },
  { id: 'firms', labelKey: 'layers.fires', groupKey: 'layers.hazards', specialist: false },
  { id: 'ukraine_alerts', labelKey: 'layers.ukraineAlerts', groupKey: 'layers.hazards', specialist: true },
  { id: 'weather_alerts', labelKey: 'layers.weatherAlerts', groupKey: 'layers.hazards', specialist: false },
  { id: 'volcanoes', labelKey: 'layers.volcanoes', groupKey: 'layers.hazards', specialist: false },
  { id: 'air_quality', labelKey: 'layers.airQuality', groupKey: 'layers.hazards', specialist: false },
  { id: 'sar', labelKey: 'layers.sar', groupKey: 'layers.hazards', specialist: false },
  // UAP
  { id: 'uap_sightings', labelKey: 'layers.uapSightings', groupKey: 'layers.uapSightings', specialist: false },
  // Biosurveillance
  { id: 'wastewater', labelKey: 'layers.wastewater', groupKey: 'layers.biosurveillance', specialist: false },
  // Infrastructure
  { id: 'cctv', labelKey: 'layers.cctv', groupKey: 'layers.infrastructure', specialist: false },
  { id: 'datacenters', labelKey: 'layers.datacenters', groupKey: 'layers.infrastructure', specialist: false },
  { id: 'internet_outages', labelKey: 'layers.internetOutages', groupKey: 'layers.infrastructure', specialist: false },
  { id: 'power_plants', labelKey: 'layers.powerPlants', groupKey: 'layers.infrastructure', specialist: false },
  { id: 'military_bases', labelKey: 'layers.militaryBases', groupKey: 'layers.infrastructure', specialist: true },
  { id: 'trains', labelKey: 'layers.trains', groupKey: 'layers.infrastructure', specialist: false },
  { id: 'submarine_cables', labelKey: 'layers.submarineCables', groupKey: 'layers.infrastructure', specialist: false },
  { id: 'malware_c2', labelKey: 'layers.malwareC2', groupKey: 'layers.infrastructure', specialist: true },
  { id: 'scm_suppliers', labelKey: 'layers.scmSuppliers', groupKey: 'layers.infrastructure', specialist: false },
  { id: 'cyber_threats', labelKey: 'layers.cyberThreats', groupKey: 'layers.infrastructure', specialist: true },
  // Shodan
  { id: 'shodan_overlay', labelKey: 'layers.shodanOverlay', groupKey: 'layers.shodanOverlay', specialist: true },
  // SIGINT
  { id: 'kiwisdr', labelKey: 'layers.kiwisdr', groupKey: 'layers.sigint', specialist: true },
  { id: 'psk_reporter', labelKey: 'layers.pskReporter', groupKey: 'layers.sigint', specialist: true },
  { id: 'satnogs', labelKey: 'layers.satnogs', groupKey: 'layers.sigint', specialist: true },
  { id: 'tinygs', labelKey: 'layers.tinygs', groupKey: 'layers.sigint', specialist: true },
  { id: 'scanners', labelKey: 'layers.scanners', groupKey: 'layers.sigint', specialist: true },
  { id: 'sigint_meshtastic', labelKey: 'layers.meshtastic', groupKey: 'layers.sigint', specialist: true },
  { id: 'sigint_aprs', labelKey: 'layers.aprs', groupKey: 'layers.sigint', specialist: true },
  // Overlays
  { id: 'ukraine_frontline', labelKey: 'layers.ukraineFrontline', groupKey: 'layers.overlays', specialist: true },
  { id: 'global_incidents', labelKey: 'layers.globalIncidents', groupKey: 'layers.overlays', specialist: true },
  { id: 'telegram_osint', labelKey: 'layers.telegramOsint', groupKey: 'layers.overlays', specialist: true },
  { id: 'crowdthreat', labelKey: 'layers.crowdThreat', groupKey: 'layers.overlays', specialist: true },
  { id: 'correlations', labelKey: 'layers.correlations', groupKey: 'layers.overlays', specialist: false },
  { id: 'contradictions', labelKey: 'layers.contradictions', groupKey: 'layers.overlays', specialist: false },
  { id: 'gt_risk', labelKey: 'layers.derivedOsint', groupKey: 'layers.overlays', specialist: true },
  { id: 'day_night', labelKey: 'layers.dayNight', groupKey: 'layers.overlays', specialist: false },
  { id: 'ai_intel', labelKey: 'layers.aiIntel', groupKey: 'layers.overlays', specialist: true },
] as const satisfies readonly WorldSignalsLayerCatalogEntry[];

// Compile-time drift guards: the catalog must cover EVERY ActiveLayers key and
// must not contain ids the map does not know. If either check errors, the type
// in the error message names the offending layer id.
type CatalogId = (typeof WORLDSIGNALS_LAYER_CATALOG)[number]['id'];
type MissingFromCatalog = Exclude<keyof ActiveLayers, CatalogId>;
type UnknownInCatalog = Exclude<CatalogId, keyof ActiveLayers>;
const _catalogCoversEveryLayer: MissingFromCatalog extends never ? true : MissingFromCatalog = true;
const _catalogHasNoUnknownIds: UnknownInCatalog extends never ? true : UnknownInCatalog = true;
void _catalogCoversEveryLayer;
void _catalogHasNoUnknownIds;

/** The embedded default profile: the given base with every specialist layer off. */
export function worldIntelligenceDefaults(base: ActiveLayers): ActiveLayers {
  const next = { ...base };
  for (const entry of WORLDSIGNALS_LAYER_CATALOG) {
    if (entry.specialist) next[entry.id] = false;
  }
  return next;
}
