import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const htmlSource = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const serverSource = await readFile(new URL('../src/server.mjs', import.meta.url), 'utf8');

test('evidence inspector exposes the bounded observation lineage contract', () => {
  for (const field of [
    "detail('Provider digest'",
    "detail('Source profile'",
    "detail('Transform revision'",
    "detail('Pose'",
    "detail('Support'",
    "detail('Input observations'",
    "detail('Provenance'",
    "detail('Sequence'",
    "detail('Age'"
  ]) {
    assert.ok(appSource.includes(field), 'missing inspector field: ' + field);
  }
  assert.match(appSource, /escapeHtml\(value\)/);
  assert.match(appSource, /\/api\/sessions\/.*\/verify/);
  assert.match(appSource, /sessionVerification/);
  assert.match(appSource, /\/api\/sessions\/compare/);
  assert.match(appSource, /comparisonResult/);
  assert.match(appSource, /compare-time/);
  assert.match(appSource, /pinATimeButton/);
  assert.match(appSource, /temporalComparisonResult/);
  assert.match(appSource, /timelineMarkers/);
  assert.match(appSource, /replay\.journal/);
  assert.match(appSource, /drawSupportGeometry/);
  assert.match(appSource, /drawUncertainty/);
  assert.match(appSource, /drawTemporalTrails/);
  assert.match(appSource, /drawEventPulses/);
  assert.match(appSource, /\/regions/);
  assert.match(appSource, /renderRegions/);
  assert.match(appSource, /Rooms \/ zones/);
  assert.match(appSource, /Doors \/ portals/);
  assert.match(appSource, /renderPortals/);
  assert.match(appSource, /\/portals/);
  assert.match(appSource, /LAYER_GROUPS/);
  assert.match(appSource, /data-layer-group/);
  assert.match(appSource, /Hide group/);
  assert.match(appSource, /Show group/);
  assert.match(appSource, /Calibration state/);
  assert.match(appSource, /Data age/);
  assert.match(appSource, /evidenceState === 'inferred'/);
  assert.match(appSource, /state\.visible\.age/);
  assert.match(appSource, /fieldSettings/);
  assert.match(appSource, /fieldWeight/);
  assert.match(appSource, /Cells outside the radius show insufficient data/);
  assert.match(appSource, /createBaselineSnapshot/);
  assert.match(appSource, /drawBaselineField/);
  assert.match(appSource, /Baseline delta/);
  assert.match(appSource, /capped z-score/);
  assert.match(appSource, /baselineCapture/);
  assert.match(appSource, /Stop & save baseline/);
  assert.match(appSource, /cameraTiltDeg/);
  assert.match(appSource, /projectionShear/);
  assert.match(appSource, /scenePointFromEvent/);
  assert.match(appSource, /viewPaused/);
  assert.match(appSource, /Pause view/);
  assert.match(appSource, /Resume view/);
  assert.match(appSource, /if \(state\.viewPaused\) return/);
  assert.match(appSource, /renderTransforms/);
  assert.match(appSource, /transformForm/);
  assert.match(appSource, /\/api\/transforms/);
  assert.match(htmlSource, /id="transformForm"/);
  assert.match(htmlSource, /Publish revision/);
  assert.match(appSource, /syncBackgroundImage/);
  assert.match(appSource, /drawBackground/);
  assert.match(appSource, /backgroundForm/);
  assert.match(htmlSource, /id="backgroundFile"/);
  assert.match(htmlSource, /Remove background/);
  assert.match(htmlSource, /id="pauseViewButton"/);
  assert.match(htmlSource, /id="fieldSettingsForm"/);
  assert.match(htmlSource, /id="fieldRadius"/);
  assert.match(htmlSource, /Apply field settings/);
  assert.match(htmlSource, /id="captureBaselineButton"/);
  assert.match(htmlSource, /id="clearBaselineButton"/);
  assert.match(htmlSource, /Start baseline window/);
  assert.match(htmlSource, /id="cameraTilt"/);
  assert.match(htmlSource, /2D authoritative/);
  assert.match(serverSource, /'\.mjs': 'text\/javascript; charset=utf-8'/);
  assert.match(appSource, /drawMeasurement/);
  assert.match(appSource, /Measure distance/);
  assert.match(appSource, /sceneUnit/);
  assert.match(appSource, /encryptedExportButton/);
  assert.match(appSource, /sidechannel-encrypted-session/);
  assert.match(appSource, /downloadJson/);
});
