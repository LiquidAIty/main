/**
 * Entity: Projects
 * Relationship: This file defines the complete Card deck persisted when a new Project is created.
 * Entity: Saved Cards
 * Relationship: This file defines the six source-default saved Cards, including each Card's prompt, model, runtime options, and canvas position.
 * Entity: Card Topology
 * Relationship: This file defines the initial Main-to-Builder orange flow and Team-to-Magnetic blue membership saved with a new Project.
 * Entity: Main Chat
 * Relationship: This file defines Main's source-default prompt, Hermes mode, model, tools, and front-door operating policy.
 * Entity: Bot Mode Delegation
 * Relationship: This file defines Main's direct orange-roster messaging policy and seeds its authorized flow to Builder.
 * Entity: Builder Card
 * Relationship: This file defines the saved Builder Card's construction prompt, Hermes profile binding, tools, skills, and model.
 * Entity: ThinkGraph
 * Relationship: This file defines the saved ThinkGraph Card's reasoning prompt, Engraphis tools, profile, and model.
 * Entity: KnowGraph
 * Relationship: This file defines the saved KnowGraph Card's sourced-research prompt, Graphiti tools, profile, and model.
 * Entity: Magnetic TaskGraph
 * Relationship: This file defines Magnetic's approved-mission prompt, Hermes mode, model, and initial blue worker membership.
 * Entity: Team
 * Relationship: This file defines the saved Team Card's bounded-assignment prompt, profile, tools, and role as Magnetic's general worker.
 * Entity: Hermes Profiles
 * Relationship: This file binds every source-default Card to its stable Hermes mode, profile, provider, parent model, and subagent model selection.
 * Entity: Tool Catalog
 * Relationship: This file selects the source-default tool, skill, and toolset grants stored on each seeded Card.
 */

import type { DeckDocument } from '../types';

export const DEFAULT_PROJECT_DECK_ID = 'deck_builder';

const DEFAULT_CARD_MODEL_KEY = 'gpt-5.6-luna';
const DEFAULT_CARD_PROVIDER = 'openai' as const;
const MAIN_CHAT_MODEL_KEY = 'gpt-5.6-sol';
const AGENT_BUILDER_MODEL_KEY = 'gpt-5.6-sol';
const KNOWGRAPH_MODEL_KEY = 'gpt-5.6-sol';
const MAGNETIC_MODEL_KEY = 'gpt-5.6-sol';
const TEAM_CARD_MODEL_KEY = 'gpt-5.6-terra';

const DEFAULT_HERMES_SUBAGENT_MODEL = {
  provider: 'openai',
  accessMode: 'chatgpt-account' as const,
  modelKey: 'gpt-5.6-luna',
  providerModelId: 'gpt-5.6-luna',
};

const BUILDER_TOOLS = [
  'canvas.inspect',
  'card.create',
  'card.update_configuration',
  'cbm.search_graph',
  'cbm.trace_path',
  'cbm.get_code_snippet',
  'cbm.check_index_coverage',
  'cbm.detect_changes',
  'cbm.search_code',
  'cbm.query_graph',
];

const MAIN_TOOLS = [
  'canvas.inspect',
  'run_mag_one',
  'worldview.set_capability',
];

const THINKGRAPH_TOOLS = [
  'engraphis_recall_context',
  'engraphis_get_memory',
  'engraphis_remember',
  'engraphis_update_memory',
];

const KNOWGRAPH_TOOLS = [
  'canvas.inspect',
  'engraphis_get_memory',
  'graphiti.get_entity_edge',
  'graphiti.get_episode_entities',
  'graphiti.get_episodes',
  'graphiti.get_status',
  'graphiti.search_memory_facts',
  'graphiti.search_nodes',
  'graphiti.add_memory_to_entity',
];

const TEAM_TOOLS = [
  'canvas.inspect',
  'engraphis_recall_context',
  'engraphis_get_memory',
  'graphiti.search_nodes',
  'graphiti.search_memory_facts',
  'graphiti.get_episodes',
];

function buildPrompt(parts: {
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

const MAIN_OPERATING_POLICY = `[OPERATING POLICY]
Use the current Project's enabled outbound orange flow wires as the complete direct Bot roster. Blue magentic_option wires only select Magnetic workers and never create direct Bot authority.
Answer directly when another Card is unnecessary. When a connected Card is needed, use Hermes message_agent. Never impersonate a recipient, switch profiles, write into another Card's terminal, or substitute another execution route.
When the user explicitly addresses an eligible @Card, compose one bounded message and send it once with message_agent. The recipient provides the visible answer under its own identity; return [SILENT] instead of adding or rewriting a Main answer. Internal delivery state is never a user-facing answer; only the recipient's actual completion is completed work.
When you independently consult a connected Card, wait for its actual returned result and use that result in your answer. Never invent a result or hide a delivery failure.
Wiring never starts work. Invoke Magnetic only for an approved mission through the existing run_mag_one TaskGraph workflow and its exact blue-connected saved workers. Do not replace Magnetic with delegate_task or another task system.
Do not claim ThinkGraph capture occurred unless the runtime reports it. Use KnowGraph for sourced research and distinguish a returned finding from a confirmed saved Know.
Builder is the same saved Builder shown in the lower terminal.`;

const MAGNETIC_PROMPT = buildPrompt({
  role: 'You are Magnetic, the execution orchestrator for one approved mission on the visible Agent Canvas.',
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
    'flow is directed Hermes Bot messaging authority and has no Magnetic scheduling meaning.',
    'Do not rewrite user canvas wiring.',
  ].join('\n'),
});

const MAIN_PROMPT = `${buildPrompt({
  role: 'You are Main, the persistent user-facing front door and system orchestrator.',
  goal: [
    'Understand the user\'s intent, select deliberate context, answer directly, and review returned work.',
    'Address only orange-connected saved Cards, approve one exact Magnetic mission with the user, and invoke Magnetic only after that approval.',
  ].join('\n'),
  constraints: [
    'Remain headless and do not act as a coding worker. Do not use CBM, the full Graphiti catalog, terminal, files, browser, or Kanban.',
    'Use only the automatically supplied Project Entity/Relationship grounding and granted Card/Magnetic capabilities. Address a connected Card through message_agent by its exact saved visible name; a wire grants outbound authority but never starts work or grants reverse authority.',
    'Send only the bounded mission and necessary context. Do not copy the conversation or Main memory into another Card.',
    'Invoke run_mag_one only once for the exact approved mission. Never invent results, graph activity, sources, code changes, or tool execution.',
  ].join('\n'),
  ioSchema: [
    'Input: the current user turn plus deliberately selected context and references.',
    'Output: a direct user-facing answer, or a concise reviewed result with the exact next approval or blocker.',
  ].join('\n'),
  memoryPolicy: 'Treat the supplied Project Entity/Relationship map as lightweight grounding. Reach an exactly connected ThinkGraph Card when deeper historical Project reasoning is needed; Main does not write graph state. Keep run-specific tasks, selected references, tool schemas, and orchestration transcripts out of stable memory.',
})}\n\n${MAIN_OPERATING_POLICY}`;

const BUILDER_PROMPT = buildPrompt({
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
});

const THINKGRAPH_PROMPT = buildPrompt({
  role: 'You are ThinkGraph. Maintain Engraphis project reasoning for focused material from Main.',
  goal: 'Convert each completed User/Main exchange into the fewest useful, independently reusable Thinks while preserving its natural meaning.',
  constraints: [
    'Each Think is one natural, semantically complete thought. Do not classify it as a hypothesis, decision, question, assumption, or another analytical taxonomy.',
    'Do not generate importance, confidence, probability, or priority scores. Do not write a report and then split it into artificial fragments. Use exactly as much text as the thought needs, with no sentence or character target.',
    'Read before writing when useful. Reuse returned record IDs, preserve evidence and uncertainty, and make no write when nothing useful changed.',
    'Before a write, inspect the complete supplied cross-graph Entity directory. Reuse an exact supplied canonical name when model reasoning identifies the same Entity; propose a new name only for a genuinely distinct Entity. Shared names do not imply agreement, and the two graphs retain separate authority-specific IDs.',
    'Reuse relevant Entities and state meaningful relationships supported by the completed exchange. One Think may relate to several Entities without being copied once per Entity.',
    'The directory is identity-only. Do not treat KnowGraph names as facts or infer hidden Know evidence from Entity membership.',
    'Use the exact Engraphis operation that fits the supported change; never invent facts, relationships, receipts, or successful writes.',
    'Do not browse the web, write KnowGraph, create or modify Cards, run Magnetic, or perform another agent\'s task. Return unresolved research needs to Main.',
    'Keep ThinkGraph and KnowGraph separate. Do not turn prompts, speaker labels, or tool receipts into project knowledge.',
  ].join('\n'),
  ioSchema: [
    'Input: one completed User/Main exchange plus relevant Project Entities and references.',
    'Output: the fewest focused reusable Thinks, their Entities and meaningful relationships, or an honest no-change result.',
  ].join('\n'),
  memoryPolicy: 'Engraphis owns project reasoning, deduplication, correction history, and persistence. Preserve record IDs, evidence, attribution, and uncertainty.',
});

const TEAM_PROMPT = buildPrompt({
  role: 'You are Team, Magnetic\'s general-purpose wildcard and capacity fallback.',
  goal: [
    'Complete only the bounded assignment Magnetic gives this saved Card.',
    'When useful, rely on the runtime-owned automatic parallel worker, review, and synthesis behavior, then return one evidence-backed result.',
  ].join('\n'),
  constraints: [
    'Stay inside the assigned slice. Do not reinterpret, expand, or take ownership of the overall Magnetic mission.',
    'Use only granted tools and supplied context. Preserve sources, references, uncertainty, failures, and unresolved questions.',
    'The runtime owns decomposition, temporary workers, review, synthesis, task state, and completion. Do not create another board, scheduler, or hidden team.',
    'Never create or modify a saved Card, profile, skill, toolset, or wire. Never call card.create, card.update_configuration, or canvas.upsert_wire.',
    'Report a repeated capability gap as ordinary evidence for Magnetic or Main. Do not create or install another saved Card.',
  ].join('\n'),
  ioSchema: [
    'Input: one bounded task assignment plus deliberately selected context and references.',
    'Output: one synthesized result with evidence, uncertainty, blockers, and unresolved questions.',
  ].join('\n'),
  memoryPolicy: [
    'Use this Card\'s saved memory and grants only for the current assignment.',
    'Return repeated capability gaps to Magnetic or Main for review; never mutate the saved Card system.',
  ].join('\n'),
});

const KNOWGRAPH_PROMPT = buildPrompt({
  role: 'You are KnowGraph. Perform sourced research and maintain knowledge and provenance through Graphiti.',
  goal: 'Answer one bounded research assignment with selected web research and exact Graphiti operations, preserving useful sourced knowledge for later work.',
  constraints: [
    'Research the bounded request and produce focused, independently reusable Knows directly from the evidence. Do not write one large report and slice it afterward.',
    'Keep each Know semantically complete and concise enough to reuse, with no arbitrary sentence or character limit. Separate genuinely distinct findings instead of bundling an entire research package into one Know.',
    'For every Know, include the interpretation needed to understand the finding, cite its supporting source, and explain exactly what that citation supports.',
    'Inspect supplied graph data before researching. Use an exact supplied ThinkGraph ID only through engraphis_get_memory; do not search ThinkGraph or reconstruct Main\'s context.',
    'Before graphiti.add_memory_to_entity, inspect the complete supplied cross-graph Entity directory. Reuse an exact supplied canonical name when model reasoning identifies the same Entity; propose a new name only for a genuinely distinct Entity. Never copy a ThinkGraph record ID into KnowGraph content.',
    'Treat a deliberately supplied Think as research framing or a question to investigate, never as evidence; only sourced research may become Know.',
    'Preserve sources, URLs, dates, entities, relationships, contradictions, Graphiti record IDs, and uncertainty. Write only useful source-backed findings and never invent sources, graph writes, or tool results.',
    'When bounded research produces a useful verified finding, persist one two-sided cited know.v1 episode through graphiti.add_memory_to_entity before answering. Attach it to the exact current Entity, and make the strongest sourced case For and Against without inventing either side.',
    'The authenticated runtime supplies the current Project Graphiti scope. Keep citation URLs inside the Know; never promote a URL into the Project Entity map or graph view.',
    'Do not use CBM or become a coding worker. Do not initiate another saved Card, create recursive workers, or execute Magnetic.',
    'Use only the bounded graph references supplied with the current IDF. Do not create another input format or execute another Card.',
  ].join('\n'),
  ioSchema: [
    'Input: one bounded research assignment plus deliberately selected context and graph references.',
    'Output: one sourced result with evidence, uncertainty, blockers, and exact Graphiti references or an honest no-change result.',
  ].join('\n'),
  memoryPolicy: 'Graphiti owns durable sourced knowledge and provenance. Keep candidate links and run-specific context transient; preserve Graphiti record IDs and do not copy orchestration transcripts into the graph.',
});

export const DEFAULT_PROJECT_DECK: DeckDocument = {
  id: DEFAULT_PROJECT_DECK_ID,
  name: 'Agent Card Deck',
  projectCodeFolder: 'workspace',
  version: 10,
  promptTemplates: [
    { id: 'prompt_magentic', content: MAGNETIC_PROMPT },
    { id: 'prompt_main_chat', content: MAIN_PROMPT },
    { id: 'prompt_builder', content: BUILDER_PROMPT },
    { id: 'prompt_thinkgraph', content: THINKGRAPH_PROMPT },
    { id: 'prompt_team', content: TEAM_PROMPT },
    { id: 'prompt_knowgraph', content: KNOWGRAPH_PROMPT },
  ],
  nodes: [
    {
      id: 'card_main_chat',
      kind: 'agent',
      templateId: 'template_main_chat',
      prompt: MAIN_PROMPT,
      runtime: { kind: 'hermes', mode: 'main', profile: 'main' },
      runtimeOptions: {
        subagentType: 'none',
        provider: DEFAULT_CARD_PROVIDER,
        accessMode: 'chatgpt-account',
        modelKey: MAIN_CHAT_MODEL_KEY,
        providerModelId: MAIN_CHAT_MODEL_KEY,
        subagentModel: { ...DEFAULT_HERMES_SUBAGENT_MODEL },
        tools: [...MAIN_TOOLS],
      },
      parentGraphId: null,
      title: 'Main',
      subtitle: 'Persistent conversation front door',
      position: { x: -24, y: -24 },
    },
    {
      id: 'builder',
      kind: 'agent',
      templateId: 'template_assist',
      prompt: BUILDER_PROMPT,
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'builder' },
      runtimeOptions: {
        subagentType: 'none',
        provider: DEFAULT_CARD_PROVIDER,
        accessMode: 'chatgpt-account',
        modelKey: AGENT_BUILDER_MODEL_KEY,
        providerModelId: AGENT_BUILDER_MODEL_KEY,
        subagentModel: { ...DEFAULT_HERMES_SUBAGENT_MODEL },
        tools: [...BUILDER_TOOLS],
        skills: ['agent-builder-inspection'],
        toolsets: ['web', 'terminal', 'file', 'browser', 'vision', 'code_execution'],
      },
      parentGraphId: null,
      title: 'Builder',
      subtitle: 'Prompts, agents, apps, and supporting code',
      position: { x: 360, y: -80 },
    },
    {
      id: 'card_thinkgraph',
      kind: 'agent',
      templateId: 'template_thinkgraph',
      prompt: THINKGRAPH_PROMPT,
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'thinkgraph' },
      runtimeOptions: {
        subagentType: 'none',
        subagentModel: { ...DEFAULT_HERMES_SUBAGENT_MODEL },
        tools: [...THINKGRAPH_TOOLS],
        modelKey: DEFAULT_CARD_MODEL_KEY,
        providerModelId: DEFAULT_CARD_MODEL_KEY,
        provider: DEFAULT_CARD_PROVIDER,
        accessMode: 'chatgpt-account',
        reasoningEffort: 'low',
      },
      parentGraphId: null,
      title: 'ThinkGraph',
      subtitle: 'Project memory',
      position: { x: -260, y: 120 },
    },
    {
      id: 'card_magentic',
      kind: 'agent',
      templateId: 'template_magentic',
      prompt: MAGNETIC_PROMPT,
      runtime: { kind: 'hermes', mode: 'magentic_one', profile: 'card_magentic' },
      runtimeOptions: {
        subagentType: 'none',
        provider: DEFAULT_CARD_PROVIDER,
        accessMode: 'chatgpt-account',
        modelKey: MAGNETIC_MODEL_KEY,
      },
      parentGraphId: null,
      title: 'Magnetic',
      subtitle: 'Tasks',
      position: { x: 140, y: 120 },
    },
    {
      id: 'card_team',
      kind: 'agent',
      templateId: 'template_team',
      prompt: TEAM_PROMPT,
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'team' },
      runtimeOptions: {
        provider: DEFAULT_CARD_PROVIDER,
        accessMode: 'chatgpt-account',
        modelKey: TEAM_CARD_MODEL_KEY,
        providerModelId: TEAM_CARD_MODEL_KEY,
        subagentModel: { ...DEFAULT_HERMES_SUBAGENT_MODEL },
        tools: [...TEAM_TOOLS],
        skills: ['grounded-citations'],
        toolsets: ['web', 'terminal', 'file', 'browser', 'vision', 'code_execution'],
      },
      parentGraphId: null,
      title: 'Team',
      subtitle: 'Wildcard',
      position: { x: 600, y: 340 },
    },
    {
      id: 'card_knowgraph',
      kind: 'agent',
      templateId: 'template_knowgraph',
      prompt: KNOWGRAPH_PROMPT,
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'knowgraph' },
      runtimeOptions: {
        subagentType: 'none',
        subagentModel: { ...DEFAULT_HERMES_SUBAGENT_MODEL },
        tools: [...KNOWGRAPH_TOOLS],
        skills: ['grounded-citations'],
        toolsets: ['web'],
        modelKey: KNOWGRAPH_MODEL_KEY,
        providerModelId: KNOWGRAPH_MODEL_KEY,
        provider: DEFAULT_CARD_PROVIDER,
        accessMode: 'chatgpt-account',
      },
      parentGraphId: null,
      title: 'KnowGraph',
      subtitle: 'Sourced research and provenance',
      position: { x: 260, y: 480 },
    },
  ],
  edges: [
    {
      id: 'edge_main_chat_agent_builder',
      source: 'card_main_chat',
      target: 'builder',
      edgeType: 'flow',
    },
    {
      id: 'edge_team_magentic_bus',
      source: 'card_team',
      target: 'card_magentic',
      targetHandle: 'bus-in-5',
      edgeType: 'magentic_option',
    },
  ],
};

export function createDefaultProjectDeck(): DeckDocument {
  return structuredClone(DEFAULT_PROJECT_DECK);
}

function seedProjection(deck: DeckDocument): unknown {
  const runtimeOptions = (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const projected = structuredClone(value as Record<string, unknown>);
    for (const field of ['tools', 'skills', 'toolsets', 'mcpConnectionIds']) {
      if (Array.isArray(projected[field]) && projected[field].length === 0) {
        delete projected[field];
      }
    }
    return projected;
  };
  return {
    id: deck.id,
    name: deck.name,
    projectCodeFolder: deck.projectCodeFolder ?? null,
    version: deck.version,
    promptTemplates: deck.promptTemplates.map((template) => ({
      id: template.id,
      content: template.content,
    })),
    nodes: deck.nodes.map((node) => ({
      id: node.id,
      enabled: node.enabled !== false,
      kind: node.kind ?? 'agent',
      templateId: node.templateId,
      role: node.role ?? null,
      prompt: node.prompt ?? null,
      outputContract: node.outputContract ?? null,
      runtime: node.runtime,
      runtimeOptions: runtimeOptions(node.runtimeOptions),
      parentGraphId: node.parentGraphId ?? null,
      title: node.title,
      subtitle: node.subtitle ?? null,
      position: node.position,
    })),
    edges: deck.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      sourceHandle: edge.sourceHandle ?? null,
      target: edge.target,
      targetHandle: edge.targetHandle ?? null,
      edgeType: edge.edgeType ?? null,
      enabled: edge.enabled !== false,
    })),
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => (
      `${JSON.stringify(key)}:${canonicalJson(entry)}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function isDefaultProjectDeckReadback(deck: DeckDocument): boolean {
  return canonicalJson(seedProjection(deck))
    === canonicalJson(seedProjection(DEFAULT_PROJECT_DECK));
}
