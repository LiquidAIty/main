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
    // grpcChatClient.resolveMainChatSystemPrompt. It teaches the live Harness to
    // drive the real run_mag_one spine; it does NOT instruct any tool that does
    // not yet exist (no run-folder writer, no KnowGraph/CodeGraph read tool).
    content: [
      'You are the LiquidAIty Harness — the persistent chat front door for this project.',
      'You are not a worker and you are not the orchestrator. Your job: understand the user, gather the real context a run needs, author one canonical Run Packet, hand it to the Mag One orchestrator, and report back honestly.',
      '',
      'For a normal question or a small local task, just answer or use your own tools directly. Start a Mag One team run ONLY when the request genuinely needs the connected worker cards.',
      '',
      'When a team run is warranted, drive this exact spine:',
      '1. Use the active project and conversation you are already in. Never invent ids. The one canonical Agent Canvas deck id is deck_builder — use it wherever a deckId is required.',
      '2. Call mcp__liquidaity__hermes_preflight_context with the user request, the active projectId, and your real conversationId. Hermes returns the ContextPacket (bounded ThinkGraph memory, connected/disconnected workers, KnowGraph availability) plus a draft Run Packet. Use only what it actually returned: if a graph is reported unavailable or empty, say so plainly — never invent memory. For deeper ThinkGraph detail, mcp__liquidaity__thinkgraph_get_graph_slice remains available.',
      '3. Author the final Run Packet in Markdown by refining the Hermes draft with the conversation context you own. Keep its real fields: the user request; the run identity (projectId, deckId, conversationId); the connected workers and their tools exactly as reported (mcp__liquidaity__mag_one_describe_connected_agents can re-check); the disconnected exclusions; the honest graph availability; the proof requirements; the expected visible output; and the no-fallback rules. Describe the goal and let Mag One choose among the connected workers — do not force research, coding, or every worker into the run.',
      '4. Send the Run Packet content unchanged to mcp__liquidaity__run_mag_one with the active projectId, the deckId, your conversationId, and the Run Packet Markdown as promptMarkdown. Do not rewrite it into a plan or task list on the way in.',
      '5. When run_mag_one returns, report to the user from the REAL returned result only: what was done, which workers acted, their actual outputs and evidence, verified outcomes, uncertainty or conflicts, blockers, and the recommended next action. Hermes postflight then reviews the run result and records run memory to ThinkGraph automatically — never claim that memory yourself.',
      '',
      'Hard rules:',
      '- Never claim a graph write, code change, artifact, or tool execution that a real returned result does not show. No result → say the run failed or is blocked, and why.',
      '- Mag One chooses workers from the Run Packet and the real connected set. You never route by card name and never force a specific worker.',
      '- Keep the Run Packet faithful to the real context you gathered; it is the operative instruction for the run.',
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
        'You are Hermes — the project\'s knowledge compounding agent.',
        'You are a separate skeptical evaluator: the coder never grades itself; you do.',
      ].join('\n'),
      goal: [
        'Review CoderReports for honesty: call hermes_review_coder_report with the full CoderReport JSON and the feature id, then relay its HermesReview verdict, proof accounting, and blocker findings.',
        'Classify blockers into recurring patterns using prior ThinkGraph memory.',
        'Write structured RunRecord/Blocker/Pattern findings to ThinkGraph through your scoped card authority (apply_thinkgraph_patch), using the ready thinkgraphPatch the review tool returns.',
        'When asked "what do we know about X?", read ThinkGraph with read_thinkgraph_scope and return structured context.',
      ].join('\n'),
      constraints: [
        'Never fabricate graph data. If ThinkGraph is empty or a tool reports authority missing, say so honestly.',
        'Never claim a write happened unless apply_thinkgraph_patch returned an applied result.',
        'Never write KnowGraph or CodeGraph — ThinkGraph through your card authority is your only write surface.',
        'Never review a report by vibes: run hermes_review_coder_report and ground your judgment in its structural findings.',
      ].join('\n'),
      ioSchema: [
        'Input: a CoderReport to review, or a project-context question.',
        'Output: structured JSON — the HermesReview (verdict honest|incomplete|suspicious|blocked|empty, proof quality, blockers, pattern recurrence, recommendation) or the requested ThinkGraph context.',
      ].join('\n'),
      memoryPolicy: [
        'ThinkGraph run memory: RunRecord/Blocker/Pattern nodes with HAS_RUN/ENCOUNTERED/INSTANCE_OF edges.',
        'Read prior runs before reviewing so pattern occurrences compound instead of resetting.',
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
      runtimeOptions: {
        provider: DEFAULT_CARD_PROVIDER,
        modelKey: DEFAULT_CARD_MODEL_KEY,
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
      id: 'card_thinkgraph_agent',
      kind: 'agent',
      templateId: 'template_thinkgraph_agent',
      prompt:
        INITIAL_PROMPT_TEMPLATES.find(
          (template) => template.id === 'prompt_thinkgraph_agent',
        )?.content || '',
      runtimeBinding: 'thinkgraph_agent',
      runtimeType: 'assistant_agent',
      // Exactly the two scoped ThinkGraph tools — the card's ONLY write authority.
      // Default model follows the existing default-card convention and stays fully
      // editable on the card (canvas remains the source of truth).
      runtimeOptions: {
        tools: ['read_thinkgraph_scope', 'apply_thinkgraph_patch'],
        modelKey: 'openai/gpt-5.1-chat',
        provider: 'openrouter',
      },
      parentGraphId: null,
      title: 'ThinkGraph Agent',
      subtitle: 'Provisional / planning memory (AGE)',
      position: { x: 0, y: 140 },
      status: 'ready',
      cloneConfig: { enabled: false, seeds: [] },
    },
    {
      id: 'card_codegraph_agent',
      kind: 'agent',
      templateId: 'template_codegraph_agent',
      prompt:
        INITIAL_PROMPT_TEMPLATES.find(
          (template) => template.id === 'prompt_codegraph_agent',
        )?.content || '',
      runtimeBinding: 'codegraph_agent',
      runtimeType: 'assistant_agent',
      parentGraphId: null,
      title: 'CodeGraph Agent',
      subtitle: 'Structural code memory',
      position: { x: -170, y: 140 },
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
      // Research is a pure reasoning worker on the bus: it carries NO tools.
      // Graph evidence comes from the KnowGraph Agent (Mag One coordinates the
      // two) — research must never claim internet or tool access it lacks.
      // Same model convention as the ThinkGraph card; fully editable on the card.
      runtimeOptions: {
        modelKey: 'openai/gpt-5.1-chat',
        provider: 'openrouter',
      },
      parentGraphId: null,
      title: 'Research Agent',
      subtitle: 'Research and analysis worker',
      position: { x: -340, y: 140 },
      status: 'ready',
      cloneConfig: { enabled: false, seeds: [] },
    },
    {
      id: 'card_knowgraph_agent',
      kind: 'agent',
      templateId: 'template_knowgraph_agent',
      prompt:
        INITIAL_PROMPT_TEMPLATES.find(
          (template) => template.id === 'prompt_knowgraph_agent',
        )?.content || '',
      runtimeBinding: 'knowgraph_agent',
      runtimeType: 'assistant_agent',
      // Read-only retrieval only — no KnowGraph write tool is wired yet, and
      // this card must never pretend one exists. Same model convention as the
      // ThinkGraph card; fully editable on the card.
      runtimeOptions: {
        tools: ['retrieve_knowgraph_context'],
        modelKey: 'openai/gpt-5.1-chat',
        provider: 'openrouter',
      },
      parentGraphId: null,
      title: 'KnowGraph Agent',
      subtitle: 'Grounded / evidence-backed memory (Neo4j)',
      position: { x: -510, y: 140 },
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
      // The pure review tool plus the two scoped ThinkGraph tools — the same
      // write-authority class as the ThinkGraph card (server-minted
      // thinkgraph_card_run authority, one canonical patch path). Same model
      // convention as the ThinkGraph card; fully editable on the card.
      runtimeOptions: {
        tools: [
          'hermes_review_coder_report',
          'read_thinkgraph_scope',
          'apply_thinkgraph_patch',
        ],
        modelKey: 'openai/gpt-5.1-chat',
        provider: 'openrouter',
      },
      parentGraphId: null,
      title: 'Hermes',
      subtitle: 'Knowledge compounding agent',
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
      id: 'card_plan_agent',
      kind: 'agent',
      templateId: 'template_plan_agent',
      prompt:
        INITIAL_PROMPT_TEMPLATES.find(
          (template) => template.id === 'prompt_plan_agent',
        )?.content || '',
      runtimeBinding: 'plan_agent',
      runtimeType: 'assistant_agent',
      parentGraphId: null,
      title: 'Plan Agent',
      subtitle: 'Approval and planning surface',
      position: { x: 0, y: 380 },
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
      parentGraphId: null,
      title: 'WorldSignals Agent',
      subtitle: 'Outside-world context surface',
      position: { x: 0, y: 260 },
      status: 'ready',
      cloneConfig: { enabled: false, seeds: [] },
    },
  ],
  edges: [
    {
      id: 'edge_main_chat_harness_bus',
      source: 'card_main_chat',
      target: 'card_magentic',
      targetHandle: 'bus-in-0',
      edgeType: 'magentic_option',
    },
    {
      // Hermes on the bus: Mag One may include the steward in team runs as
      // reviewer. Bus connectivity is the ONLY activation signal.
      id: 'edge_magentic_hermes_bus',
      source: 'card_magentic',
      target: 'card_hermes_steward',
      edgeType: 'magentic_option',
    },
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
  'card_plan_agent',
  'card_worldsignals_agent',
  'card_trading_workbench',
]);
// Cards removed from the product: hydration drops them from stale saved decks.
export const REMOVED_DEFAULT_CARD_IDS = new Set([
  'card_assist',
  'card_data_formulator_workbench',
  'card_code_workbench',
]);
export const REMOVED_DEFAULT_EDGE_IDS = new Set([
  'edge_magentic_research',
  'edge_magentic_assist',
  'edge_knowgraph_research',
  'edge_research_codegraph',
  'edge_codegraph_thinkgraph',
]);
export const LEGACY_SYSTEM_CARD_IDS = new Set([
  'card_main_chat',
  'card_kg_ingest',
  'card_research',
  'card_knowgraph',
  'card_neo4j',
]);
