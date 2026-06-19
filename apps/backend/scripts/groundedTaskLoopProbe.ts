// LIVE grounded-vs-ungrounded proof for the product loop. Reads the accepted RDW/SpaceX
// ThinkGraph record, builds the Task Ledger grounding context from it, then runs the SAME
// RDW/SpaceX request through a real model (OpenRouter) TWICE — once WITHOUT grounding, once
// WITH the grounding directive injected — and scores both. Proves graph memory improves Task
// Ledger output. NO Docker Gemma, NO live RDW price fetch, NO SpaceX research, NO writes.
//   npx tsx --env-file=apps/backend/.env apps/backend/scripts/groundedTaskLoopProbe.ts
import { DEFAULT_PLANFLOW_TASK_OUTPUT_CONTRACT } from '../../../client/src/components/builder/deckRuntime';
import { runLLM } from '../src/llm/client';
import { buildGroundedTaskLedgerContext, renderTaskLedgerGroundingDirective } from '../src/services/graphContext/groundedTaskLedgerContext';
import { scoreTaskGrounding, MAX_TASK_GROUNDING_SCORE } from '../src/services/graphContext/taskGroundingScore';

const PROJECT_ID = process.env.TG_PROJECT_ID || 'magone-graphpayload-test';
const PROVIDER = process.env.MAG_ONE_PROVIDER || 'openrouter';
const MODEL = process.env.MAG_ONE_MODEL || 'openai/gpt-5.1-chat';

const USER_REQUEST =
  'Continue the RDW / SpaceX trading research workflow. Build tasks to verify RDW current ' +
  'price using live market data, research SpaceX private-market valuation from secondary-' +
  'market/tender sources, and preserve graph context before creating Task Ledger tasks.';

function safeParse(text: string): any {
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

async function callModel(system: string): Promise<{ taskObjects: unknown; graphPayload: unknown; raw: string }> {
  const res = await runLLM(USER_REQUEST, { provider: PROVIDER, providerModelId: MODEL, system, jsonMode: true, maxTokens: 3000, temperature: 0 });
  const parsed = safeParse(res.text) || {};
  return { taskObjects: parsed.planFlowTaskObjects, graphPayload: parsed.graphPayload, raw: res.text };
}

async function main() {
  console.log('[loop] projectId =', PROJECT_ID, ' provider =', PROVIDER, ' model =', MODEL);

  // 1) Build the grounding context from the accepted RDW/SpaceX ThinkGraph record (read-only).
  const ctx = await buildGroundedTaskLedgerContext({ userText: USER_REQUEST, projectId: PROJECT_ID });
  console.log('[loop] grounding thinkGraph.ok =', ctx.thinkGraph.ok, ' facts =', ctx.thinkGraph.facts.length);
  console.log('[loop] grounding facts =', ctx.thinkGraph.facts.map((f) => f.label).join(', '));
  if (!ctx.thinkGraph.ok || ctx.thinkGraph.facts.length === 0) {
    console.log('[loop] RESULT = NO_GROUNDING_CONTEXT (no accepted records for project) — blocker=', ctx.thinkGraph.blocker || 'empty');
    process.exitCode = 2;
    return;
  }

  // Distinctive graph tokens an ungrounded answer would NOT produce: the full entity label +
  // the sourceRef carried by the record. Bare tickers (RDW/SpaceX) are in the request itself.
  const sourceRef = ctx.thinkGraph.facts.find((f) => f.sourceRef)?.sourceRef || '';
  const providedGraphFacts = ['Redwire Corporation', sourceRef].filter(Boolean);

  // 2) Two real model calls — ungrounded vs grounded — same request, same contract.
  const groundedSystem = `${DEFAULT_PLANFLOW_TASK_OUTPUT_CONTRACT}\n\n${renderTaskLedgerGroundingDirective(ctx)}`;
  let ungrounded: Awaited<ReturnType<typeof callModel>>;
  let grounded: Awaited<ReturnType<typeof callModel>>;
  try {
    ungrounded = await callModel(DEFAULT_PLANFLOW_TASK_OUTPUT_CONTRACT);
    grounded = await callModel(groundedSystem);
  } catch (err: any) {
    console.log('[loop] RESULT = LIVE_MODEL_BLOCKED blocker=', err?.message || err);
    process.exitCode = 2;
    return;
  }

  // 3) Score both with the SAME criteria + provided facts.
  const ungroundedScore = scoreTaskGrounding({ taskObjects: ungrounded.taskObjects, graphPayload: ungrounded.graphPayload, providedGraphFacts });
  const groundedScore = scoreTaskGrounding({ taskObjects: grounded.taskObjects, graphPayload: grounded.graphPayload, providedGraphFacts });

  console.log('\n[loop] UNGROUNDED tasks =\n', JSON.stringify(ungrounded.taskObjects, null, 2));
  console.log('[loop] UNGROUNDED score =', JSON.stringify(ungroundedScore));
  console.log('\n[loop] GROUNDED tasks =\n', JSON.stringify(grounded.taskObjects, null, 2));
  console.log('[loop] GROUNDED score =', JSON.stringify(groundedScore));

  console.log('\n[loop] === SCORE DELTA ===');
  console.log(`[loop] ungrounded total = ${ungroundedScore.total}/${MAX_TASK_GROUNDING_SCORE}`);
  console.log(`[loop] grounded   total = ${groundedScore.total}/${MAX_TASK_GROUNDING_SCORE}`);
  console.log(`[loop] improvement = +${groundedScore.total - ungroundedScore.total}`);
  console.log('[loop] grounded usedGraphFacts =', JSON.stringify(groundedScore.usedGraphFacts));
  console.log('[loop] grounded hallucinationFlags =', JSON.stringify(groundedScore.hallucinationFlags));

  const improved = groundedScore.total > ungroundedScore.total;
  const noNewHallucinations = groundedScore.hallucinationFlags.length <= ungroundedScore.hallucinationFlags.length;
  console.log('[loop] RESULT =', improved && noNewHallucinations
    ? 'IMPROVEMENT_PROVEN (grounded > ungrounded, no new hallucinations)'
    : improved
      ? 'IMPROVED_BUT_CHECK_HALLUCINATIONS'
      : 'NO_IMPROVEMENT (grounded did not beat ungrounded)');
  process.exitCode = improved ? 0 : 1;
}

main().catch((e) => {
  console.error('[loop] RESULT = LIVE_MODEL_BLOCKED (exception) blocker=', e?.message || e);
  process.exitCode = 2;
});
