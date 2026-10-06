import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('canonical Hermes gateway ownership', () => {
  it('leaves gateway lifecycle with backend-owned Card sessions', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '..', 'package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> };
    const supervisedStartup = readFileSync(
      resolve(import.meta.dirname, 'start-dev-services.ps1'),
      'utf8',
    );

    expect(packageJson.scripts?.['dev:fresh']).toContain('scripts/start-dev-services.ps1');
    expect(supervisedStartup).toContain("$env:NX_SKIP_VSCODE_EXTENSION_INSTALL = 'true'");
    expect(supervisedStartup).toContain("$env:NX_INTERACTIVE = 'false'");
    expect(packageJson.scripts).not.toHaveProperty('dev:gateway');
    expect(packageJson.scripts?.['dev:dependent-services']).not.toContain('dev:gateway');
    expect(packageJson.scripts?.['dev:dependent-services']).toContain('dev:mcp');
    expect(packageJson.scripts?.['dev:dependent-services']).toContain('dev:worldview');
    expect(packageJson.scripts?.['dev:dependent-services']).not.toContain('--kill-others-on-fail');
    expect(packageJson.scripts?.['dev:dependent-services']).not.toMatch(/--kill-others(?:\s|$)/);
  });

  it('keeps current Main and Builder source free of retired identity words', () => {
    const repositoryRoot = resolve(import.meta.dirname, '..');
    const retiredProductWord = ['liquid', 'aity'].join('');
    const retiredRuntimeWord = ['na', 'tive'].join('');
    const retiredMainProfile = `${retiredProductWord}-main`;
    const identityCleanFiles = [
      'scripts/startup-contract.spec.ts',
      'apps/backend/src/startup/pythonOwnedStartup.ts',
      'apps/backend/src/startup/pythonOwnedStartup.spec.ts',
      'apps/backend/src/services/agentBuilderStore.ts',
      'apps/backend/src/services/agentBuilderStore.spec.ts',
      'client/src/features/agentbuilder/deck/newProjectDeck.ts',
      'client/src/features/agentbuilder/deck/deckDocument.spec.ts',
      'client/src/pages/agentbuilder.setup.spec.ts',
      'apps/backend/src/db/migrations.spec.ts',
      'apps/backend/migrations/051_main_profile_and_hermes_terms.sql',
    ];

    for (const relativePath of identityCleanFiles) {
      const source = readFileSync(resolve(repositoryRoot, relativePath), 'utf8').toLowerCase();
      expect(relativePath.toLowerCase()).not.toContain(retiredProductWord);
      expect(relativePath.toLowerCase()).not.toContain(retiredRuntimeWord);
      expect(source, relativePath).not.toContain(retiredProductWord);
      expect(source, relativePath).not.toContain(retiredRuntimeWord);
    }

    for (const relativePath of ['package.json', 'apps/backend/src/db/migrations.ts']) {
      const source = readFileSync(resolve(repositoryRoot, relativePath), 'utf8').toLowerCase();
      expect(source, relativePath).not.toContain(retiredMainProfile);
      expect(source, relativePath).not.toContain(retiredRuntimeWord);
    }
  });
});
