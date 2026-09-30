import assert from 'node:assert/strict';
import test from 'node:test';
import * as Cesium from 'cesium';
import { twoline2satrec } from 'satellite.js';
import satellitesLayer, {
  _clearSatelliteLabelLifecycleForTest,
  _handleSatelliteClickForTest,
  _setSatelliteLabelLifecycleStateForTest,
} from './satellites.js';
import { registerPickOwner, unregisterPickOwner } from './pickRegistry.js';

const L1 = '1 25544U 98067A   08264.51782528 -.00002182  00000-0 -11606-4 0  2927';
const L2 = '2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537';
const POSITION = { x: 40, y: 60 };

test('satellite click switches A to B through ordinary and tracked-top picks without stealing sibling clicks', () => {
  const point = (longitude, id) => ({
    id,
    position: Cesium.Cartesian3.fromDegrees(longitude, 30.2, 420_000),
    show: true,
    pixelSize: 6,
    color: Cesium.Color.CYAN,
    outlineColor: Cesium.Color.WHITE,
    outlineWidth: 0,
    disableDepthTestDistance: 0,
  });
  const iss = point(-97.7, 25544);
  const other = point(-98.7, 20580);
  const pickIss = { primitive: iss };
  const pickOther = { primitive: other };
  const sibling = { primitive: { id: 'flight-1' } };
  const unownedTile = { primitive: { id: 'photorealistic-tile' } };
  let topPick = null;
  let deeperPicks = [];
  let drillCalls = 0;
  const viewer = {
    entities: new Cesium.EntityCollection(),
    trackedEntity: undefined,
    scene: {
      frameState: { frameNumber: 1 },
      primitives: { add: (primitive) => primitive, remove() {} },
      pick: () => topPick,
      drillPick: () => { drillCalls++; return deeperPicks; },
    },
  };
  const overlayHost = { setEntries() {}, setVisible() {}, clearSource() {} };
  _setSatelliteLabelLifecycleStateForTest({
    viewer,
    satrec: twoline2satrec(L1, L2),
    point: iss,
    satellites: [{ noradId: 20580, name: 'SECOND SATELLITE', point: other }],
    overlayHost,
  });
  registerPickOwner('flights', (id) => id === 'flight-1');
  try {
    assert.equal(satellitesLayer.trackById(25544), true);
    const initialEntity = viewer.trackedEntity;
    assert.equal(satellitesLayer.getParams().selectedSatTrackingId, 25544);

    topPick = pickOther;
    _handleSatelliteClickForTest(viewer, { position: POSITION });
    assert.equal(drillCalls, 0, 'ordinary point pick stays on the direct path');
    assert.equal(satellitesLayer.getParams().selectedSatTrackingId, 20580);
    assert.notEqual(viewer.trackedEntity, initialEntity);
    assert.equal(iss.show, true);
    assert.equal(other.show, false);

    const trackedB = viewer.trackedEntity;
    topPick = { id: trackedB };
    deeperPicks = [topPick, { id: trackedB }, pickIss];
    _handleSatelliteClickForTest(viewer, { position: POSITION });
    assert.equal(drillCalls, 1, 'tracked top pick inspects the point underneath');
    assert.equal(satellitesLayer.getParams().selectedSatTrackingId, 25544);
    assert.notEqual(viewer.trackedEntity, trackedB);

    const trackedA = viewer.trackedEntity;
    topPick = { id: trackedA };
    deeperPicks = [topPick];
    _handleSatelliteClickForTest(viewer, { position: POSITION });
    assert.equal(drillCalls, 2);
    assert.equal(viewer.trackedEntity, trackedA, 'current-only tracked pick is a no-op');

    topPick = { id: trackedA };
    deeperPicks = [topPick, unownedTile];
    _handleSatelliteClickForTest(viewer, { position: POSITION });
    assert.equal(drillCalls, 3);
    assert.equal(viewer.trackedEntity, trackedA, 'unowned ground behind the marker is not empty space');

    topPick = { id: trackedA };
    deeperPicks = [topPick, unownedTile, pickOther];
    _handleSatelliteClickForTest(viewer, { position: POSITION });
    assert.equal(drillCalls, 4);
    assert.equal(satellitesLayer.getParams().selectedSatTrackingId, 20580,
      'unowned geometry does not mask a deeper satellite point');
    const trackedAgain = viewer.trackedEntity;

    topPick = sibling;
    _handleSatelliteClickForTest(viewer, { position: POSITION });
    assert.equal(drillCalls, 4, 'ordinary sibling pick never drills');
    assert.equal(viewer.trackedEntity, trackedAgain, 'sibling owner retains the click');

    topPick = { id: trackedAgain };
    deeperPicks = [topPick, sibling, pickIss];
    _handleSatelliteClickForTest(viewer, { position: POSITION });
    assert.equal(drillCalls, 5);
    assert.equal(viewer.trackedEntity, trackedAgain, 'first deeper sibling pick is not stolen');

    topPick = null;
    _handleSatelliteClickForTest(viewer, { position: POSITION });
    assert.equal(satellitesLayer.getParams().selectedSatTrackingId, null, 'empty click clears the selection');
    assert.equal(viewer.trackedEntity, undefined);
  } finally {
    unregisterPickOwner('flights');
    _clearSatelliteLabelLifecycleForTest();
  }
});
