import { describe, expect, it } from 'vitest';
import {
  decideGrpcAction,
  isLiquidAItyGrpcListener,
  isLiquidAItyOwnedDevProcess,
  type PortListener,
} from './devStack';

const REPO = 'C:\\Projects\\main';
const grpc: PortListener = { pid: 6460, name: 'bun.exe', commandLine: 'bun  run scripts/start-grpc.ts' };

describe('isLiquidAItyGrpcListener — only the real OpenClaude bun gRPC is reusable', () => {
  it('accepts the exact bun start-grpc.ts listener', () => {
    expect(isLiquidAItyGrpcListener(grpc)).toBe(true);
  });
  it('rejects a bare bun process (no start-grpc.ts)', () => {
    expect(isLiquidAItyGrpcListener({ pid: 1, name: 'bun.exe', commandLine: 'bun run something-else.ts' })).toBe(false);
  });
  it('rejects a node process even if it mentions start-grpc.ts (must be bun)', () => {
    expect(isLiquidAItyGrpcListener({ pid: 2, name: 'node.exe', commandLine: 'node scripts/start-grpc.ts' })).toBe(false);
  });
  it('rejects nothing/null', () => {
    expect(isLiquidAItyGrpcListener(null)).toBe(false);
  });
});

describe('decideGrpcAction — reuse valid, start when free, conflict on unknown', () => {
  it('reuses the valid running LiquidAIty gRPC (no second start)', () => {
    expect(decideGrpcAction(grpc)).toEqual({ action: 'reuse', pid: 6460 });
  });
  it('starts exactly one when the port is free', () => {
    expect(decideGrpcAction(null)).toEqual({ action: 'start' });
  });
  it('fails honestly (conflict) on an unknown listener — never reuse, never a rival', () => {
    const unknown: PortListener = { pid: 999, name: 'node.exe', commandLine: 'node some-other-grpc.js' };
    expect(decideGrpcAction(unknown)).toEqual({
      action: 'conflict',
      pid: 999,
      commandLine: 'node some-other-grpc.js',
    });
  });
});

describe('isLiquidAItyOwnedDevProcess — fresh stops ONLY grounded LiquidAIty owners', () => {
  it('owns the gRPC by its bun start-grpc signature', () => {
    expect(isLiquidAItyOwnedDevProcess(grpc, REPO)).toEqual({ owned: true, role: 'grpc' });
  });
  it('owns the autogen uvicorn on 8003 under the repo', () => {
    const p = {
      pid: 10, name: 'python.exe',
      commandLine: 'C:\\Projects\\main\\apps\\python-models\\.venv\\Scripts\\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8003 --reload',
    };
    expect(isLiquidAItyOwnedDevProcess(p, REPO)).toEqual({ owned: true, role: 'autogen' });
  });
  it('owns the nx serve backend under the repo', () => {
    const p = { pid: 11, name: 'node.exe', commandLine: 'node C:\\Projects\\main\\node_modules\\nx\\bin\\nx.js serve backend' };
    expect(isLiquidAItyOwnedDevProcess(p, REPO)).toEqual({ owned: true, role: 'backend' });
  });
  it('owns the client vite dev under the repo', () => {
    const p = { pid: 12, name: 'node.exe', commandLine: 'node C:\\Projects\\main\\client\\node_modules\\.bin\\..\\vite\\bin\\vite.js dev' };
    expect(isLiquidAItyOwnedDevProcess(p, REPO)).toEqual({ owned: true, role: 'frontend' });
  });
  it('owns the concurrently supervisor under the repo', () => {
    const p = {
      pid: 13, name: 'node.exe',
      commandLine: 'node C:\\Projects\\main\\node_modules\\.bin\\..\\concurrently\\dist\\bin\\concurrently.js --names autogen,backend,grpc,frontend "npm run dev:grpc"',
    };
    expect(isLiquidAItyOwnedDevProcess(p, REPO)).toEqual({ owned: true, role: 'supervisor' });
  });

  it('does NOT own a bare bun/node/python or an unrelated repo process', () => {
    for (const cmd of [
      'bun run some-other-thing.ts',
      'node C:\\OtherApp\\server.js',
      'python.exe -m http.server 9000',
      'C:\\Program Files\\PostgreSQL\\bin\\postgres.exe',
      'node C:\\Projects\\main\\node_modules\\.bin\\eslint.js src', // in-repo but not a dev role
    ]) {
      expect(isLiquidAItyOwnedDevProcess({ pid: 1, name: 'x', commandLine: cmd }, REPO).owned).toBe(false);
    }
  });

  it('does NOT own an autogen-shaped command that is NOT under this repo', () => {
    const p = { pid: 14, name: 'python.exe', commandLine: 'D:\\elsewhere\\python.exe -m uvicorn app.main:app --port 8003' };
    expect(isLiquidAItyOwnedDevProcess(p, REPO).owned).toBe(false);
  });
});
