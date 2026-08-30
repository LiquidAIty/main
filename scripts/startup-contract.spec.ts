import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('canonical Hermes gateway launcher', () => {
  it('pins the externally supervised gateway to the repository default home', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '..', 'package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.['dev:gateway']).toBe(
      'set "LIQUIDAITY_INTERNAL_MCP_SECRET=" && ' +
        'set "HERMES_HOME=%CD%\\Hermes\\.hermes" && ' +
        'Hermes\\venv\\Scripts\\hermes.exe -p default gateway run ' +
        '--replace --external-supervisor',
    );
  });
});
