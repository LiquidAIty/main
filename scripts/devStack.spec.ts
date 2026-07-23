import { describe, expect, it } from 'vitest';
import {
  decideAutogenAction,
  decideGrpcAction,
  decideKnowgraphAction,
  isLiquidAItyAutogenListener,
  isLiquidAItyGrpcListener,
  isLiquidAItyKnowgraphListener,
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

describe('isLiquidAItyKnowgraphListener — only the real KnowGraph uvicorn on 8001 is reusable', () => {
  // The venv python resolves through a uv shim, so BOTH the full-repo-path form
  // and the uv-store-path form must be recognized by module+port, not repo root.
  it('accepts the uv-shimmed KnowGraph uvicorn (no repo root in cmdline)', () => {
    const p: PortListener = {
      pid: 20, name: 'python.exe',
      commandLine: '"C:\\Users\\me\\AppData\\Roaming\\uv\\python\\cpython-3.11\\python.exe" -X utf8 -m uvicorn app:app --host 127.0.0.1 --port 8001',
    };
    expect(isLiquidAItyKnowgraphListener(p)).toBe(true);
  });
  it('accepts the full-repo-path KnowGraph uvicorn', () => {
    const p: PortListener = {
      pid: 21, name: 'python.exe',
      commandLine: 'C:\\Projects\\main\\services\\knowgraph\\.venv\\Scripts\\python.exe -X utf8 -m uvicorn app:app --host 127.0.0.1 --port 8001',
    };
    expect(isLiquidAItyKnowgraphListener(p)).toBe(true);
  });
  it('rejects the autogen uvicorn (app.main:app on 8003) — never confuse the two Python services', () => {
    const p: PortListener = {
      pid: 22, name: 'python.exe',
      commandLine: '.venv\\Scripts\\python.exe -X utf8 -m uvicorn app.main:app --host 127.0.0.1 --port 8003',
    };
    expect(isLiquidAItyKnowgraphListener(p)).toBe(false);
  });
  it('rejects a non-python listener even if the cmdline mentions app:app/8001', () => {
    expect(
      isLiquidAItyKnowgraphListener({ pid: 23, name: 'node.exe', commandLine: 'node uvicorn app:app 8001' }),
    ).toBe(false);
  });
  it('rejects nothing/null', () => {
    expect(isLiquidAItyKnowgraphListener(null)).toBe(false);
  });
});

describe('decideKnowgraphAction — reuse valid, start when free, conflict on unknown', () => {
  const kg: PortListener = {
    pid: 30, name: 'python.exe',
    commandLine: 'C:\\Projects\\main\\services\\knowgraph\\.venv\\Scripts\\python.exe -X utf8 -m uvicorn app:app --host 127.0.0.1 --port 8001',
  };
  it('reuses the valid running KnowGraph (no second launch → no 10048)', () => {
    expect(decideKnowgraphAction(kg)).toEqual({ action: 'reuse', pid: 30 });
  });
  it('starts exactly one when the port is free', () => {
    expect(decideKnowgraphAction(null)).toEqual({ action: 'start' });
  });
  it('fails honestly (conflict) on an unknown listener — never reuse, never a rival', () => {
    const unknown: PortListener = { pid: 998, name: 'python.exe', commandLine: 'python.exe -m http.server 8001' };
    expect(decideKnowgraphAction(unknown)).toEqual({
      action: 'conflict',
      pid: 998,
      commandLine: 'python.exe -m http.server 8001',
    });
  });
});

describe('isLiquidAItyAutogenListener / decideAutogenAction — same port-scoped discipline on 8003', () => {
  it('accepts the uv-shimmed autogen uvicorn (no repo root in cmdline)', () => {
    const p: PortListener = {
      pid: 40, name: 'python.exe',
      commandLine: '"C:\\Users\\me\\AppData\\Roaming\\uv\\python\\cpython-3.11\\python.exe" -X utf8 -m uvicorn app.main:app --host 127.0.0.1 --port 8003',
    };
    expect(isLiquidAItyAutogenListener(p)).toBe(true);
    expect(decideAutogenAction(p)).toEqual({ action: 'reuse', pid: 40 });
  });
  it('rejects the KnowGraph uvicorn (app:app on 8001) — the two services never cross-match', () => {
    const p: PortListener = {
      pid: 41, name: 'python.exe',
      commandLine: '.venv\\Scripts\\python.exe -X utf8 -m uvicorn app:app --host 127.0.0.1 --port 8001',
    };
    expect(isLiquidAItyAutogenListener(p)).toBe(false);
    expect(isLiquidAItyKnowgraphListener(p)).toBe(true);
  });
  it('conflicts on an unknown 8003 listener', () => {
    const unknown: PortListener = { pid: 42, name: 'python.exe', commandLine: 'python.exe -m http.server 8003' };
    expect(decideAutogenAction(unknown)).toEqual({ action: 'conflict', pid: 42, commandLine: 'python.exe -m http.server 8003' });
  });
  it('starts when 8003 is free', () => {
    expect(decideAutogenAction(null)).toEqual({ action: 'start' });
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
  it('owns only the official Python HTTP MCP host under the repo', () => {
    const p = {
      pid: 15,
      name: 'python.exe',
      commandLine: 'C:\\Projects\\main\\apps\\python-models\\.venv\\Scripts\\python.exe C:\\Projects\\main\\apps\\python-models\\app\\mcp_host.py',
    };
    expect(isLiquidAItyOwnedDevProcess(p, REPO)).toEqual({ owned: true, role: 'mcp' });
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
      'C:\\Projects\\main\\apps\\python-models\\.venv\\Scripts\\python.exe C:\\Projects\\main\\apps\\python-models\\app\\other_host.py',
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
