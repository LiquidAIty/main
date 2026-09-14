import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('canonical Hermes gateway launcher', () => {
  it('does not launch the unconfigured messaging/cron gateway from dev:fresh', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '..', 'package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.['dev:fresh']).toContain('scripts/start-dev-services.ps1');
    expect(packageJson.scripts?.['dev:dependent-services']).not.toContain('dev:gateway');
    expect(packageJson.scripts?.['dev:dependent-services']).toContain('dev:mcp');
    expect(packageJson.scripts?.['dev:dependent-services']).toContain('dev:worldview');
    expect(packageJson.scripts?.['dev:dependent-services']).toContain('--kill-others-on-fail');
    expect(packageJson.scripts?.['dev:dependent-services']).not.toMatch(/--kill-others(?:\s|$)/);
  });

  it('preserves the explicit upstream messaging/cron gateway command for future integration', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '..', 'package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> };
    const command = packageJson.scripts?.['dev:gateway'] || '';

    expect(command).toContain("['-p','liquidaity-main','gateway','run'");
    expect(command).toContain("'--replace','--external-supervisor'");
    expect(command).toContain("profiles','liquidaity-main'");
  });
});
