import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');

test('mounted Minimal HUD keeps only a small location readout', () => {
  const rules = css.match(
    /\.supervised-embed #intel-hud\[data-variant='minimal'\] \.hud-top-left,[\s\S]*?\.supervised-embed #intel-hud\[data-variant='minimal'\] #hud-latlon \{[^}]*\}/,
  )?.[0];
  assert.ok(rules, 'the mounted-only Minimal HUD presentation exists');
  for (const tacticalPart of ['.hud-top-left', '.hud-bottom-bar', '#hud-mgrs', '.hud-bottom-left .hud-bracket']) {
    assert.ok(rules.includes(tacticalPart), `${tacticalPart} must not cover the globe`);
  }
  assert.match(rules, /\.hud-bottom-left \.hud-bracket\s*\{\s*display:\s*none;/);
  assert.match(rules, /\.hud-bottom-left\s*\{[^}]*left:\s*calc\(var\(--worldview-occluded-left/);
  assert.match(rules, /#hud-latlon\s*\{[^}]*font-size:\s*10px/);
  assert.doesNotMatch(rules, /\.supervised-embed #intel-hud\[data-variant='minimal'\]\s*\{\s*display:\s*none/,
    'the user-controlled HUD must remain available');
});
