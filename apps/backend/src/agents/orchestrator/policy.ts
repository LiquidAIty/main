import fs from 'fs';
import path from 'path';

export type SolPolicy = {
  system_prompt?: string;
  defaults?: { backend?: 'lc' | 'mcp' | 'n8n'; temperature?: number; max_tokens?: number };
  observability?: { explain_decision?: boolean };
  limits?: { max_history?: number };
  tools: Array<{ name: string; kind: 'local' | 'mcp' | 'n8n'; description?: string }>;
  routing: { rules: Array<{ id: string; when: any; use: string }> };
};

const DEFAULT_POLICY: SolPolicy = {
  system_prompt: 'You are Sol, a concise, helpful trading assistant. Answer briefly and clearly. Use tools only when needed.',
  defaults: { backend: 'lc', temperature: 0.2, max_tokens: 512 },
  observability: { explain_decision: true },
  limits: { max_history: 20 },
  tools: [{ name: 'openai', kind: 'local', description: 'General Q&A' }],
  routing: { rules: [{ id: 'fallback', when: { always: true }, use: 'openai' }] },
};

export function loadPolicy(): SolPolicy {
  const root = process.cwd();
  const policyPath = path.join(root, 'sol.policy.json');
  
  try {
    if (fs.existsSync(policyPath)) {
      const doc = JSON.parse(fs.readFileSync(policyPath, 'utf8')) as any;
      return normalizePolicy(doc);
    }
  } catch (error) {
    console.error('Error loading policy JSON:', error);
  }
  
  return DEFAULT_POLICY;
}

function normalizePolicy(doc: any): SolPolicy {
  const p = { ...DEFAULT_POLICY, ...(doc || {}) };
  p.defaults = { ...DEFAULT_POLICY.defaults, ...(doc?.defaults || {}) };
  p.observability = { ...DEFAULT_POLICY.observability, ...(doc?.observability || {}) };
  p.limits = { ...DEFAULT_POLICY.limits, ...(doc?.limits || {}) };
  p.tools = Array.isArray(doc?.tools) ? doc.tools : DEFAULT_POLICY.tools;
  p.routing = { rules: Array.isArray(doc?.routing?.rules) ? doc.routing.rules : DEFAULT_POLICY.routing.rules };
  return p as SolPolicy;
}

export function decide(policy: SolPolicy, userText: string): { ruleId: string; toolName: string; reason: string } {
  const rules = policy.routing?.rules || [];
  for (const r of rules) {
    const w = r.when || {};
    if (w.always === true) return { ruleId: r.id, toolName: r.use, reason: `matched ${r.id} via always` };
    if (typeof w.match === 'string') {
      try { if (new RegExp(w.match, 'i').test(userText)) return { ruleId: r.id, toolName: r.use, reason: `matched ${r.id} via match` }; } catch {}
    }
    if (Array.isArray(w.any)) {
      for (const cond of w.any) {
        if (cond?.always === true) return { ruleId: r.id, toolName: r.use, reason: `matched ${r.id} via any.always` };
        if (typeof cond?.match === 'string') {
          try { if (new RegExp(cond.match, 'i').test(userText)) return { ruleId: r.id, toolName: r.use, reason: `matched ${r.id} via any.match` }; } catch {}
        }
      }
    }
  }
  return { ruleId: 'fallback', toolName: 'openai', reason: 'fallback' };
}
