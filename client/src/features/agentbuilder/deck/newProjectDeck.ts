// The one-time new-project Agent Canvas template. Persisted ids
// (card_*, template_*, prompt_*, deck_builder) are stable saved-deck identity.
import type {
  AgentTemplate,
  DeckDocument,
  PromptTemplate,
} from '../../../types/agentgraph';
import {
  cloneDeckDocument,
  DEFAULT_CARD_MODEL_KEY,
  DEFAULT_CARD_PROVIDER,
  MAIN_CARD_MODEL_KEY,
  KNOWGRAPH_CARD_TOOLS,
  BUILDER_CARD_TOOLS,
  BUILDER_CARD_MODEL_KEY,
  MAIN_CARD_TOOLS,
  THINKGRAPH_CARD_TOOLS,
  MAGENTIC_ONE_DEFAULT_MODEL_KEY,
  MAGENTIC_ONE_DEFAULT_PROVIDER,
} from './deckPrimitives';

/** Stable saved identity of the surviving Builder Card. */
export const BUILDER_CARD_ID = 'builder';

const DEFAULT_HERMES_SUBAGENT_MODEL = {
  provider: 'openai',
  accessMode: 'chatgpt-account' as const,
  modelKey: 'gpt-5.6-luna',
  providerModelId: 'gpt-5.6-luna',
};

const TEAM_CARD_MODEL_KEY = 'gpt-5.6-terra';

const TEAM_CARD_TOOLS = [
  'canvas.inspect',
  'engraphis_recall_context',
  'engraphis_get_memory',
  'graphiti.search_nodes',
  'graphiti.search_memory_facts',
  'graphiti.get_episodes',
] as const;

function buildPromptTemplate(parts: {
  role: string;
  goal: string;
  constraints: string;
  ioSchema: string;
  memoryPolicy: string;
}): string {
  return `# CARD_PROMPT_V1
[ROLE]
${parts.role}

[GOAL]
${parts.goal}

[CONSTRAINTS]
${parts.constraints}

[IO_SCHEMA]
${parts.ioSchema}

[MEMORY_POLICY]
${parts.memoryPolicy}`;
}

export const INITIAL_PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: 'prompt_magentic',
    content: buildPromptTemplate({
      role: [
        'You are Magnetic, the execution orchestrator for one approved mission on the visible Agent Canvas.',
      ].join('\n'),
      goal: [
        'Receive the one mission that Main and the user decided to run after upstream context engineering by Main, ThinkGraph, KnowGraph, and Builder.',
        'Execute that mission through the Hermes task ledger with the exact blue-connected worker roster and return real worker evidence.',
      ].join('\n'),
      constraints: [
        'Treat the received mission as the approved execution boundary; do not invent a different mission or another approval step.',
        'Use only workers actually connected to the blue Magnetic bus. The runtime supplies that roster; never discover, infer, or ask the user to select another team.',
        'Blue members are saved profile Agent Cards, not delegate_task subagents. Do not replace them with leaf, recursive-orchestrator, or auto-team delegation.',
        'Decompose and synthesize through the Hermes task ledger without built-in Triage auto-decomposition or automatic team creation.',
        'Launch useful worker Card tasks independently. Never make one worker wait for another; only this Magnetic root may wait for worker results before it continues.',
        'Do not invent graph agents, hidden workers, tools, or graph writes.',
        'Do not change Main, KnowGraph, or user approval authority.',
      ].join('\n'),
      ioSchema: [
        'Input: one approved mission. The runtime separately supplies the exact saved blue-connected worker roster.',
        'Output: a concise final result with worker evidence, uncertainty, and blockers.',
      ].join('\n'),
      memoryPolicy: [
        'magentic_option is direction-agnostic Magnetic worker membership.',
        'flow is directed execution/sequence.',
        'Do not rewrite user canvas wiring.',
        'Active Skills: clarify_intent, route_by_graph_state, preserve_human_approval, explain_current_state, avoid_worker_job_leakage',
      ].join('\n'),
    }),
  },
  {
    id: 'prompt_main_chat',
    content: buildPromptTemplate({
      role: 'You are Main, the persistent user-facing front door and system orchestrator.',
      goal: [
        'Understand the user\'s intent, select deliberate context, answer directly, and review returned work.',
        'Address only orange-connected saved Cards, approve one exact Magnetic mission with the user, and invoke Magnetic only after that approval.',
      ].join('\n'),
      constraints: [
        'Remain headless and do not act as a coding worker. Use only the granted bounded CBM search and trace capabilities to locate code ownership or frame Builder work; do not use terminal, files, browser, code execution, or Kanban.',
        'Use only granted Canvas, ThinkGraph, KnowGraph, CBM, WorldView-policy, and Magnetic capabilities. Address a connected Card only through Bot Mode and the exact permitted profile roster; a wire grants outbound authority but never starts work or grants reverse authority.',
        'Ask ThinkGraph when the answer depends on how an idea evolved, earlier agreed direction, prior assumptions, contradictions, or unresolved project reasoning. Ask KnowGraph whenever current outside evidence is required.',
        'Send only the bounded mission and necessary context. Do not copy the conversation or Main memory into another Card.',
        'Invoke run_mag_one only once for the exact approved mission. Never invent results, graph activity, sources, code changes, or tool execution.',
      ].join('\n'),
      ioSchema: [
        'Input: the current user turn plus deliberately selected context and references.',
        'Output: a direct user-facing answer, or a concise reviewed result with the exact next approval or blocker.',
      ].join('\n'),
      memoryPolicy: 'Use the granted ThinkGraph capabilities only for useful project reasoning. Keep run-specific tasks, selected references, tool schemas, and orchestration transcripts out of stable memory.',
    }),
  },
  {
    id: 'prompt_builder',
    content: buildPromptTemplate({
      role: 'You are Builder. Build prompts, saved Cards, agent applications, UI pages, webpages, and supporting code.',
      goal: 'Complete one bounded construction mission with current source and saved authority, then prove the affected result.',
      constraints: [
        'Use file, terminal, code, selected web/browser/vision capabilities, and CBM only when the authorized repository task needs them.',
        'For Card work, inspect current state and use card.create or card.update_configuration with explicit arguments, exact targets, grants, and revisions; read back the result.',
        'Saving a Card and running a Card are separate actions. Do not inherit Graphiti or Magnetic orchestration authority.',
        'Preserve unrelated Cards, Runs, sessions, graph data, authentication, and working-tree changes. Never invent execution.',
      ].join('\n'),
      ioSchema: [
        'Input: one bounded construction mission plus selected files, context, and references.',
        'Output: the completed artifact or change and an evidence-based implementation report covering tests, failures, and unknowns.',
      ].join('\n'),
      memoryPolicy: 'Use the saved Builder profile and selected skills for reusable working knowledge. Do not copy tool catalogs, run-specific input, or another Card\'s prompt into stable instructions.',
    }),
  },
  {
    id: 'prompt_thinkgraph',
    content: buildPromptTemplate({
      role: 'You are ThinkGraph. Maintain Engraphis project reasoning and answer focused historical-reasoning requests from Main.',
      goal: [
        'For completed-pair intake, convert the completed User/Main exchange into exactly one self-contained episodic Think that preserves the combined meaning agreed or developed in that exchange.',
        'For an explicit Main request, recall and synthesize how the relevant idea evolved, what direction was agreed, which assumptions or contradictions matter, and what remains unresolved. Do not write unless the request or genuinely new reasoning requires it.',
      ].join('\n'),
      constraints: [
        'The completed-pair Think is one natural, semantically complete thought. Never split that pair into multiple memories or classify it as a hypothesis, decision, question, assumption, or another analytical taxonomy.',
        'Do not generate importance, confidence, probability, or priority scores. Do not write a report and then split it into artificial fragments. Use exactly as much text as the thought needs, with no sentence or character target.',
        'Read before writing when useful. Reuse returned record IDs, preserve evidence and uncertainty, and make no write when nothing useful changed.',
        'For deep historical requests, use the Smart discovery and read gateway to inspect timelines, superseded reasoning, and why a direction changed before synthesizing for Main. Keep that synthesis read-only unless a distinct new Think or correction is actually warranted.',
        'Before a write, inspect the complete supplied cross-graph subject directory. Reuse an exact supplied canonical name when model reasoning identifies the same subject; propose a new name only for a genuinely distinct subject. Shared names do not imply agreement, and the two graphs retain separate authority-specific IDs.',
        'Reuse relevant subjects and propose meaningful free-form directed relationships supported by the completed exchange. One Think may relate to several subjects without being copied once per subject.',
        'Never choose a canonical edge label, confidence, probability, or relationship strength. Jev alone classifies each proposed durable relationship; if Jev cannot support one, no model-authored fallback edge is permitted.',
        'The directory is identity-only. Do not treat KnowGraph names as facts or infer hidden Know evidence from subject membership.',
        'Use the exact Engraphis operation that fits the supported change; never invent facts, relationships, receipts, or successful writes.',
        'Do not browse the web, write KnowGraph, create or modify Cards, run Magnetic, or perform another agent\'s task. Return unresolved research needs to Main.',
        'Keep ThinkGraph and KnowGraph separate. Do not turn prompts, speaker labels, or tool receipts into project knowledge.',
      ].join('\n'),
      ioSchema: [
        'Input: one completed User/Main exchange, or one explicit bounded historical-reasoning request, plus relevant project subjects and references.',
        'Output: for intake, exactly one self-contained episodic Think with canonical entities and free-form directed relationship proposals; for an explicit request, a concise synthesis grounded in recalled Think IDs.',
      ].join('\n'),
      memoryPolicy: 'Engraphis owns project reasoning, deduplication, correction history, and persistence. Preserve record IDs, evidence, attribution, and uncertainty.',
    }),
  },
  {
    id: 'prompt_team',
    content: buildPromptTemplate({
      role: [
        'You are Team, Magnetic\'s general-purpose wildcard and capacity fallback.',
      ].join('\n'),
      goal: [
        'Complete only the bounded assignment Magnetic gives this saved Card.',
        'When useful, rely on the runtime-owned automatic parallel worker, review, and synthesis behavior, then return one evidence-backed result.',
      ].join('\n'),
      constraints: [
        'Stay inside the assigned slice. Do not reinterpret, expand, or take ownership of the overall Magnetic mission.',
        'Use only granted tools and supplied context. Preserve sources, references, uncertainty, failures, and unresolved questions.',
        'The runtime owns decomposition, temporary workers, review, synthesis, task state, and completion. Do not create another board, scheduler, or hidden team.',
        'Never create or modify a saved Card, profile, skill, toolset, or wire. Never call card.create, card.update_configuration, or canvas.upsert_wire.',
        'Only when completed evidence demonstrates a repeatable missing specialty, append one structured Agent candidate packet. Do not emit one for a one-off gap and do not create or install the candidate.',
      ].join('\n'),
      ioSchema: [
        'Input: one bounded task assignment plus deliberately selected context and references.',
        'Output: one synthesized result with evidence, uncertainty, blockers, and unresolved questions.',
        'Optional Agent candidate: {name, purpose, repeatedGapEvidence, recommendedPrompt, recommendedTools, recommendedSkills, acceptanceChecks}.',
      ].join('\n'),
      memoryPolicy: [
        'Use this Card\'s saved memory and grants only for the current assignment.',
        'Return durable-agent recommendations to Magnetic or Main for review; never mutate the saved Card system.',
      ].join('\n'),
    }),
  },
  {
    id: 'prompt_knowgraph',
    content: buildPromptTemplate({
      role: 'You are KnowGraph. Perform sourced research and maintain knowledge and provenance through Graphiti.',
      goal: 'Answer one bounded research assignment with selected web research and exact Graphiti operations, preserving useful sourced knowledge for later work.',
      constraints: [
        'Research the bounded request and produce focused, independently reusable Knows directly from the evidence. Do not write one large report and slice it afterward.',
        'Keep each Know semantically complete and concise enough to reuse, with no arbitrary sentence or character limit. Separate genuinely distinct findings instead of bundling an entire research package into one Know.',
        'For every Know, include the interpretation needed to understand the finding, cite its supporting source, and explain exactly what that citation supports.',
        'Inspect supplied graph data before researching. Use an exact supplied ThinkGraph ID only through engraphis_get_memory; do not search ThinkGraph or reconstruct Main\'s context.',
        'Before graphiti.add_memory, inspect the complete supplied cross-graph subject directory. Reuse an exact supplied canonical name when model reasoning identifies the same subject; propose a new name only for a genuinely distinct subject. Never copy a ThinkGraph record ID into KnowGraph content.',
        'Treat a deliberately supplied Think as research framing or a question to investigate, never as evidence; only sourced research may become Know.',
        'Preserve sources, URLs, dates, entities, relationships, contradictions, Graphiti record IDs, and uncertainty. Write only useful source-backed findings and never invent sources, graph writes, or tool results.',
        'When bounded research produces useful verified findings, persist each focused finding through graphiti.add_memory before answering so Graphiti performs its established episode, entity, relationship, provenance, and time handling.',
        'Supply an explicit episode UUID when writing. Treat add_memory as queued until exact Graphiti readback verifies the episode and its entities/facts; never describe queue acceptance as persisted completion.',
        'The authenticated runtime supplies the current project Graphiti scope. Creating the first sourced episode in a clean KnowGraph does not require a preexisting node, edge, target Card, or selected graph reference. Use graphiti.add_memory rather than graphiti.add_triplet for sourced research intake.',
        'Do not use CBM or become a coding worker. Do not initiate another saved Card, create recursive workers, or execute Magnetic.',
        'Use card.load_graph_references only to hand exact persisted graph references to another saved Card after research; it does not create another input format or execute that Card. Builder alone stages Magnetic instructions.',
      ].join('\n'),
      ioSchema: [
        'Input: one bounded research assignment plus deliberately selected context and graph references.',
        'Output: exact cited Graphiti episode/entity/fact and saga references with evidence, uncertainty, and blockers; add a concise synthesis only when the requester needs one, otherwise return the bounded references for the calling Card to use.',
      ].join('\n'),
      memoryPolicy: 'Graphiti owns durable sourced knowledge and provenance. Keep candidate links and run-specific context transient; preserve Graphiti record IDs and do not copy orchestration transcripts into the graph.',
    }),
  },
  {
    id: 'prompt_assist',
    content: buildPromptTemplate({
      role: [
        'You are Assist, a general-purpose worker.',
        'You perform tasks sent by Main or started directly by the user.',
      ].join('\n'),
      goal: [
        'Execute the assigned task using available tools and context.',
        'Return clear, actionable results to continue the workflow.',
      ].join('\n'),
      constraints: [
        'Stay within your assigned scope.',
        'Use tools appropriately and efficiently.',
        'Return results in the expected format.',
      ].join('\n'),
      ioSchema: [
        'Input: task description and context from upstream nodes.',
        'Output: task results for downstream nodes.',
      ].join('\n'),
      memoryPolicy: [
        'Use provided context and upstream inputs.',
        'Store intermediate results if needed for downstream agents.',
      ].join('\n'),
    }),
  },
  {
    id: 'prompt_worldsignals_agent',
    content: buildPromptTemplate({
      role: [
        'You are WorldSignals — a live-world intelligence analyst.',
        'WorldSignals is the real-time physical-world data substrate (markets, energy, transport, supply chains, shipping, aviation, weather, infrastructure, news, geographic events, entities). You read it through your tools and turn a FOCUSED subject into a leverage-first briefing.',
      ].join('\n'),
      goal: [
        'Investigate ONE subject of interest at a time — the one KnowGraph, Main, or the user hands you — and answer the only question that matters: how can the user leverage this?',
        'Set watches so the subject is re-checked over time, and record durable, source-grounded findings so each briefing compounds on the last instead of starting from zero.',
      ].join('\n'),
      constraints: [
        'Targeted, not firehose: investigate the specific subject you were given. Do NOT sweep every layer or run get_telemetry / get_report / search_telemetry blindly — those are flagged anti-patterns. Use scoped tools: find_entity, correlate_entity, entities_near, brief_area, what_changed (scoped), search_news, and the market/filing tools.',
        'A full world sweep is allowed ONLY when the user explicitly asks for one.',
        'Recurring watch, not polling: register add_watch (via worldsignals.command) on the specific signals for this subject, then drain results with worldsignals.poll on later runs. Re-brief only when something material changed.',
        'Use only your real granted tools. Never invent a data source. If a needed signal is not covered by your tools, say so plainly.',
        'Every claim cites which tool/command and which WorldSignals layer produced it. No source, no claim.',
      ].join('\n'),
      ioSchema: [
        'Input: a focused subject of interest (entity, area, market, theme) from KnowGraph, Main, or the user — plus any prior findings for that subject.',
        'Output: a leverage-first briefing on that subject, in this order:',
        '1. Leverageable Ideas — 3-5, each with: thesis, instrument/sector/geography, why now, horizon (days/weeks/months), catalyst(s) to watch, invalidation criteria, confidence (High/Medium/Low).',
        '2. What Changed — the material deltas since the last briefing on this subject (from what_changed / drained watches).',
        '3. Pattern & Correlation — non-obvious cross-domain links for this subject (e.g. conflict+energy+inflation, sanctions+logistics, weather+shipping+supply chain); whether each is strengthening, stable, or fading, and what would invalidate it.',
        '4. Decision Board — best long, best hedge, best watchlist item, biggest unresolved question, what to monitor in the next 24-72h.',
        '5. Watches Set — the add_watch triggers you registered for this subject so it is re-checked.',
        'Then append ONE JSON object with graphWriteProposals for the durable findings, each: {"target":"KnowGraph","operation":"upsert_node|upsert_edge|annotate_node|flag_uncertainty","confidence":0.0,"reason":"plain reason","payload":{...,"source":"<tool/command + layer>","observedAt":"<iso>"}}',
      ].join('\n'),
      memoryPolicy: [
        'Durable knowledge lives in KnowGraph, reached only through graphWriteProposals — you never write graphs directly. KnowGraph or Main reviews and promotes them.',
        'A KnowGraph proposal REQUIRES source + evidence in its payload (which WorldSignals command/layer, when observed). Findings without provenance are not proposed.',
        'Read prior findings for this subject before briefing so Pattern & Correlation is grounded in accumulated evidence, not one-shot guesses. This is what makes the briefing sharper every cycle.',
      ].join('\n'),
    }),
  },
  {
    id: 'prompt_trading_workbench',
    content: buildPromptTemplate({
      role: [
        'You are the saved Trading Card. You run through your own Hermes profile and durable session; Magnetic may coordinate you as an outer worker but never replaces your runtime.',
        'Lumibot is deterministic Python trading machinery below you. It is not your agent runtime and it never decides semantic intent.',
      ].join('\n'),
      goal: [
        'Turn one structured trade assignment into a durable paper Trade Job, monitor it through deterministic market and risk rails, and journal only typed decisions: WAIT, ENTER, HOLD, REDUCE, EXIT, PAUSE, or FAIL_SAFE.',
      ].join('\n'),
      constraints: [
        'Paper trading only. Never call or propose a live broker endpoint. Order submission remains blocked until the deterministic broker and risk boundary is separately approved.',
        'Never invent a symbol, side, budget, quantity, entry, exit, stop, invalidation, expiry, horizon, order type, or data requirement. If any required term is absent or contradictory, return PAUSE or FAIL_SAFE with the missing fields.',
        'Validate every structured assignment and decision through the granted trading tools. A model decision is evidence, not an order.',
        'When targeted research or a Signal Packet is needed, return the exact request to Main or the current Magnetic task. Do not invoke another saved Card or call copied WorldSignals tools directly.',
        'Do not manually poll on a timer. The deterministic engine owns schedules, staleness, idempotency, reconciliation, replay, and backtesting.',
      ].join('\n'),
      ioSchema: [
        'Input: one structured trade assignment from Main or an approved Magnetic task. Required plan fields: instrument, assetClass, allowedDirections, budgetCeilingUsd, maxLossUsd, expectedRiskReward, entryConditions, exitConditions, stopConditions, invalidationConditions, horizon, expiresAt, allowedOrderTypes, dataRequirements, executionPolicy, and origin.',
        'Output: one typed decision object with action (WAIT|ENTER|HOLD|REDUCE|EXIT|PAUSE|FAIL_SAFE), tradeJobId, rationale, confidence, evidence references, observedAt, and missingTerms. Keep executionRequested=false until the separately approved broker boundary exists.',
      ].join('\n'),
      memoryPolicy: [
        'Use Hermes profile memory and session continuity for preferences, post-trade lessons, and bounded strategy context. Durable Trade Job/decision truth stays in the deterministic trading store.',
        'Hermes skill learning is isolated to this profile. Keep generated skills inspectable and never promote a trading result into a skill without repeated evidence.',
      ].join('\n'),
    }),
  },
];

export const INITIAL_AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: 'template_magentic',
    name: 'Magnetic',
    promptTemplate: 'prompt_magentic',
    model: MAGENTIC_ONE_DEFAULT_MODEL_KEY,
    provider: MAGENTIC_ONE_DEFAULT_PROVIDER,
    temperature: 0.2,
    maxTokens: 1200,
    tools: [],
  },
  {
    id: 'template_main_chat',
    name: 'Main',
    promptTemplate: 'prompt_main_chat',
    model: MAIN_CARD_MODEL_KEY,
    provider: DEFAULT_CARD_PROVIDER,
    temperature: 0.2,
    maxTokens: 1200,
    tools: [],
  },
  {
    id: 'template_assist',
    name: 'Assist',
    promptTemplate: 'prompt_assist',
    model: DEFAULT_CARD_MODEL_KEY,
    provider: DEFAULT_CARD_PROVIDER,
    temperature: 0.2,
    maxTokens: 1200,
    tools: [],
  },
  {
    id: 'template_team',
    name: 'Team',
    promptTemplate: 'prompt_team',
    model: TEAM_CARD_MODEL_KEY,
    provider: DEFAULT_CARD_PROVIDER,
    temperature: 0.2,
    maxTokens: 1400,
    tools: [...TEAM_CARD_TOOLS],
  },
  {
    id: 'template_thinkgraph',
    name: 'ThinkGraph',
    promptTemplate: 'prompt_thinkgraph',
    model: DEFAULT_CARD_MODEL_KEY,
    provider: DEFAULT_CARD_PROVIDER,
    temperature: 0.2,
    maxTokens: 1400,
    tools: [...THINKGRAPH_CARD_TOOLS],
  },
  {
    id: 'template_knowgraph',
    name: 'KnowGraph',
    promptTemplate: 'prompt_knowgraph',
    model: DEFAULT_CARD_MODEL_KEY,
    provider: DEFAULT_CARD_PROVIDER,
    temperature: 0.2,
    maxTokens: 1400,
    tools: [],
  },
  {
    id: 'template_worldsignals_agent',
    name: 'WorldSignals',
    promptTemplate: 'prompt_worldsignals_agent',
    model: DEFAULT_CARD_MODEL_KEY,
    provider: DEFAULT_CARD_PROVIDER,
    temperature: 0.2,
    maxTokens: 800,
    tools: [],
  },
  {
    id: 'template_trading_workbench',
    name: 'Trading',
    promptTemplate: 'prompt_trading_workbench',
    model: DEFAULT_CARD_MODEL_KEY,
    provider: DEFAULT_CARD_PROVIDER,
    temperature: 0.2,
    maxTokens: 800,
    tools: [
      'get_market_snapshot',
      'get_historical_bars',
      'get_paper_account_readiness',
      'trading.get_state',
      'trading.accept_assignment',
      'trading.record_decision',
    ],
  },
];

export const INITIAL_DECK: DeckDocument = {
  id: 'deck_builder',
  name: 'Agent Card Deck',
  promptTemplates: cloneDeckDocument(INITIAL_PROMPT_TEMPLATES),
  version: 10,
  nodes: [
    {
      // The Main front-door card. Its saved prompt/model/tools are
      // materialized before the repo-owned Hermes Gateway accepts a turn.
      id: 'card_main_chat',
      kind: 'agent',
      templateId: 'template_main_chat',
      prompt:
        INITIAL_PROMPT_TEMPLATES.find(
          (template) => template.id === 'prompt_main_chat',
        )?.content || '',
      runtime: { kind: 'hermes', mode: 'main', profile: 'main' },
      // Main's tools are role-filtered before the Python MCP host exposes them.
      // No ordinary web search is granted.
      runtimeOptions: {
        subagentType: 'none',
        provider: DEFAULT_CARD_PROVIDER,
        accessMode: 'chatgpt-account',
        modelKey: MAIN_CARD_MODEL_KEY,
        providerModelId: MAIN_CARD_MODEL_KEY,
        openaiRuntime: 'codex_app_server',
        subagentModel: { ...DEFAULT_HERMES_SUBAGENT_MODEL },
        tools: [...MAIN_CARD_TOOLS],
      },
      parentGraphId: null,
      title: 'Main',
      subtitle: 'Persistent conversation front door',
      position: { x: -24, y: -24 },
      status: 'ready',
    },
    {
      id: BUILDER_CARD_ID,
      kind: 'agent',
      templateId: 'template_assist',
      prompt:
        INITIAL_PROMPT_TEMPLATES.find(
          (template) => template.id === 'prompt_builder',
        )?.content || '',
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'builder' },
      runtimeOptions: {
        subagentType: 'none',
        provider: DEFAULT_CARD_PROVIDER,
        accessMode: 'chatgpt-account',
        modelKey: BUILDER_CARD_MODEL_KEY,
        providerModelId: BUILDER_CARD_MODEL_KEY,
        openaiRuntime: 'codex_app_server',
        subagentModel: { ...DEFAULT_HERMES_SUBAGENT_MODEL },
        tools: [...BUILDER_CARD_TOOLS],
        skills: ['agent-builder-inspection'],
        toolsets: ['web', 'terminal', 'file', 'browser', 'vision', 'code_execution'],
      },
      parentGraphId: null,
      title: 'Builder',
      subtitle: 'Prompts, agents, apps, and supporting code',
      position: { x: 360, y: -80 },
      status: 'ready',
    },
    {
      id: 'card_thinkgraph',
      kind: 'agent',
      templateId: 'template_thinkgraph',
      prompt:
        INITIAL_PROMPT_TEMPLATES.find(
          (template) => template.id === 'prompt_thinkgraph',
        )?.content || '',
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'thinkgraph' },
      runtimeOptions: {
        subagentType: 'none',
        subagentModel: { ...DEFAULT_HERMES_SUBAGENT_MODEL },
        tools: [...THINKGRAPH_CARD_TOOLS],
        modelKey: DEFAULT_CARD_MODEL_KEY,
        providerModelId: DEFAULT_CARD_MODEL_KEY,
        provider: DEFAULT_CARD_PROVIDER,
        accessMode: 'chatgpt-account',
        openaiRuntime: 'codex_app_server',
        reasoningEffort: 'low',
      },
      parentGraphId: null,
      title: 'ThinkGraph',
      subtitle: 'Project memory',
      position: { x: -260, y: 120 },
      status: 'ready',
    },
    {
      id: 'card_magentic',
      kind: 'agent',
      templateId: 'template_magentic',
      prompt:
        INITIAL_PROMPT_TEMPLATES.find(
          (template) => template.id === 'prompt_magentic',
        )?.content || '',
      runtime: { kind: 'hermes', mode: 'magentic_one', profile: 'card_magentic' },
      runtimeOptions: {
        subagentType: 'none',
        provider: MAGENTIC_ONE_DEFAULT_PROVIDER,
        accessMode: 'chatgpt-account',
        modelKey: MAGENTIC_ONE_DEFAULT_MODEL_KEY,
        maxTurns: 2,
      },
      parentGraphId: null,
      title: 'Magnetic',
      subtitle: 'Tasks',
      position: { x: 140, y: 120 },
      status: 'ready',
    },
    {
      id: 'card_team',
      kind: 'agent',
      templateId: 'template_team',
      prompt:
        INITIAL_PROMPT_TEMPLATES.find(
          (template) => template.id === 'prompt_team',
        )?.content || '',
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'team' },
      runtimeOptions: {
        provider: DEFAULT_CARD_PROVIDER,
        accessMode: 'chatgpt-account',
        modelKey: TEAM_CARD_MODEL_KEY,
        providerModelId: TEAM_CARD_MODEL_KEY,
        openaiRuntime: 'codex_app_server',
        subagentModel: { ...DEFAULT_HERMES_SUBAGENT_MODEL },
        tools: [...TEAM_CARD_TOOLS],
        skills: ['grounded-citations'],
        toolsets: ['web', 'terminal', 'file', 'browser', 'vision', 'code_execution'],
      },
      parentGraphId: null,
      title: 'Team',
      subtitle: 'Wildcard',
      position: { x: 600, y: 340 },
      status: 'ready',
    },
    {
      id: 'card_knowgraph',
      kind: 'agent',
      templateId: 'template_knowgraph',
      prompt:
        INITIAL_PROMPT_TEMPLATES.find(
          (template) => template.id === 'prompt_knowgraph',
        )?.content || '',
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'knowgraph' },
      runtimeOptions: {
        subagentType: 'none',
        subagentModel: { ...DEFAULT_HERMES_SUBAGENT_MODEL },
        tools: [...KNOWGRAPH_CARD_TOOLS],
        skills: ['grounded-citations'],
        toolsets: ['web'],
        modelKey: DEFAULT_CARD_MODEL_KEY,
        providerModelId: DEFAULT_CARD_MODEL_KEY,
        provider: DEFAULT_CARD_PROVIDER,
        accessMode: 'chatgpt-account',
        openaiRuntime: 'codex_app_server',
      },
      parentGraphId: null,
      title: 'KnowGraph',
      subtitle: 'Planning, memory, and KnowGraph research',
      position: { x: 260, y: 480 },
      status: 'ready',
    },
    {
      id: 'card_trading_workbench',
      kind: 'agent',
      templateId: 'template_trading_workbench',
      prompt:
        INITIAL_PROMPT_TEMPLATES.find(
          (template) => template.id === 'prompt_trading_workbench',
        )?.content || '',
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'trading' },
      runtimeOptions: {
        subagentModel: { ...DEFAULT_HERMES_SUBAGENT_MODEL },
        tools: [
          'get_market_snapshot',
          'get_historical_bars',
          'get_paper_account_readiness',
          'trading.get_state',
          'trading.accept_assignment',
          'trading.record_decision',
        ],
        skills: ['grounded-citations'],
        configuration: {
          schemaVersion: 'trading.card.v1',
          trading: {
            paperOnly: true,
            executionApproved: false,
            paperBudgetUsd: 0,
            allocationPerJobPercent: 0,
            maxConcurrentJobs: 3,
            maxOpenPositions: 0,
            maxPlanLossPercent: 0,
            maxDailyLossPercent: 0,
            maxPortfolioDrawdownPercent: 0,
            defaultStopLossPercent: 0,
            minimumConfidencePercent: 70,
            minimumRiskReward: 2,
            evaluationCadenceSeconds: 60,
            heartbeatSeconds: 60,
            failSafeCooldownMinutes: 60,
            staleDataSeconds: 90,
            defaultTimeframe: '5Min',
            chartWindowBars: 72,
            compactChartHeightPx: 116,
            brokerConnectionRef: 'alpaca-paper',
            marketSession: 'regular',
            strategyParameters: {},
          },
        },
        subsystems: [
          {
            id: 'lumibot',
            label: 'LumiBot',
            adapter: {
              kind: 'python',
              contractVersion: 'card-subsystem.v1',
              capabilities: ['state', 'events', 'commands', 'artifacts', 'readiness'],
            },
            cardTab: { enabled: true },
            configurationSchema: 'trading.card.v1',
          },
        ],
        modelKey: DEFAULT_CARD_MODEL_KEY,
        providerModelId: DEFAULT_CARD_MODEL_KEY,
        provider: DEFAULT_CARD_PROVIDER,
        accessMode: 'chatgpt-account',
        openaiRuntime: 'codex_app_server',
      },
      parentGraphId: 'workbench_trading',
      title: 'Trading',
      subtitle: 'Hermes paper-trading decisions and deterministic Trade Jobs',
      position: { x: 520, y: 140 },
      status: 'ready',
    },
    {
      id: 'card_worldsignals_agent',
      kind: 'agent',
      templateId: 'template_worldsignals_agent',
      prompt:
        INITIAL_PROMPT_TEMPLATES.find(
          (template) => template.id === 'prompt_worldsignals_agent',
        )?.content || '',
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'worldsignals' },
      // Real configured outside-world data sources only (EDGAR filings + Alpaca
      // market data — the registered runner tools). Never invented integrations.
      runtimeOptions: {
        subagentType: 'none',
        tools: [
          'worldsignals.capabilities',
          'worldsignals.command',
          'worldsignals.batch',
          'worldsignals.poll',
          'worldsignals.stream_events',
          'find_recent_sec_filing_signals',
          'get_market_snapshot',
          'get_historical_bars',
        ],
        modelKey: DEFAULT_CARD_MODEL_KEY,
        provider: DEFAULT_CARD_PROVIDER,
        accessMode: 'openai-api',
      },
      parentGraphId: null,
      title: 'WorldSignals',
      subtitle: 'Live-world intelligence briefings',
      position: { x: 0, y: 260 },
      status: 'ready',
    },
  ],
  // The two independent connection networks (explicit type + handle semantics;
  // color is presentation only):
  //   flow             ORANGE  Main bot-team authority
  //   magentic_option  BLUE    Magnetic task-ledger worker availability
  edges: [
    { id: 'edge_main_chat_agent_builder', source: 'card_main_chat', target: 'builder', edgeType: 'flow' },
    { id: 'edge_worldsignals_magentic_bus', source: 'card_worldsignals_agent', target: 'card_magentic', targetHandle: 'bus-in-3', edgeType: 'magentic_option' },
    { id: 'edge_trading_magentic_bus', source: 'card_magentic', sourceHandle: 'bus-out-4', target: 'card_trading_workbench', edgeType: 'magentic_option' },
    { id: 'edge_team_magentic_bus', source: 'card_team', target: 'card_magentic', targetHandle: 'bus-in-5', edgeType: 'magentic_option' },
  ],
};

export const DEFAULT_PROJECT_DECK_ID = INITIAL_DECK.id;
