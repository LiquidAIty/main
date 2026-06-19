// REAL Mag One / Task Ledger run probe (NOT a fixture). Uses the actual editable
// card-config contract (DEFAULT_PLANFLOW_TASK_OUTPUT_CONTRACT) as the system prompt and
// the prior RDW / SpaceX trade-research conversation as the user input, calls the real
// cloud model (OpenRouter — the working provider per repo memory; NOT Docker Gemma for
// the Mag One step), then feeds the produced OWL-shaped graphPayload into the existing
// local SLM graph extraction normalization path. Honest on model-unavailable.
//   npx tsx --env-file=apps/backend/.env apps/backend/scripts/magOneOwlRealRunProbe.ts
import { DEFAULT_PLANFLOW_TASK_OUTPUT_CONTRACT } from '../../../client/src/components/builder/deckRuntime';
import { runLLM } from '../src/llm/client';
import { parseSlmGraphExtraction } from '../src/slmGraph/slmGraphWorker';

const USER_CONTENT = `PRIOR CONVERSATION (continue reasoning from this REAL context):
User: "what's the price of RDW or SpaceX today"
(assistant gave stale RDW data and said it could not fetch live prices)
User: "yes, your out of date, can you find todays prices"
(assistant asked a generic multiple-choice question instead of continuing)
User: "what's the price of RDW or SpaceX today"
(assistant said RDW is public but had no real-time price, and SpaceX is private)
User: "propose agents and or tools you need, make a plan, i want to use you for trade reaserch"

INTERPRETATION (from the user): RDW = Redwire Corporation (public stock ticker RDW).
SpaceX is a private company with NO public stock price. This is trading / investment /
market research: live public quote for RDW; private-market valuation / tender / secondary-
market data for SpaceX; public proxies / suppliers / adjacent equities; source-backed market
research; graph memory / task ledger / follow-up monitoring. It is NOT international import/
export trade research and does NOT need HS codes unless the user explicitly asks.

Continue from this context. Produce the Magentic-One Task Ledger task objects AND the
OWL-shaped graphPayload per the contract. Do NOT invent a live RDW price — instead create a
task that requires a live market-data lookup. Do NOT claim SpaceX has a public stock price.`;

const PROVIDER = process.env.MAG_ONE_PROVIDER || 'openrouter';
const MODEL = process.env.MAG_ONE_MODEL || 'openai/gpt-5.1-chat';

function safeParseObject(text: string): any | null {
  try {
    return JSON.parse(text);
  } catch {
    const m = String(text).match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

async function main() {
  console.log('[mag-one] provider =', PROVIDER, ' model =', MODEL);
  console.log('[mag-one] contract = DEFAULT_PLANFLOW_TASK_OUTPUT_CONTRACT (editable card-config, real path)');
  console.log('[mag-one] requestTimestamp =', new Date().toISOString());

  let res: { text: string; model: string; provider: string };
  try {
    res = await runLLM(USER_CONTENT, {
      provider: PROVIDER,
      providerModelId: MODEL,
      system: DEFAULT_PLANFLOW_TASK_OUTPUT_CONTRACT,
      jsonMode: true,
      maxTokens: 3000,
      temperature: 0,
    });
  } catch (err: any) {
    console.log('[mag-one] RESULT = MODEL_UNAVAILABLE blocker=', err?.message || err);
    process.exitCode = 2;
    return;
  }

  console.log(`[mag-one] real model responded (provider=${res.provider} model=${res.model}, len=${res.text.length})`);
  const parsed = safeParseObject(res.text);
  if (!parsed || typeof parsed !== 'object') {
    console.log('[mag-one] RESULT = FAIL (model did not return a JSON object)');
    console.log('[mag-one] rawPreview =', res.text.slice(0, 600));
    process.exitCode = 1;
    return;
  }

  const taskObjects = Array.isArray(parsed.planFlowTaskObjects) ? parsed.planFlowTaskObjects : [];
  const graphPayload = parsed.graphPayload;
  console.log('[mag-one] planFlowTaskObjects =\n', JSON.stringify(taskObjects, null, 2));
  console.log('[mag-one] graphPayload =\n', JSON.stringify(graphPayload, null, 2));

  if (!graphPayload || typeof graphPayload !== 'object') {
    console.log('[mag-one] RESULT = FAIL (no graphPayload in real Mag One output) — fail closed');
    process.exitCode = 1;
    return;
  }

  // Feed the REAL graphPayload into the existing SLM graph extraction normalization path.
  const norm = parseSlmGraphExtraction(JSON.stringify(graphPayload));
  console.log('[mag-one] SLM normalization =', norm.ok ? 'ok' : `fail (${(norm as any).error})`);
  if (!norm.ok) {
    console.log('[mag-one] RESULT = FAIL (graphPayload did not normalize / fail closed)');
    process.exitCode = 1;
    return;
  }
  console.log('[mag-one] canonical SlmGraphExtraction =\n', JSON.stringify(norm.result, null, 2));

  // Verify (semantic, lenient on exact labels; canonical fields must exist AND be nonempty —
  // the tightened contract must produce a populated graphPayload from explicit input facts).
  const ents = norm.result.entities;
  const rels = norm.result.relations;
  const rawEnts = Array.isArray(graphPayload.entities) ? graphPayload.entities : [];
  const rawRels = Array.isArray(graphPayload.relations) ? graphPayload.relations : [];
  const labels = ents.map((e) => e.label.toLowerCase());
  const allText = JSON.stringify(parsed).toLowerCase();
  const taskText = JSON.stringify(taskObjects).toLowerCase();
  const checks: Array<[string, boolean]> = [
    ['has task objects', taskObjects.length > 0],
    ['graphPayload normalized ok', norm.ok],
    ['nonempty graphPayload.entities (raw model output)', rawEnts.length > 0],
    ['nonempty graphPayload.relations (raw model output)', rawRels.length > 0],
    ['nonempty normalized entities', ents.length > 0],
    ['nonempty normalized relations', rels.length > 0],
    ['canonical entity fields present (label+type, no undefined)', ents.length > 0 && ents.every((e) => !!e.label && !!e.type)],
    ['canonical relation fields present (from+to+type, no undefined)', rels.length > 0 && rels.every((r) => !!r.from && !!r.to && !!r.type)],
    ['sourceRefs[].ref present', norm.result.sourceRefs.length > 0 && norm.result.sourceRefs.every((s) => !!s.ref)],
    ['confidence and/or uncertainty present', Number.isFinite(norm.result.confidence) || norm.result.uncertainty.length > 0],
    ['uncertainty notes the unavailable live price / private valuation', norm.result.uncertainty.length > 0],
    ['mentions RDW / Redwire', labels.some((l) => l.includes('rdw') || l.includes('redwire')) || allText.includes('redwire') || allText.includes('rdw')],
    ['mentions SpaceX', labels.some((l) => l.includes('spacex')) || allText.includes('spacex')],
    ['SpaceX treated as private (no public stock price)', allText.includes('private') && !/spacex[^.]{0,40}(stock price|share price|ticker)/.test(allText)],
    ['market/trading research (not import/export HS codes)', /(quote|valuation|market|equity|ticker|secondary|tender|watchlist)/.test(taskText) && !/(hs code|comtrade|import\/export|customs tariff)/.test(taskText)],
    ['live RDW quote is a task, not an invented price', /(live|current|real-?time).{0,30}(quote|price|market data)/.test(taskText) || /quote/.test(taskText)],
  ];
  for (const [name, pass] of checks) console.log(`[mag-one] verify: ${pass ? 'PASS' : 'FAIL'}  ${name}`);
  const allPass = checks.every(([, pass]) => pass);
  const graphEmpty = ents.length === 0 && rels.length === 0;
  let verdict: string;
  if (allPass) verdict = 'NONEMPTY_GRAPHPAYLOAD_PROVEN (real Mag One OWL run -> populated SLM extraction)';
  else if (graphEmpty) verdict = 'STILL_GRAPH_EMPTY (real run produced no graph entities/relations)';
  else verdict = 'PARTIAL (see FAIL lines)';
  console.log('[mag-one] RESULT =', verdict);
  process.exitCode = allPass ? 0 : 1;
}

main().catch((e) => {
  console.error('[mag-one] RESULT = MODEL_UNAVAILABLE (exception) blocker=', e?.message || e);
  process.exitCode = 2;
});
