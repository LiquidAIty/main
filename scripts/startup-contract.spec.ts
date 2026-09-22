import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('canonical Hermes gateway launcher', () => {
  it('launches exactly one native GatewayRunner from dev:fresh', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '..', 'package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.['dev:fresh']).toContain('scripts/start-dev-services.ps1');
    expect(packageJson.scripts?.['dev:dependent-services']?.match(/npm run dev:gateway/g)).toHaveLength(1);
    expect(packageJson.scripts?.['dev:dependent-services']).toContain('dev:mcp');
    expect(packageJson.scripts?.['dev:dependent-services']).toContain('dev:worldview');
    expect(packageJson.scripts?.['dev:dependent-services']).not.toContain('--kill-others-on-fail');
    expect(packageJson.scripts?.['dev:dependent-services']).not.toMatch(/--kill-others(?:\s|$)/);
  });

  it('uses the Windows-safe upstream gateway module command for native task execution', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '..', 'package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> };
    const command = packageJson.scripts?.['dev:gateway'] || '';

    expect(command).toContain("path.join(root,'venv','Scripts','python.exe')");
    expect(command).not.toContain("path.join(root,'venv','Scripts','hermes.exe')");
    expect(command).toContain("['-m','hermes_cli.main','-p','liquidaity-main','gateway','run'");
    expect(command).toContain("'--replace','--external-supervisor'");
    expect(command).toContain("profiles','liquidaity-main'");
    expect(command).toContain("cwd,env:{...process.env");
    expect(command).toContain("CARD_TOOLS_MANAGED:'1'");
    expect(command).toContain("CARD_TOOLS_HOST_URL:'http://127.0.0.1:'+port+'/api/hermes-card-tools'");
    expect(command).toContain("stdio:'inherit',windowsHide:true");
    expect(command).not.toContain('shell:true');
  });
});
