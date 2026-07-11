// The canonical Agent Canvas seed: prompt templates, agent templates, the
// INITIAL_DECK document, and system card binding maps. Extracted verbatim
// from pages/agentbuilder.tsx (decomposition pass 2026-07-08). Persisted ids
// (card_*, template_*, prompt_*, deck_builder) are STABLE saved-deck
// identity — never rename them here.
import type {
  AgentTemplate,
  DeckDocument,
  PromptTemplate,
  RuntimeBinding,
} from '../../../types/agentgraph';
import {
  cloneDeckDocument,
  DEFAULT_CARD_MODEL_KEY,
  DEFAULT_CARD_PROVIDER,
  DEFAULT_WORKSPACE_ROOT,
  LOCAL_CODER_CONTROLLER_MODEL_KEY,
  LOCAL_CODER_CONTROLLER_PROVIDER,
  LOCAL_CODER_CONTROLLER_TOOLS,
  MAGENTIC_ONE_DEFAULT_MODEL_KEY,
  MAGENTIC_ONE_DEFAULT_PROVIDER,
} from './deckPrimitives';

export function buildSeedPromptTemplate(parts: {
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

export function buildSpecialistGraphProposalPrompt(parts: {
  role: string;
  goal: string;
  proposalTarget: 'CodeGraph' | 'ThinkGraph' | 'KnowGraph' | 'PlanSurface';
  proposalGuidance: string;
}): string {
  return buildSeedPromptTemplate({
    role: parts.role,
    goal: parts.goal,
    constraints: [
      'You are a LiquidAIty-native Agent Canvas specialist, not a separate plugin or dashboard.',
      'Magentic-One is the conductor. Stay within the assigned card role and return useful output to the visible deck runtime.',
      'Do not mutate CodeGraph, ThinkGraph, KnowGraph, Plan Surface, Apache AGE, Neo4j, files, or database state.',
      'When graph or plan changes would be useful, return proposals only.',
      'Do not claim a proposal has been written or persisted.',
    ].join('\n'),
    ioSchema: [
      'Output: concise analysis for the user.',
      'When useful, append one JSON object that contains graphWriteProposals.',
      'Each graphWriteProposals item must use this exact shape:',
      '{"target":"CodeGraph|ThinkGraph|KnowGraph|PlanSurface","operation":"upsert_node|upsert_edge|annotate_node|link_plan_step|create_plan_step|flag_uncertainty","confidence":0.0,"reason":"plain reason","payload":{}}',
      `Default proposal target: ${parts.proposalTarget}.`,
      parts.proposalGuidance,
    ].join('\n'),
    memoryPolicy: [
      'Use only current input, visible deck context, and explicitly provided source snippets or graph snapshots.',
      'Treat model-generated structure as provisional unless source-grounded evidence is included in the payload.',
      'KnowGraph proposals require source/evidence fields in payload; otherwise target ThinkGraph.',
    ].join('\n'),
  });
}

export const INITIAL_PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: 'prompt_magentic',
    content: buildSeedPromptTemplate({
      role: [
        'You are Magentic-One, the conversational orchestrator/router for the visible AgentCanvas.',
      ].join('\n'),
      goal: [
        'chat naturally with the user',
        'understand the active user request',
        'route downstream agents/workflows when useful',
        'explain current state and next step',
        'preserve human-in-loop control',
        'use Plan Agent for real runtime proposals; the Plan projects authoritative sources and provenance-backed proposals',
      ].join('\n'),
      constraints: [
        'Do not dump raw JSON in normal chat unless in debug mode.',
        'Do not perform ThinkGraph extraction yourself.',
        'Do not output provisional entities/relationships as your own answer unless explicitly summarizing ThinkGraph Agent output.',
        'Do not perform Research Agent’s job.',
        'Do not perform KnowGraph Agent’s job.',
        'Do not run research before ThinkGraph has earned a research offer and user approval exists.',
        'Do not treat ThinkGraph reasoning as facts.',
        'Do not silently write KnowGraph.',
      ].join('\n'),
      ioSchema: [
        'Baseline research behavior:',
        '1. Start with chat.',
        '2. Answer naturally. Do not output raw JSON.',
        '3. After a meaningful user/assistant pair, route downstream to ThinkGraph Agent.',
        '4. ThinkGraph Agent reads the completed chat pair and updates the visible ThinkGraph Reveal.',
        '5. If ThinkGraph is sparse, ask the user to clarify.',
        '6. If ThinkGraph is rich enough, offer Plan Research.',
        '7. If user asks to Plan Research, route to Plan Agent.',
        '8. A real Plan Agent proposal may join the Plan only with runtime provenance.',
        '9. Wait for human approval.',
        '10. Only after approval may Research Agent run.',
        '11. Only after source-backed evidence exists may KnowGraph Agent write evidence/gaps.',
        '12. After KnowGraph is populated, answer using separated ThinkGraph and KnowGraph context.',
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
    // The Harness driver prompt. This is the ONE LiquidAIty-specific instruction
    // layer appended (never replacing) the vendored base chat prompt — see
    // grpcChatClient.resolveMainChatSystemPrompt. Kept in sync with the backend
    // MAIN_CHAT_PROMPT_TEMPLATE (apps/backend/src/decks/mainChatControllerCard.ts).
    content: [
      'You are Main Chat — the project principal and the only user-facing voice.',
      'Own the persistent project conversation: reason with the user, ask real clarifying questions, discuss options and tradeoffs, and answer directly. You are never a relay for another agent.',
      '',
      'Your working context: read-only graph tools (ThinkGraph project reasoning, KnowGraph grounded knowledge, CodeGraph repository reality), canvas/agent metadata, and the current job folder under coder-workspace/handoff/<jobId>/.',
      'Your direct subagents are the cards orange-connected to you on the canvas (native Agent invocations). Invoke Hermes — your background context/planning steward — when a turn benefits from deeper preparation: memory enrichment, research shaping, draft work. Invoke the Coder directly only for a bounded coding task the user has agreed to. Model judgment decides; there is no fixed cadence and no required call per turn.',
      '',
      'Hermes prepares useful working files under handoff/<jobId>/ (draft.md, context.md, sources.md, screenshots/documents, code notes, and other bounded artifacts). Review, question, edit, remove, or replace those files before execution. The final prompt.md is written last and is the only semantic start signal.',
      'Execution happens ONLY when the user explicitly asks to run the team in this conversation. Then finalize the job folder, write prompt.md last, and call mcp__liquidaity__run_mag_one with jobId, projectId, and deckId. The backend resolves the live worker roster from blue side edges — never type a roster by hand. Mag One reads prompt.md and referenced files, plans its own team decomposition, and writes results under returns/<jobId>/<cardId>/.',
      '',
      'Hard rules:',
      '- Never claim a run, graph write, code change, or tool execution that a real returned result does not show. No result → say it failed or is blocked, and why.',
      '- Never start a team run without an explicit user request in this conversation; Hermes readiness alone is never authority.',
      '- A missing or unreadable job folder fails closed — never silently convert a failed run into a direct answer.',
      '- Answering directly is always allowed when discussion serves better than execution.',
    ].join('\n'),
  },
  {
    id: 'prompt_thinkgraph_agent',
    // No ThinkGraph semantic prompt is authored here. The persisted saved
    // ThinkGraph card prompt (project database) is the ONE ThinkGraph
    // semantic instruction source; a new/blank card starts with an empty
    // prompt, never a TypeScript-injected default.
    content: '',
  },
  {
    id: 'prompt_codegraph_agent',
    content: buildSeedPromptTemplate({
      role: [
        'You are the CodeGraph Agent, a graph-specialist agent for structural code memory.',
        'You work only with CodeGraph, which stores files, symbols, routes, libraries, subsystem boundaries, and dependency/call structure.',
      ].join('\n'),
      goal: [
        'Extract and manage code structure: what does what, what library it uses, what part of the product this belongs to, what depends on what.',
        'CodeGraph is read second by the planner to understand what code areas, subsystems, files, symbols, and routes matter.',
      ].join('\n'),
      constraints: [
        'CodeGraph is structural code memory, separate from ThinkGraph and KnowGraph.',
        'Preserve Codebase-Memory-style usefulness for AI.',
        'Local-first storage is acceptable.',
        'Do not merge CodeGraph with other graph types.',
      ].join('\n'),
      ioSchema: [
        'Input: code analysis request or codebase context.',
        'Output: files, symbols, routes, libraries, subsystem boundaries, dependencies, call structure.',
      ].join('\n'),
      memoryPolicy: [
        'Use current input and existing CodeGraph context.',
        'CodeGraph stores: files, symbols, routes, libraries, subsystems, dependencies, call graphs.',
      ].join('\n'),
    }),
  },
  {
    id: 'prompt_research_agent',
    content: buildSeedPromptTemplate({
      role: [
        'You are the Research Agent.',
      ].join('\n'),
      goal: [
        'Gather source-backed evidence for and against the current research question.',
      ].join('\n'),
      constraints: [
        'You have NO tools: no web/search access and no direct graph access.',
        'Evidence arrives from the KnowGraph Agent through the orchestrator; reason over it and label findings as graph-context research.',
        'If no relevant evidence was provided, say so plainly; never invent sources or citations.',
        'Does not write KnowGraph itself.',
      ].join('\n'),
      ioSchema: [
        'Return evidence-grounded findings with source, snippet, claim, date if available, provenance — exactly as provided.',
        'Preserve each assertion\'s outcome (supported/contradicted/uncertain) and its sourceRef.',
      ].join('\n'),
      memoryPolicy: [
        'Use only the current request and the graph context supplied by the team.',
        'Active Skills: search_confirming_evidence, search_disconfirming_evidence, extract_source_claims, preserve_provenance, avoid_unsourced_claims',
      ].join('\n'),
    }),
  },
  {
    id: 'prompt_knowgraph_agent',
    content: buildSeedPromptTemplate({
      role: [
        'You are the KnowGraph Agent.',
      ].join('\n'),
      goal: [
        'Retrieve source-backed evidence/gaps/provenance for the team.',
      ].join('\n'),
      constraints: [
        'Must not store ThinkGraph reasoning as fact.',
        'Read evidence with the retrieve_knowgraph_context tool (project-scoped, read-only).',
        'No KnowGraph write path is wired yet — never claim to have written KnowGraph.',
      ].join('\n'),
      ioSchema: [
        'Input: source-backed evidence from Research Agent.',
        'Output: grounded entities, relationships, evidence summaries, citations, gaps, contradictions, and provenance.',
      ].join('\n'),
      memoryPolicy: [
        'Use current input and existing KnowGraph context.',
        'Active Skills: normalize_evidence_graph, preserve_citations, store_contradictions, store_evidence_gaps, reject_unsourced_reasoning_as_fact',
      ].join('\n'),
    }),
  },
  {
    id: 'prompt_assist',
    content: buildSeedPromptTemplate({
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
    id: 'prompt_hermes_steward',
    content: buildSeedPromptTemplate({
      role: [
        'You are Hermes — Main Chat\'s background context, planning, and memory steward.',
        'You run as a native inherited-context subagent: you receive the complete live parent conversation instead of a task prompt. You are not the user-facing voice, not the project boss, and never a Mag One worker.',
      ].join('\n'),
      goal: [
        'Make the eventual Mag One run worth running, and keep project memory compounding.',
        'Prepare and continuously improve useful working files under the current handoff/<jobId>/ folder: draft.md, context.md, sources.md, screenshots/documents, code notes, and any other bounded artifact needed for Main Chat review. Do not treat any file as the final task until Main Chat writes prompt.md last.',
        'Enrich real memory as the work deserves: read ThinkGraph with read_thinkgraph_scope and submit bounded structured updates with apply_thinkgraph_patch; query grounded knowledge with retrieve_knowgraph_context and ingest REAL source material through the canonical KnowGraph path; inspect repository reality through the CodeGraph/CBM tools exposed by the current card grants.',
        'Keep your own continuity in SQL memory with hermes_memory_read and hermes_memory_write: prior judgments, useful patterns, working-file state, and operating observations.',
        'Invoke your orange-connected direct agents with card.run_assistant_agent and that card\'s id plus one bounded task when their specialty helps; interpret their returned results yourself.',
        'Return a concise enrichment report to Main Chat: what you read, which job files you changed, real graph/memory update results, unknowns, questions, and your advisory readiness judgment.',
      ].join('\n'),
      constraints: [
        'You never write the approved prompt.md, never call run_mag_one, and never treat your own readiness as user approval — Main Chat owns review, finalization, and execution.',
        'Model judgment decides which tools a turn needs; there is no required checklist and no tool you must call every turn.',
        'Never fabricate graph data, sources, or results. KnowGraph ingestion requires real source material. A failed read or tool call is reported honestly, never papered over.',
        'Identity (projectId, deckId, conversationId, parentRunId) comes from LIQUIDAITY_RUNTIME_CONTEXT exactly — never invented.',
      ].join('\n'),
      ioSchema: [
        'Input: inherited live parent conversation (no Agent prompt), plus LIQUIDAITY_RUNTIME_CONTEXT identity.',
        'Output: a concise report — context read, changed job files, graph/memory update ids from real tool results, unknowns, questions, readiness advice. Never a packet object.',
      ].join('\n'),
      memoryPolicy: [
        'ThinkGraph = shared evolving project reasoning (objectives, decisions, constraints, uncertainty, questions, provenance links) — write it through structured updates only, and only what deserves to persist.',
        'KnowGraph = grounded sourced knowledge — enters only through real ingestion of real sources.',
        'SQL memory = your private continuity, separate from ThinkGraph. The job folder = the project\'s working execution files and final prompt.',
        'Return pointers and concise context; never copy whole graphs into chat.',
      ].join('\n'),
    }),
  },
  {
    id: 'prompt_plan_agent',
    content: buildSeedPromptTemplate({
      role: [
        'You are the Plan Agent.',
      ].join('\n'),
      goal: [
        'Read ThinkGraph readiness.',
        'Expose real ThinkGraph events beside provenance-backed Plan nodes.',
        'Expose graph richness / missing pieces when idea is not ready.',
        'Offer Plan Research when ThinkGraph is ready.',
        'Create research plan after user asks to plan research.',
        'Require approval before research runs.',
        'Expose approved research state and results.',
        'Expose divergence between subjective ThinkGraph and objective KnowGraph.',
      ].join('\n'),
      constraints: [
        'Do not fake local planning.',
      ].join('\n'),
      ioSchema: [
        'Input: activation proposal or planning context.',
        'Output: a visible plan/approval workspace for human review.',
      ].join('\n'),
      memoryPolicy: [
        'Keep planning visible and user-approved before graph changes are applied.',
        'Active Skills: expose_thinkgraph_events, request_approval, show_missing_slots, show_subjective_vs_objective',
      ].join('\n'),
    }),
  },
  {
    id: 'prompt_worldsignals_agent',
    content: buildSeedPromptTemplate({
      role: [
        'You are the WorldSignals Agent.',
        'You represent the WorldSignals surface as a visible system capability.',
      ].join('\n'),
      goal: [
        'Expose the WorldSignals workspace when the user activates outside-world context.',
      ].join('\n'),
      constraints: [
        'Do not call backend model runtime from this card.',
        'Use the existing WorldSignals surface for interaction.',
      ].join('\n'),
      ioSchema: [
        'Input: user selection or future WorldSignals request.',
        'Output: open or focus the WorldSignals workspace surface.',
      ].join('\n'),
      memoryPolicy: [
        'This card is a visible system gateway to the WorldSignals surface.',
      ].join('\n'),
    }),
  },
  {
    id: 'prompt_trading_workbench',
    content: buildSeedPromptTemplate({
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
    name: 'Main Chat / Harness',
    promptTemplate: 'prompt_main_chat',
    model: DEFAULT_CARD_MODEL_KEY,
    provider: DEFAULT_CARD_PROVIDER,
    temperature: 0.2,
    maxTokens: 1200,
    tools: [],
  },
  {
    id: 'template_thinkgraph_agent',
    name: 'ThinkGraph Agent',
    promptTemplate: 'prompt_thinkgraph_agent',
    model: DEFAULT_CARD_MODEL_KEY,
    provider: DEFAULT_CARD_PROVIDER,
    temperature: 0.2,
    maxTokens: 1400,
    tools: [],
  },
  {
    id: 'template_codegraph_agent',
    name: 'CodeGraph Agent',
    promptTemplate: 'prompt_codegraph_agent',
    model: DEFAULT_CARD_MODEL_KEY,
    provider: DEFAULT_CARD_PROVIDER,
    temperature: 0.2,
    maxTokens: 1400,
    tools: [],
  },
  {
    id: 'template_research_agent',
    name: 'Research Agent',
    promptTemplate: 'prompt_research_agent',
    model: DEFAULT_CARD_MODEL_KEY,
    provider: DEFAULT_CARD_PROVIDER,
    temperature: 0.2,
    maxTokens: 1400,
    tools: [],
  },
  {
    id: 'template_knowgraph_agent',
    name: 'KnowGraph Agent',
    promptTemplate: 'prompt_knowgraph_agent',
    model: DEFAULT_CARD_MODEL_KEY,
    provider: DEFAULT_CARD_PROVIDER,
    temperature: 0.2,
    maxTokens: 1400,
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
    promptTemplate: 'prompt_assist',
    model: LOCAL_CODER_CONTROLLER_MODEL_KEY,
    provider: LOCAL_CODER_CONTROLLER_PROVIDER,
    temperature: 0.2,
    maxTokens: 1200,
    tools: [...LOCAL_CODER_CONTROLLER_TOOLS],
  },
  {
    id: 'template_hermes_steward',
    name: 'Hermes',
    promptTemplate: 'prompt_hermes_steward',
    model: DEFAULT_CARD_MODEL_KEY,
    provider: DEFAULT_CARD_PROVIDER,
    temperature: 0.2,
    maxTokens: 1400,
    tools: [],
  },
  {
    id: 'template_plan_agent',
    name: 'Plan Agent',
    promptTemplate: 'prompt_plan_agent',
    model: DEFAULT_CARD_MODEL_KEY,
    provider: DEFAULT_CARD_PROVIDER,
    temperature: 0.2,
    maxTokens: 800,
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
  version: 3,
  nodes: [
    {
      // The Harness front-door card. runtimeBinding 'main_chat' is the ONLY thing
      // that matters here: grpcChatClient reads this card's saved prompt/model
      // and appends the prompt to the live Harness chat. It is visually
      // bus-connected as the front door, but never a doorway or Mag One worker
      // (runtime filters exclude main_chat).
      id: 'card_main_chat',
      kind: 'agent',
      templateId: 'template_main_chat',
      prompt:
        INITIAL_PROMPT_TEMPLATES.find(
          (template) => template.id === 'prompt_main_chat',
        )?.content || '',
      runtimeBinding: 'main_chat',
      runtimeType: 'assistant_agent',
      // Main Chat's Tools selection is its REAL harness MCP surface: read-only
      // graph access, canvas metadata, the current job folder, and Mag One control.
      // No graph writes, no ingestion, no web search by default.
      runtimeOptions: {
        provider: DEFAULT_CARD_PROVIDER,
        modelKey: DEFAULT_CARD_MODEL_KEY,
        tools: [
          'read_thinkgraph_scope',
          'retrieve_knowgraph_context',
          'codegraph_search',
          'codegraph_status',
          'canvas.inspect',
          'mag_one.describe_connected_agents',
          'run_mag_one',
          'run_coder_subagent',
        ],
      },
      parentGraphId: null,
      title: 'Main Chat / Harness',
      subtitle: 'Native Harness front door',
      position: { x: -24, y: -24 },
      status: 'ready',
      cloneConfig: { enabled: false, seeds: [] },
    },
    {
      id: 'card_magentic',
      kind: 'agent',
      templateId: 'template_magentic',
      prompt:
        INITIAL_PROMPT_TEMPLATES.find(
          (template) => template.id === 'prompt_magentic',
        )?.content || '',
      runtimeBinding: null,
      runtimeType: 'magentic_one',
      runtimeOptions: {
        executionBackend: 'python_autogen',
        provider: MAGENTIC_ONE_DEFAULT_PROVIDER,
        modelKey: MAGENTIC_ONE_DEFAULT_MODEL_KEY,
        maxTurns: 2,
        maxStalls: 1,
      },
      parentGraphId: null,
      title: 'Magentic-One',
      subtitle: 'Admin orchestrator / planner',
      position: { x: 140, y: 120 },
      status: 'ready',
      cloneConfig: { enabled: false, seeds: [] },
    },
    {
      id: 'card_research_agent',
      kind: 'agent',
      templateId: 'template_research_agent',
      prompt:
        INITIAL_PROMPT_TEMPLATES.find(
          (template) => template.id === 'prompt_research_agent',
        )?.content || '',
      runtimeBinding: 'research_agent',
      runtimeType: 'assistant_agent',
      // Bounded web-research specialist. HONEST TOOLING: the repository has no
      // real web-search/page-fetch runner tool yet, so this card carries none —
      // it must never claim internet access it lacks. Real source URLs it
      // proposes are fetched by Hermes through KnowGraph ingestion.
      runtimeOptions: {
        modelKey: 'openai/gpt-5.1-chat',
        provider: 'openrouter',
      },
      parentGraphId: null,
      title: 'Search Agent',
      subtitle: 'Web search',
      position: { x: -340, y: 140 },
      status: 'ready',
      cloneConfig: { enabled: false, seeds: [] },
    },
    {
      id: 'card_local_coder',
      kind: 'agent',
      templateId: 'template_local_coder',
      prompt:
        INITIAL_PROMPT_TEMPLATES.find(
          (template) => template.id === 'prompt_assist',
        )?.content || '',
      runtimeBinding: 'local_coder',
      runtimeType: 'local_coder',
      runtimeOptions: {
        provider: LOCAL_CODER_CONTROLLER_PROVIDER,
        modelKey: LOCAL_CODER_CONTROLLER_MODEL_KEY,
        tools: [...LOCAL_CODER_CONTROLLER_TOOLS],
      },
      parentGraphId: null,
      title: 'Coder',
      subtitle: 'Controlled code patch/test execution',
      position: { x: 520, y: 320 },
      status: 'ready',
      cloneConfig: { enabled: false, seeds: [] },
    },
    {
      id: 'card_hermes_steward',
      kind: 'agent',
      templateId: 'template_hermes_steward',
      prompt:
        INITIAL_PROMPT_TEMPLATES.find(
          (template) => template.id === 'prompt_hermes_steward',
        )?.content || '',
      runtimeBinding: 'hermes_steward',
      runtimeType: 'assistant_agent',
      // Hermes runs as Main Chat's native inherited-context subagent; its Tools
      // selection is its REAL harness MCP surface (enforced as the child agent's
      // allowed_tools). ThinkGraph write and KnowGraph ingestion go through the
      // canonical backend writers/pipeline under server-minted authority.
      runtimeOptions: {
        tools: [
          'read_thinkgraph_scope',
          'apply_thinkgraph_patch',
          'retrieve_knowgraph_context',
          'hermes_review_coder_report',
          'hermes_memory_read',
          'hermes_memory_write',
          'card.run_assistant_agent',
        ],
        modelKey: 'openai/gpt-5.1-chat',
        provider: 'openrouter',
      },
      parentGraphId: null,
      title: 'Hermes',
      subtitle: 'Context and planning steward',
      position: { x: 260, y: 480 },
      status: 'ready',
      cloneConfig: { enabled: false, seeds: [] },
    },
    {
      id: 'card_trading_workbench',
      kind: 'agent',
      templateId: 'template_trading_workbench',
      prompt:
        INITIAL_PROMPT_TEMPLATES.find(
          (template) => template.id === 'prompt_trading_workbench',
        )?.content || '',
      runtimeBinding: 'trading_agent',
      runtimeType: 'assistant_agent',
      parentGraphId: 'workbench_trading',
      title: 'Trading Agent',
      subtitle: 'Market workspace',
      position: { x: 520, y: 140 },
      status: 'ready',
      cloneConfig: { enabled: false, seeds: [] },
    },
    {
      id: 'card_worldsignals_agent',
      kind: 'agent',
      templateId: 'template_worldsignals_agent',
      prompt:
        INITIAL_PROMPT_TEMPLATES.find(
          (template) => template.id === 'prompt_worldsignals_agent',
        )?.content || '',
      runtimeBinding: 'worldsignals_agent',
      runtimeType: 'assistant_agent',
      // Real configured outside-world data sources only (EDGAR filings + Alpaca
      // market data — the registered runner tools). Never invented integrations.
      runtimeOptions: {
        tools: [
          'find_recent_sec_filing_signals',
          'get_market_snapshot',
          'get_historical_bars',
        ],
        modelKey: 'openai/gpt-5.1-chat',
        provider: 'openrouter',
      },
      parentGraphId: null,
      title: 'WorldSignals Agent',
      subtitle: 'Real time data context',
      position: { x: 0, y: 260 },
      status: 'ready',
      cloneConfig: { enabled: false, seeds: [] },
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
    { id: 'edge_hermes_search', source: 'card_hermes_steward', target: 'card_research_agent', edgeType: 'flow' },
    { id: 'edge_hermes_worldsignals', source: 'card_hermes_steward', target: 'card_worldsignals_agent', edgeType: 'flow' },
    {
      id: 'edge_main_chat_magentic_control',
      source: 'card_main_chat',
      target: 'card_magentic',
      targetHandle: 'task-bus-top',
      edgeType: 'magentic_control',
    },
    { id: 'edge_coder_magentic_bus', source: 'card_local_coder', target: 'card_magentic', targetHandle: 'bus-in-1', edgeType: 'magentic_option' },
    { id: 'edge_search_magentic_bus', source: 'card_research_agent', target: 'card_magentic', targetHandle: 'bus-in-2', edgeType: 'magentic_option' },
    { id: 'edge_worldsignals_magentic_bus', source: 'card_worldsignals_agent', target: 'card_magentic', targetHandle: 'bus-in-3', edgeType: 'magentic_option' },
  ],
};

export const BUILDER_DECK_ID = INITIAL_DECK.id;
export const SYSTEM_CARD_RUNTIME_BINDINGS: Record<string, RuntimeBinding> = {
  card_assist: 'assist',
  card_local_coder: 'local_coder',
  // New specialist graph roles (current seeded Admin model)
  card_thinkgraph_agent: 'thinkgraph_agent',
  card_codegraph_agent: 'codegraph_agent',
  card_research_agent: 'research_agent',
  card_knowgraph_agent: 'knowgraph_agent',
  card_plan_agent: 'plan_agent',
  card_worldsignals_agent: 'worldsignals_agent',
  card_trading_workbench: 'trading_agent',
  card_hermes_steward: 'hermes_steward',
  // Backward compatibility: legacy card IDs for existing saved decks
  card_main_chat: 'main_chat',
  card_kg_ingest: 'kg_ingest',
  card_research: 'research_agent',
  card_knowgraph: 'knowgraph',
  card_neo4j: 'neo4j',
};

export const BASELINE_OPTIONAL_CARD_IDS = new Set([
  'card_local_coder',
  'card_worldsignals_agent',
  'card_trading_workbench',
]);
// Cards removed from the product: hydration drops them from stale saved decks.
// Graph surfaces are MCP tools now, never default canvas agents; Plan Agent is
// retired (Mag One owns team planning in Python).
export const REMOVED_DEFAULT_CARD_IDS = new Set([
  'card_assist',
  'card_data_formulator_workbench',
  'card_code_workbench',
  'card_thinkgraph_agent',
  'card_codegraph_agent',
  'card_knowgraph_agent',
  'card_plan_agent',
]);
export const REMOVED_DEFAULT_EDGE_IDS = new Set([
  'edge_magentic_research',
  'edge_magentic_assist',
  'edge_knowgraph_research',
  'edge_research_codegraph',
  'edge_codegraph_thinkgraph',
  // Retired bus wiring: Main Chat is control-only (task-bus-top), never a
  // worker; Hermes is never a Mag One participant.
  'edge_main_chat_harness_bus',
  'edge_magentic_hermes_bus',
]);
export const LEGACY_SYSTEM_CARD_IDS = new Set([
  'card_main_chat',
  'card_kg_ingest',
  'card_research',
  'card_knowgraph',
  'card_neo4j',
]);
