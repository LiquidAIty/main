import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveLocalCoderWorkspaceRoot } from '../../localcoder/adapter';

const planText = readFileSync(
  path.join(resolveLocalCoderWorkspaceRoot(process.cwd()), 'PLAN.md'),
  'utf8',
);

describe('PLAN.md OpenClaude Console Bridge documentation', () => {
  it('documents the OpenClaude Console Bridge as a real visible CLI', () => {
    expect(planText).toContain('### OpenClaude Console Bridge');
    expect(planText).toContain('real CLI coder engine');
    expect(planText).toMatch(/node-pty/);
    expect(planText).toMatch(/@xterm\/xterm/);
  });

  it('documents Mag One terminal (diagnostics) vs OpenClaude coder routing', () => {
    expect(planText).toMatch(/quick diagnostics/i);
    expect(planText).toMatch(/real coder work/i);
    expect(planText).toMatch(/no second competing coder path/i);
  });

  it('documents the not-a-sandbox honesty boundary', () => {
    expect(planText).toMatch(/not a sandbox/i);
    expect(planText).toMatch(/terminal output is not a CoderReport/i);
  });
});

describe('PLAN.md Coder Console naming firewall', () => {
  it('documents the user-facing names and the internal-names-stay caveat', () => {
    expect(planText).toContain('Coder Console Naming Firewall');
    expect(planText).toMatch(/Code Console/);
    expect(planText).toMatch(/Coder Engine/);
    expect(planText).toMatch(/Coder Session/);
    expect(planText).toMatch(/must not expose `Claude`, `OpenClaude`, or `LocalCoder`/);
    expect(planText).toMatch(/broad internal rename is a later SPEC/i);
  });
});
