import { z } from "zod";
import { Playbooks } from "./playbooks";

Playbooks.kg_ingest_url = {
  id: "kg_ingest_url",
  title: "Ingest URL → KG",
  description: "Scrape a URL, extract entities, and upsert to Neo4j",
  params: z.object({
    url: z.string().url(),
    triplePrompt: z
      .string()
      .default(
        "Extract entities and relations as JSON {nodes:[{id,labels,props}],edges:[{from,to,type,props}]}"
      ),
  }),
  steps: [
    {
      name: "Scrape",
      tool: "scraper_http",
      saveAs: "page",
      mapInput: (ctx) => ({ url: ctx.params.url }),
    },
    {
      name: "Extract",
      tool: "openai_http",
      saveAs: "triples",
      mapInput: (ctx) => ({
        prompt: `${ctx.params.triplePrompt}\n\nTEXT:\n${ctx.page?.text ?? ctx.page}`,
      }),
    },
    {
      name: "Upsert",
      tool: "knowledge_graph",
      mapInput: (ctx) => {
        const parsed = typeof ctx.triples === "string" ? JSON.parse(ctx.triples) : ctx.triples;
        return { nodes: parsed?.nodes ?? [], edges: parsed?.edges ?? [] };
      },
    },
  ],
};

Playbooks.market_brief_to_doc = {
  id: "market_brief_to_doc",
  title: "Market Brief → Doc",
  description: "Generate a market brief and append to a Google Doc",
  params: z.object({ topic: z.string(), docId: z.string().optional() }),
  steps: [
    {
      name: "Draft",
      tool: "openai_http",
      saveAs: "draft",
      mapInput: (ctx) => ({ prompt: `Write a concise market brief on: ${ctx.params.topic}.` }),
    },
    {
      name: "Append",
      tool: "google_http",
      saveAs: "doc",
      mapInput: (ctx) => ({ op: "docs_append", args: { docId: ctx.params.docId, content: ctx.draft } }),
    },
  ],
};

Playbooks.backtest_trigger = {
  id: "backtest_trigger",
  title: "Backtest Trigger (n8n)",
  description: "Kick off an n8n workflow for strategy backtesting",
  params: z.object({
    strategy: z.string(),
    symbol: z.string(),
    from: z.string(),
    to: z.string(),
    workflow: z.string().optional(),
  }),
  steps: [
    {
      name: "Trigger",
      tool: "n8n_http",
      saveAs: "job",
      mapInput: (ctx) => ({
        workflow: ctx.params.workflow,
        payload: {
          strategy: ctx.params.strategy,
          symbol: ctx.params.symbol,
          from: ctx.params.from,
          to: ctx.params.to,
        },
      }),
    },
  ],
};

Playbooks.rag_answer = {
  id: "rag_answer",
  title: "RAG Answer",
  description: "Retrieve relevant chunks then summarize the findings",
  params: z.object({ query: z.string(), topK: z.number().default(5) }),
  steps: [
    {
      name: "Retrieve",
      tool: "rag_http",
      saveAs: "chunks",
      mapInput: (ctx) => ({ query: ctx.params.query, topK: ctx.params.topK }),
    },
    {
      name: "Summarize",
      tool: "openai_http",
      mapInput: (ctx) => ({ prompt: `Summarize the retrieved chunks:\n${JSON.stringify(ctx.chunks)}` }),
    },
  ],
};

/* PB1 — SEC Company Dossier → KG → Brief */
Playbooks["sec_company_dossier"] = {
  id: "sec_company_dossier",
  title: "SEC Dossier → KG → Brief",
  description: "Fetch filings, extract triples, upsert to KG, and draft a brief.",
  params: z.object({ ticker: z.string(), topK: z.number().default(10), docId: z.string().optional() }),
  steps: [
    {
      name: "List filings",
      tool: "sec_http",
      saveAs: "filings",
      mapInput: (c) => ({ op: "company_filings", cikOrTicker: c.params.ticker, limit: c.params.topK }),
    },
    {
      name: "Extract triples",
      tool: "openai_http",
      saveAs: "triples",
      mapInput: (c) => ({
        prompt: `From these SEC filings JSON, extract {nodes,edges} for a knowledge graph.\nJSON:\n${JSON.stringify(
          c.filings
        )}`,
      }),
    },
    {
      name: "Upsert KG",
      tool: "knowledge_graph",
      mapInput: (c) => {
        const t = typeof c.triples === "string" ? JSON.parse(c.triples) : c.triples;
        return { nodes: t?.nodes || [], edges: t?.edges || [] };
      },
    },
    {
      name: "Draft brief",
      tool: "openai_http",
      saveAs: "brief",
      mapInput: (c) => ({
        prompt: `Write a concise executive brief for ${c.params.ticker} based on these filings:\n${JSON.stringify(
          c.filings
        )}`,
      }),
    },
    {
      name: "Append doc (optional)",
      tool: "google_http",
      mapInput: (c) => ({ op: "docs_append", args: { docId: c.params.docId, content: c.brief } }),
    },
  ],
};

/* PB2 — Filings Delta Monitor → n8n alert (and optional KG later) */
Playbooks["sec_filings_delta"] = {
  id: "sec_filings_delta",
  title: "SEC Filings Delta Monitor",
  description: "Detect new filings vs last snapshot and alert via n8n.",
  params: z.object({ ticker: z.string(), form: z.string().default("8-K") }),
  steps: [
    {
      name: "List filings",
      tool: "sec_http",
      saveAs: "curr",
      mapInput: (c) => ({ op: "company_filings", cikOrTicker: c.params.ticker, limit: 20 }),
    },
    {
      name: "Load last snapshot",
      tool: "memory_http",
      saveAs: "prev",
      mapInput: (c) => ({ op: "get", key: `sec:last:${c.params.ticker}:${c.params.form}` }),
    },
    {
      name: "Compute delta",
      tool: "openai_http",
      saveAs: "delta",
      mapInput: (c) => ({
        prompt: `Given 'curr' and 'prev' filings JSON, return JSON {newCount, newItems:[{title,url,form,date}]} filtered to form ${c.params.form}.\nprev:\n${JSON.stringify(
          c.prev
        )}\ncurr:\n${JSON.stringify(c.curr)}`,
      }),
    },
    {
      name: "Save snapshot",
      tool: "memory_http",
      mapInput: (c) => ({ op: "set", key: `sec:last:${c.params.ticker}:${c.params.form}`, value: c.curr }),
    },
    {
      name: "Alert n8n",
      tool: "n8n_http",
      mapInput: (c) => ({ payload: { ticker: c.params.ticker, form: c.params.form, delta: c.delta } }),
    },
  ],
};

/* PB3 — Competitor Graph Build (infer peers, upsert) */
Playbooks["competitor_graph"] = {
  id: "competitor_graph",
  title: "Build Competitor Graph",
  description: "Infer peers from filings and upsert peer relations to KG.",
  params: z.object({ ticker: z.string() }),
  steps: [
    {
      name: "List filings",
      tool: "sec_http",
      saveAs: "filings",
      mapInput: (c) => ({ op: "company_filings", cikOrTicker: c.params.ticker, limit: 15 }),
    },
    {
      name: "Peers → triples",
      tool: "openai_http",
      saveAs: "triples",
      mapInput: (c) => ({
        prompt: `From these filings JSON for ${c.params.ticker}, infer peer companies and output KG triples {nodes,edges} with PEER_OF edges.\n${JSON.stringify(
          c.filings
        )}`,
      }),
    },
    {
      name: "Upsert KG",
      tool: "knowledge_graph",
      mapInput: (c) => {
        const t = typeof c.triples === "string" ? JSON.parse(c.triples) : c.triples;
        return { nodes: t?.nodes || [], edges: t?.edges || [] };
      },
    },
  ],
};

/* PB4 — Fundamentals → Trade Setup */
Playbooks["fundamentals_to_trade"] = {
  id: "fundamentals_to_trade",
  title: "Fundamentals → Trade Setup",
  description: "Combine filings context + signals to produce a trade spec JSON.",
  params: z.object({ symbol: z.string(), riskPct: z.number().default(0.5) }),
  steps: [
    {
      name: "Recent filings",
      tool: "sec_http",
      saveAs: "filings",
      mapInput: (c) => ({ op: "company_filings", cikOrTicker: c.params.symbol, limit: 5 }),
    },
    {
      name: "Daily bars",
      tool: "marketdata_http",
      saveAs: "bars",
      mapInput: (c) => ({ op: "bars", symbol: c.params.symbol, timeframe: "1D", limit: 250 }),
    },
    {
      name: "ESN signal",
      tool: "esn_http",
      saveAs: "signal",
      mapInput: (c) => ({ symbol: c.params.symbol, horizon: 20 }),
    },
    {
      name: "Trade idea",
      tool: "openai_http",
      saveAs: "idea",
      mapInput: (c) => ({
        prompt: `Given filings:\n${JSON.stringify(c.filings)}\nBars:\n${JSON.stringify(c.bars)}\nSignal:${JSON.stringify(
          c.signal
        )}\nReturn JSON tradeSpec {entry, stop, take, direction, rationale, riskPct:${c.params.riskPct}}`,
      }),
    },
    {
      name: "Show in UI",
      tool: "ui_http",
      mapInput: (c) => ({ event: "trade_idea", payload: { symbol: c.params.symbol, idea: c.idea } }),
    },
  ],
};

/* PB5 — Backtest Trigger (n8n) */
Playbooks["backtest_trigger"] = {
  id: "backtest_trigger",
  title: "Backtest Trigger (n8n)",
  description: "Trigger an external backtest and report status.",
  params: z.object({
    strategy: z.string(),
    symbol: z.string(),
    from: z.string(),
    to: z.string(),
    workflow: z.string().optional(),
  }),
  steps: [
    {
      name: "Trigger",
      tool: "n8n_http",
      saveAs: "job",
      mapInput: (c) => ({
        workflow: c.params.workflow,
        payload: {
          strategy: c.params.strategy,
          symbol: c.params.symbol,
          from: c.params.from,
          to: c.params.to,
        },
      }),
    },
    {
      name: "Toast",
      tool: "ui_http",
      mapInput: (c) => ({ event: "backtest_started", payload: c.job }),
    },
  ],
};

/* PB6 — Pairs Trade (Company vs Peer) */
Playbooks["pairs_trade"] = {
  id: "pairs_trade",
  title: "Pairs Trade",
  description: "Fetch bars for A and B, propose a pair idea JSON.",
  params: z.object({ a: z.string(), b: z.string() }),
  steps: [
    {
      name: "Bars A",
      tool: "marketdata_http",
      saveAs: "barsA",
      mapInput: (c) => ({ op: "bars", symbol: c.params.a, timeframe: "1D", limit: 300 }),
    },
    {
      name: "Bars B",
      tool: "marketdata_http",
      saveAs: "barsB",
      mapInput: (c) => ({ op: "bars", symbol: c.params.b, timeframe: "1D", limit: 300 }),
    },
    {
      name: "Pair idea",
      tool: "openai_http",
      saveAs: "pair",
      mapInput: (c) => ({
        prompt: `Given daily bars for A=${c.params.a} and B=${c.params.b}, compute a pairs-trade JSON {long, short, entryLogic, exitLogic, rationale, risks}.\nA:\n${JSON.stringify(
          c.barsA
        )}\nB:\n${JSON.stringify(c.barsB)}`,
      }),
    },
    {
      name: "Show in UI",
      tool: "ui_http",
      mapInput: (c) => ({ event: "pair_idea", payload: c.pair }),
    },
  ],
};

/* PB7 — ESN Scan (n8n fanout) */
Playbooks["esn_scan"] = {
  id: "esn_scan",
  title: "ESN Scan (n8n)",
  description: "Fan out symbols to ESN via n8n, return ranked results.",
  params: z.object({ symbols: z.array(z.string()), horizon: z.number().default(20), workflow: z.string().optional() }),
  steps: [
    {
      name: "Run scan",
      tool: "n8n_http",
      saveAs: "results",
      mapInput: (c) => ({ workflow: c.params.workflow, payload: { symbols: c.params.symbols, horizon: c.params.horizon } }),
    },
    {
      name: "Show in UI",
      tool: "ui_http",
      mapInput: (c) => ({ event: "esn_scan_done", payload: c.results }),
    },
  ],
};
