import fs from 'fs';
import path from 'path';
import { decide, loadPolicy } from './policy';
import { askMCP } from '../connectors/mcp.http';
import { askN8N } from '../connectors/n8n';
import { getTool } from '../registry';
import { matchTools } from '../registry';

export type RouteInput  = { q: string; meta?: Record<string, any> };
export type RouteResult = { ok: true; routed: string; tool?: { id: string; name: string }; reasoning: string };

export async function routeQuery(input: RouteInput): Promise<RouteResult> {
  const ranked = matchTools(input.q || '');
  if (!ranked || ranked.length === 0) {
    return { ok: true, routed: 'fallback', reasoning: 'No tool matched; using fallback.' } as RouteResult;
  }
  const top: any = ranked[0];
  const tool = top.tool;
  const hits = Number(top.hits || 0);
  const total = Number(top.total || 0);
  const score = Number(top.score || 0);
  return {
    ok: true,
    routed: tool.id,
    tool: { id: tool.id, name: tool.name },
    reasoning: `Keywords matched ${hits}/${total}; score=${score.toFixed(2)}`
  };
}

const MEM_PATH = path.resolve(process.cwd(), '.data/sol-memory.json');

type Msg = { role: 'system'|'user'|'assistant', content: string };
type History = Msg[];

function ensureDir(p: string) { const d = path.dirname(p); if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }
function loadMemory(): History { try { const raw = fs.readFileSync(MEM_PATH, 'utf8'); const arr = JSON.parse(raw); if (Array.isArray(arr)) return arr as History; } catch {} return []; }
function saveMemory(h: History) { ensureDir(MEM_PATH); fs.writeFileSync(MEM_PATH, JSON.stringify(h, null, 2), 'utf8'); }

async function runViaRegistryOpenAI(prompt: string): Promise<string> {
  const tool = getTool('openai') as any;
  if (!tool || typeof tool.run !== 'function') throw new Error('registry openai tool unavailable');
  const r = await tool.run({ prompt });
  const t = (r?.content ?? r?.text ?? r?.result ?? r);
  return typeof t === 'string' ? t : JSON.stringify(t);
}

async function runViaDirectOpenAI(systemPrompt: string, user: string, temperature = 0.2): Promise<string> {
  if (!process.env.OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY');
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: user }], temperature })
  });
  if (!resp.ok) throw new Error(`OpenAI HTTP ${resp.status}: ${(await resp.text()).slice(0,300)}`);
  const data: any = await resp.json();
  return data?.choices?.[0]?.message?.content ?? '';
}

export async function solRun({ question, use, params }: { question: string; use?: 'lc'|'mcp'|'n8n'; params?: any }): Promise<{ text: string, decision?: any }>{
  if (!question || !question.trim()) throw new Error('question required');
  const policy = loadPolicy();
  const sys = (policy.system_prompt?.trim()) || (process.env.SOL_SYSTEM_PROMPT?.trim()) || 'You are Sol, a concise, helpful trading assistant. Answer briefly and clearly.';
  const hist = loadMemory();

  let decision: any = undefined;
  const wantsExplain = !!policy.observability?.explain_decision;
  if (!use) { const d = decide(policy, question); decision = d; }
  const chosen = use ? use : ((decision?.toolName || '').startsWith('mcp') ? 'mcp' : (decision?.toolName || '').startsWith('n8n') ? 'n8n' : 'lc');

  let text = '';
  if (chosen === 'mcp') {
    text = await askMCP(question, params).catch((e: any) => { throw new Error(e?.message || 'MCP error'); });
  } else if (chosen === 'n8n') {
    text = await askN8N(params?.workflow ?? 'default', params?.payload ?? question).catch((e: any) => { throw new Error(e?.message || 'n8n error'); });
  } else {
    const flat = ([{ role: 'system', content: sys } as Msg, ...hist, { role: 'user', content: question }] as Msg[])
      .map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');
    try { text = await runViaRegistryOpenAI(flat); }
    catch { text = await runViaDirectOpenAI(sys, question, policy.defaults?.temperature ?? 0.2); }
  }

  const clean = (text ?? '').toString().trim();
  const next = [...hist, { role: 'user', content: question }, { role: 'assistant', content: clean }] as History;
  saveMemory(next);
  return wantsExplain ? { text: clean || '(empty response)', decision: decision ?? null } : { text: clean || '(empty response)' };
}

export async function askSol(question: string): Promise<{ text: string }>{ const r = await solRun({ question, use: 'lc' }); return { text: r.text }; }
export function resetSolMemory(): void { saveMemory([]); }
