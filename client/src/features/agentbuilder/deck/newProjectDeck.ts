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
  DEFAULT_WORKSPACE_ROOT,
  HERMES_CARD_TOOLS,
  CODER_CONTROLLER_TOOLS,
  MAIN_CHAT_CONTROLLER_TOOLS,
  MAGENTIC_ONE_DEFAULT_MODEL_KEY,
  MAGENTIC_ONE_DEFAULT_PROVIDER,
} from './deckPrimitives';

function buildPromptTemplate(parts: {
  role: string;
  goal: string;
  constraints: string;
  ioSchema: string;
  memoryPolicy: string;
}): string {
  return `# LIQUIDAITY_PROMPT_V1
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
        'You are Magentic-One, the team orchestrator for the visible Agent Canvas.',
      ].join('\n'),
      goal: [
        'Execute the approved task with the real blue-connected worker roster.',
        'Plan the team decomposition natively and return real worker evidence.',
      ].join('\n'),
      constraints: [
        'Use only the approved prompt and workers actually connected to the bus.',
        'Do not invent graph agents, hidden workers, tools, or graph writes.',
        'Do not change Main Chat, Kanban, or user approval authority.',
      ].join('\n'),
      ioSchema: [
        'Input: the approved task plus the real connected worker roster.',
        'Output: a concise final result with worker evidence, uncertainty, and blockers.',
      ].join('\n'),
      memoryPolicy: [
        'magentic_option is direction-agnostic Magentic-One membership/option.',
        'flow is directed execution/sequence.',
        'Do not rewrite user canvas wiring.',
        'Active Skills: clarify_intent, route_by_graph_state, preserve_human_approval, explain_current_state, avoid_worker_job_leakage',
      ].join('\n'),
    }),
  },
  {
    id: 'prompt_main_chat',
    content: [
      'You are Main Chat, the project principal and only user-facing voice, running in one persistent account-authenticated session.',
      'Own the conversation: reason with the user, ask useful clarifying questions, discuss options and tradeoffs, and answer directly.',
      '',
      'Your working context is the current project conversation, your persistent Hermes memory, and the granted ThinkGraph/KnowGraph MCP tools. There is no replacement graph API and no ordinary web search.',
      'Use native Hermes delegate_task for bounded internal Coder and helper work. Each child has an isolated context, so pass an explicit goal and all required context; consume its returned summary in this Main conversation.',
      'Use the helper to prepare the Mag One assignment, relevant graph references, and worker constraints. Then use Coder to write the exact IDF/IDD-compliant document from that preparation.',
      'Main reviews the exact IDF, presents it for user approval, and remains the only internal role allowed to submit it to Mag One.',
      'Invoke Coder for bounded code work as needed and require a real CoderReport.',
      'The runtime supplies trusted saved-card and run identity. Never invent a card result, graph write, source, code change, or tool execution.',
      '',
      'Start Magentic-One only after explicit user approval of the exact run instruction. The saved bus topology supplies workers; never invent a roster.',
      'For Magentic-One, pass only the approved exact IDF through the official MCP run_mag_one seam. Mag One never receives the whole Hermes conversation or controls Hermes subagents.',
      'After Magentic-One, reconcile only its native result and referenced native IDs when intentional memory/KnowGraph work is useful. Never dump raw orchestration transcripts into memory.',
      'A rejected transient invocation or missing native result fails closed. Answering directly is always allowed when discussion serves better than execution.',
    ].join('\n'),
  },
  {
    id: 'prompt_coder',
    content: buildPromptTemplate({
      role: [
        'You are Coder, the saved project code worker.',
      ].join('\n'),
      goal: [
        'Execute the exact bounded IDF assignment using the granted project-scoped file, terminal, patch, and Codebase Memory tools.',
        'Inspect before editing, preserve unrelated work, run proportional proof, and return one truthful CoderReport.',
      ].join('\n'),
      constraints: [
        'Work only inside the configured project root and the assignment scope.',
        'Use Codebase Memory first for code structure, then direct-read the exact current source.',
        'Require approval for destructive, external, credential, provider, Git-mutation, or otherwise irreversible actions.',
        'Do not create hidden agents, use native delegate_task, control Mag One, invent results, or fall back to another runtime/provider.',
        'Use only tools granted on this saved Card. Missing authority fails honestly.',
      ].join('\n'),
      ioSchema: [
        'Input: one exact transient IDF with the saved Coder Card context and bounded assignment.',
        'Output: one CoderReport stating changes, proof, regressions, blockers, and remaining unknowns.',
      ].join('\n'),
      memoryPolicy: [
        'Profile memory may hold explicitly saved working preferences or facts only.',
        'Do not copy full conversations, Card prompts, IDFs, ThinkGraph, KnowGraph, or CodeGraph into profile memory.',
      ].join('\n'),
    }),
  },
  {
    id: 'prompt_hermes_steward',
    content: buildPromptTemplate({
      role: [
        'You are the saved Hermes steward and persistent planning, memory, and KnowGraph helper for Main.',
      ].join('\n'),
      goal: [
        'Assist Main with progressive KnowGraph/Graphiti research and run preparation using your saved card instructions, memory scope, skills, and grants.',
        'Before Magentic-One, inspect the connected worker capabilities and help Main refine one exact transient mission for review.',
        'After Magentic-One, inspect only the supplied native result and references, reconcile useful sourced outcomes intentionally, and return concise continuation context to Main.',
      ].join('\n'),
      constraints: [
        'Use only the capabilities saved on this card. Do not use ordinary web search.',
        'Do not use a repository-writing terminal when operating as the planning and KnowGraph helper.',
        'Prepare bounded Mag One assignment context for Main; Coder writes the exact IDF and Main owns review, approval, and dispatch.',
        'Progressive research starts from sourced KnowGraph records and preserves provenance.',
        'Do not invent sources, graph writes, tool results, worker results, or Kanban activity.',
        'Your direct execution remains one real persistent saved-card session. Kanban is an execution mode on an ordinary card, not your identity.',
        'You may persist exact proposed Mag One instructions, but Main alone presents, edits, approves, and runs the transient Magentic-One mission.',
        'Do not indiscriminately copy Magentic-One transcripts into memory or KnowGraph.',
      ].join('\n'),
      ioSchema: [
        'Input: one bounded assignment from the user, Main, or an approved orchestrator.',
        'Output: one normalized specialist result with evidence, uncertainty, blockers, and native result references when applicable.',
      ].join('\n'),
      memoryPolicy: [
        'This card stable ID owns its isolated runtime session, memory state, and materialized skills.',
        'KnowGraph remains the sourced knowledge authority; preserve native IDs and provenance.',
      ].join('\n'),
    }),
  },
  {
    id: 'prompt_assist',
    content: buildPromptTemplate({
      role: [
        'You are an Assist Agent, a general-purpose worker agent.',
        'You perform tasks as directed by the orchestrator or flow.',
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
        'You are the WorldSignals Agent — a live-world intelligence analyst.',
        'WorldSignals is the real-time physical-world data substrate (markets, energy, transport, supply chains, shipping, aviation, weather, infrastructure, news, geographic events, entities). You read it through your tools and turn a FOCUSED subject into a leverage-first briefing.',
      ].join('\n'),
      goal: [
        'Investigate ONE subject of interest at a time — the one Kanban, Main, or the user hands you — and answer the only question that matters: how can the user leverage this?',
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
        'Input: a focused subject of interest (entity, area, market, theme) from Kanban, Main, or the user — plus any prior findings for that subject.',
        'Output: a leverage-first briefing on that subject, in this order:',
        '1. Leverageable Ideas — 3-5, each with: thesis, instrument/sector/geography, why now, horizon (days/weeks/months), catalyst(s) to watch, invalidation criteria, confidence (High/Medium/Low).',
        '2. What Changed — the material deltas since the last briefing on this subject (from what_changed / drained watches).',
        '3. Pattern & Correlation — non-obvious cross-domain links for this subject (e.g. conflict+energy+inflation, sanctions+logistics, weather+shipping+supply chain); whether each is strengthening, stable, or fading, and what would invalidate it.',
        '4. Decision Board — best long, best hedge, best watchlist item, biggest unresolved question, what to monitor in the next 24-72h.',
        '5. Watches Set — the add_watch triggers you registered for this subject so it is re-checked.',
        'Then append ONE JSON object with graphWriteProposals for the durable findings, each: {"target":"KnowGraph","operation":"upsert_node|upsert_edge|annotate_node|flag_uncertainty","confidence":0.0,"reason":"plain reason","payload":{...,"source":"<tool/command + layer>","observedAt":"<iso>"}}',
      ].join('\n'),
      memoryPolicy: [
        'Durable knowledge lives in KnowGraph, reached only through graphWriteProposals — you never write graphs directly. Kanban reviews and promotes them.',
        'A KnowGraph proposal REQUIRES source + evidence in its payload (which WorldSignals command/layer, when observed). Findings without provenance are not proposed.',
        'Read prior findings for this subject before briefing so Pattern & Correlation is grounded in accumulated evidence, not one-shot guesses. This is what makes the briefing sharper every cycle.',
      ].join('\n'),
    }),
  },
  {
    id: 'prompt_trading_workbench',
    content: buildPromptTemplate({
      role: [
        'You are the Trading Agent workbench card.',
        'You represent the visible trading and market analysis workspace on the board.',
      ].join('\n'),
      goal: [
        'Expose the Trading workspace as a connectable workbench capability.',
        'Keep this staged until the app-owned trading runtime and broker bridge are restored.',
      ].join('\n'),
      constraints: [
        'Do not call backend model runtime from this card.',
        'Do not imply live broker execution, order routing, or profit claims.',
      ].join('\n'),
      ioSchema: [
        'Input: user selection or future trading workbench request.',
        'Output: open or focus the Trading workspace surface.',
      ].join('\n'),
      memoryPolicy: [
        'Treat this as a visible activation stub for the future trading bridge.',
      ].join('\n'),
    }),
  },
];

export const INITIAL_AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: 'template_magentic',
    name: 'Magentic-One',
    promptTemplate: 'prompt_magentic',
    model: MAGENTIC_ONE_DEFAULT_MODEL_KEY,
    provider: MAGENTIC_ONE_DEFAULT_PROVIDER,
    temperature: 0.2,
    maxTokens: 1200,
    tools: [],
  },
  {
    id: 'template_main_chat',
    name: 'Main Chat',
    promptTemplate: 'prompt_main_chat',
    model: DEFAULT_CARD_MODEL_KEY,
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
    id: 'template_local_coder',
    name: 'Coder',
    promptTemplate: 'prompt_coder',
    model: DEFAULT_CARD_MODEL_KEY,
    provider: DEFAULT_CARD_PROVIDER,
    temperature: 0.2,
    maxTokens: 1200,
    tools: [...CODER_CONTROLLER_TOOLS],
  },
  {
    id: 'template_hermes_steward',
    name: 'Kanban',
    promptTemplate: 'prompt_hermes_steward',
    model: DEFAULT_CARD_MODEL_KEY,
    provider: DEFAULT_CARD_PROVIDER,
    temperature: 0.2,
    maxTokens: 1400,
    tools: [],
  },
  {
    id: 'template_worldsignals_agent',
    name: 'WorldSignals Agent',
    promptTemplate: 'prompt_worldsignals_agent',
    model: DEFAULT_CARD_MODEL_KEY,
    provider: DEFAULT_CARD_PROVIDER,
    temperature: 0.2,
    maxTokens: 800,
    tools: [],
  },
  {
    id: 'template_trading_workbench',
    name: 'Trading Agent',
    promptTemplate: 'prompt_trading_workbench',
    model: DEFAULT_CARD_MODEL_KEY,
    provider: DEFAULT_CARD_PROVIDER,
    temperature: 0.2,
    maxTokens: 800,
    tools: [],
  },
];

export const INITIAL_DECK: DeckDocument = {
  id: 'deck_builder',
  name: 'Agent Card Deck',
  workspaceRoot: DEFAULT_WORKSPACE_ROOT,
  promptTemplates: cloneDeckDocument(INITIAL_PROMPT_TEMPLATES),
  version: 7,
  nodes: [
    {
      // The Main front-door card. Its saved prompt/model/tools are
      // resolved by the one persistent repo-owned Hermes ACP adapter.
      id: 'card_main_chat',
      kind: 'agent',
      templateId: 'template_main_chat',
      prompt:
        INITIAL_PROMPT_TEMPLATES.find(
          (template) => template.id === 'prompt_main_chat',
        )?.content || '',
      runtime: { kind: 'hermes', mode: 'main', profile: 'liquidaity-main' },
      // Main's tools are role-filtered before the Python MCP host exposes them.
      // No ordinary web search is granted.
      runtimeOptions: {
        provider: DEFAULT_CARD_PROVIDER,
        accessMode: 'chatgpt-account',
        modelKey: DEFAULT_CARD_MODEL_KEY,
        tools: [...MAIN_CHAT_CONTROLLER_TOOLS],
        toolsets: ['file', 'terminal', 'delegation'],
      },
      parentGraphId: null,
      title: 'Main Chat',
      subtitle: 'Persistent conversation front door',
      position: { x: -24, y: -24 },
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
      runtime: { kind: 'autogen', mode: 'magentic_one' },
      runtimeOptions: {
        provider: MAGENTIC_ONE_DEFAULT_PROVIDER,
        accessMode: 'openrouter-api',
        modelKey: MAGENTIC_ONE_DEFAULT_MODEL_KEY,
        maxTurns: 2,
      },
      parentGraphId: null,
      title: 'Magentic-One',
      subtitle: 'Admin orchestrator / planner',
      position: { x: 140, y: 120 },
      status: 'ready',
    },
    {
      id: 'card_local_coder',
      kind: 'agent',
      templateId: 'template_local_coder',
      prompt:
        INITIAL_PROMPT_TEMPLATES.find(
          (template) => template.id === 'prompt_coder',
        )?.content || '',
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'coder' },
      runtimeOptions: {
        provider: DEFAULT_CARD_PROVIDER,
        accessMode: 'chatgpt-account',
        modelKey: DEFAULT_CARD_MODEL_KEY,
        tools: [...CODER_CONTROLLER_TOOLS],
        nativeTools: ['memory'],
        toolsets: ['file', 'terminal'],
      },
      parentGraphId: null,
      title: 'Coder',
      subtitle: 'Controlled code patch/test execution',
      position: { x: 520, y: 320 },
      status: 'ready',
    },
    {
      id: 'card_hermes_steward',
      kind: 'agent',
      templateId: 'template_hermes_steward',
      prompt:
        INITIAL_PROMPT_TEMPLATES.find(
          (template) => template.id === 'prompt_hermes_steward',
        )?.content || '',
      runtime: { kind: 'hermes', mode: 'kanban', profile: 'liquidaity-hermes-steward' },
      runtimeOptions: {
        tools: [...HERMES_CARD_TOOLS],
        modelKey: DEFAULT_CARD_MODEL_KEY,
        provider: DEFAULT_CARD_PROVIDER,
        accessMode: 'chatgpt-account',
      },
      parentGraphId: null,
      title: 'Kanban',
      subtitle: 'Board and KnowGraph research agent',
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
      runtime: { kind: 'autogen', mode: 'assistant' },
      runtimeOptions: {
        modelKey: DEFAULT_CARD_MODEL_KEY,
        provider: DEFAULT_CARD_PROVIDER,
        accessMode: 'openai-api',
      },
      parentGraphId: 'workbench_trading',
      title: 'Trading Agent',
      subtitle: 'Market workspace',
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
      runtime: { kind: 'autogen', mode: 'assistant' },
      // Real configured outside-world data sources only (EDGAR filings + Alpaca
      // market data — the registered runner tools). Never invented integrations.
      runtimeOptions: {
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
      title: 'WorldSignals Agent',
      subtitle: 'Live-world intelligence briefings',
      position: { x: 0, y: 260 },
      status: 'ready',
    },
  ],
  // The two independent connection networks (explicit type + handle semantics;
  // color is presentation only):
  //   flow             ORANGE  source parent → target native subagent
  //   magentic_option  BLUE    side worker slot on the Mag One bus
  //   magentic_control BLUE    dedicated top control input (submit final prompt)
  edges: [
    { id: 'edge_main_chat_hermes', source: 'card_main_chat', target: 'card_hermes_steward', edgeType: 'flow' },
    { id: 'edge_main_chat_coder', source: 'card_main_chat', target: 'card_local_coder', edgeType: 'flow' },
    { id: 'edge_hermes_worldsignals', source: 'card_hermes_steward', target: 'card_worldsignals_agent', edgeType: 'flow' },
    {
      id: 'edge_main_chat_magentic_control',
      source: 'card_main_chat',
      target: 'card_magentic',
      targetHandle: 'task-bus-top',
      edgeType: 'magentic_control',
    },
    { id: 'edge_worldsignals_magentic_bus', source: 'card_worldsignals_agent', target: 'card_magentic', targetHandle: 'bus-in-3', edgeType: 'magentic_option' },
  ],
};

export const BUILDER_DECK_ID = INITIAL_DECK.id;
