import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../..', relativePath), 'utf-8');
}

describe('Oracle release surface', () => {
  it('mounts the canonical human prediction panel in the dashboard', () => {
    const page = source('app/page.tsx');

    expect(page).toContain("import PredictionsPanel from '@/components/PredictionsPanel'");
    expect(page).toContain('<PredictionsPanel />');
  });

  it('exposes an accessible signed testnet prediction flow with honest receipts', () => {
    const panel = source('components/PredictionsPanel.tsx');

    expect(panel).toContain('role="dialog"');
    expect(panel).toContain('RECORD TESTNET PREDICTION');
    expect(panel).toContain("signMeshEvent('prediction'");
    expect(panel).toContain('RECORDED, AUDIT UNAVAILABLE');
    expect(panel).not.toContain('— FINAL');
  });

  it('does not emit fake mesh, radio, or wormhole success data', () => {
    const shell = source('components/InfonetTerminal/InfonetShell.tsx');

    expect(shell).not.toContain('Block: #894921');
    expect(shell).not.toContain('462.562 MHz - Encrypted burst');
    expect(shell).not.toContain('Active Tunnels: 3');
    expect(shell).toContain('No tunnel count or online state is inferred here.');
  });

  it('labels the built-in AI surface as a preview that requires an external agent', () => {
    const consoleSource = source('components/InfonetTerminal/AIQueryView.tsx');

    expect(consoleSource).toContain('SHADOWBROKER COMMAND CONSOLE PREVIEW');
    expect(consoleSource).toContain('External agent not bundled');
    expect(consoleSource).not.toContain('SHADOWBROKER AI CO-PILOT ONLINE');
  });
});
