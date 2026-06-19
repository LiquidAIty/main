// Deterministic grounding eval for Task Ledger output. NO model call, NO network. Scores a
// task output (planFlowTaskObjects + graphPayload, or raw text) on whether it is grounded:
// names the real entities, treats SpaceX as private, makes a live-quote LOOKUP task instead
// of inventing a price, researches SpaceX private-market valuation, preserves a sourceRef /
// graph reference, avoids import/export trade drift and invented proof, and actually uses the
// prior graph facts it was given. The first measurable product-loop proof — not a benchmark.

export type TaskGroundingScore = {
  total: number;
  passed: number;
  failed: string[];
  usedGraphFacts: string[];
  hallucinationFlags: string[];
};

export type TaskGroundingInput = {
  taskObjects?: unknown;
  graphPayload?: unknown;
  rawText?: string;
  /** Distinctive facts/sourceRefs the grounding context provided (entity labels, sourceRef). */
  providedGraphFacts?: string[];
};

const CRITERIA = 8;

function buildText(input: TaskGroundingInput): string {
  const parts: string[] = [];
  if (input.rawText) parts.push(String(input.rawText));
  if (input.taskObjects !== undefined) parts.push(JSON.stringify(input.taskObjects));
  if (input.graphPayload !== undefined) parts.push(JSON.stringify(input.graphPayload));
  return parts.join('\n');
}

/**
 * Score one Task Ledger output. Pure + deterministic: the same input always yields the same
 * score. `total` is the number of grounding criteria passed (out of 8). `failed` names the
 * missed criteria; `hallucinationFlags` names invented content; `usedGraphFacts` lists which
 * provided facts actually appear in the output.
 */
export function scoreTaskGrounding(input: TaskGroundingInput): TaskGroundingScore {
  const text = buildText(input).toLowerCase();
  const provided = (input.providedGraphFacts ?? [])
    .map((f) => String(f).toLowerCase().trim())
    .filter(Boolean);

  const failed: string[] = [];
  const hallucinationFlags: string[] = [];
  let passed = 0;
  const pass = (ok: boolean, failKey: string) => {
    if (ok) passed += 1;
    else failed.push(failKey);
  };

  // 1) names RDW / Redwire
  pass(/\brdw\b/.test(text) || text.includes('redwire'), 'missing_rdw_redwire');

  // 2) treats SpaceX as private
  pass(text.includes('spacex') && text.includes('private'), 'spacex_not_marked_private');

  // 3) creates a live RDW quote LOOKUP task (not an invented price)
  pass(/(live|current|real-?time)[^.]{0,40}(quote|price|market[\s-]?data)|quote/.test(text), 'missing_live_rdw_quote_task');

  // 4) creates a SpaceX private-market valuation research task
  pass(/(valuation|secondary[\s-]?market|tender|private[\s-]?market)/.test(text), 'missing_spacex_valuation_task');

  // 5) preserves a NON-EMPTY sourceRef / graph reference (an empty "sourceRef":"" does not count)
  const hasSourceRef =
    /"source_?refs?"\s*:\s*"[^"]+"/.test(text) ||
    /"ref"\s*:\s*"[^"]+"/.test(text) ||
    /user_request_stream/.test(text) ||
    /(graph context|graph fact|graphgroundingcontext)/.test(text);
  pass(hasSourceRef, 'missing_sourceref_or_graph_ref');

  // 6) does NOT drift into import/export trade research
  const importExportDrift = /(hs code|comtrade|customs|tariff|import\/export|harmonized system)/.test(text);
  if (importExportDrift) hallucinationFlags.push('import_export_trade_drift');
  pass(!importExportDrift, 'import_export_drift');

  // 7) does NOT invent a current price / SpaceX public price / completed proof
  const inventedPrice = /(price|quote|trading at|currently)[^.]{0,24}\$\s?\d/.test(text) || /\$\s?\d{1,5}(\.\d+)?\s*(per share|\/share|usd)/.test(text);
  const spacexPublicPrice = /spacex[^.]{0,40}(stock price|share price|ticker symbol|public (stock )?price)/.test(text);
  const fakeCompleted = /"status"\s*:\s*"(completed|done|complete)"/.test(text);
  if (inventedPrice) hallucinationFlags.push('invented_current_price');
  if (spacexPublicPrice) hallucinationFlags.push('invented_spacex_public_price');
  if (fakeCompleted) hallucinationFlags.push('invented_completed_proof');
  pass(!inventedPrice && !spacexPublicPrice && !fakeCompleted, 'invented_unknown_or_proof');

  // 8) actually uses the prior graph facts it was given
  const usedGraphFacts = provided.filter((f) => text.includes(f));
  pass(usedGraphFacts.length > 0, 'did_not_use_provided_graph_facts');

  return {
    total: passed,
    passed,
    failed,
    usedGraphFacts,
    hallucinationFlags,
  };
}

export const MAX_TASK_GROUNDING_SCORE = CRITERIA;
