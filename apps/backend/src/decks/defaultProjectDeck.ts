/**
 * Entity: Projects
 * Relationship: This file defines the complete Card deck persisted when a new Project is created.
 * Entity: Saved Cards
 * Relationship: This file defines the six source-default saved Cards, loading each Card's prompt from its dedicated Markdown asset and retaining model, runtime options, and canvas position here.
 * Entity: Card Topology
 * Relationship: This file defines the initial Main-to-Builder orange flow and Team-to-Magnetic blue membership saved with a new Project.
 * Entity: Main Chat
 * Relationship: This file binds Main's source-default prompt asset to its runtime mode, model, tools, and front-door operating policy.
 * Entity: Agent Messaging
 * Relationship: This file defines Main's saved-Card agent messaging policy and seeds its wire to Builder.
 * Entity: Builder Card
 * Relationship: This file binds the saved Builder Card's construction prompt asset to its profile, tools, skills, and model.
 * Entity: ThinkGraph
 * Relationship: This file binds the saved ThinkGraph Card's reasoning prompt asset to its Engraphis tools, profile, and model.
 * Entity: KnowGraph
 * Relationship: This file binds the saved KnowGraph Card's sourced-research prompt asset to its Graphiti tools, profile, and model.
 * Entity: Magnetic
 * Relationship: This file binds Magnetic's prompt asset to its saved Card, model, and initial blue membership without claiming worker execution.
 * Entity: Team
 * Relationship: This file binds the saved Team Card's bounded-assignment prompt asset to its profile, tools, and generalist role.
 * Entity: Card Profiles
 * Relationship: This file binds every source-default Card to its stable runtime mode, profile, provider, parent model, and subagent model selection.
 * Entity: Tool Catalog
 * Relationship: This file selects the source-default tool, skill, and toolset grants stored on each seeded Card.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { DeckDocument } from '../types';

export const DEFAULT_PROJECT_DECK_ID = 'deck_builder';

const DEFAULT_CARD_MODEL_KEY = 'gpt-5.6-luna';
const DEFAULT_CARD_PROVIDER = 'openai' as const;
const MAIN_CHAT_MODEL_KEY = 'gpt-5.6-sol';
const AGENT_BUILDER_MODEL_KEY = 'gpt-5.6-sol';
const KNOWGRAPH_MODEL_KEY = 'gpt-5.6-sol';
const MAGNETIC_MODEL_KEY = 'gpt-5.6-sol';
const TEAM_CARD_MODEL_KEY = 'gpt-5.6-terra';

const DEFAULT_SUBAGENT_MODEL = {
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
  'project_graph.list_entities',
  'project_graph.read_entity_context',
  'worldview.set_capability',
];

const THINKGRAPH_TOOLS = [
  'engraphis_recall_context',
  'engraphis_get_memory',
  'engraphis_remember_entities',
  'engraphis_discover_actions',
  'engraphis_execute_read',
];

const KNOWGRAPH_TOOLS = [
  'canvas.inspect',
  'engraphis_get_memory',
  'graphiti.get_entity_edge',
  'graphiti.get_know',
  'graphiti.get_entity_knows',
  'graphiti.get_episode_entities',
  'graphiti.get_episodes',
  'graphiti.get_status',
  'graphiti.search_memory_facts',
  'graphiti.search_knows',
  'graphiti.search_nodes',
  'graphiti.add_know',
];

const TEAM_TOOLS = [
  'canvas.inspect',
  'engraphis_recall_context',
  'engraphis_get_memory',
  'graphiti.search_nodes',
  'graphiti.search_memory_facts',
  'graphiti.get_episodes',
];

function readDefaultCardPrompt(fileName: string): string {
  const content = readFileSync(join(__dirname, 'prompts', fileName), 'utf8');
  return content.endsWith('\n') ? content.slice(0, -1) : content;
}

const MAGNETIC_PROMPT = readDefaultCardPrompt('magnetic.md');
const MAIN_PROMPT = readDefaultCardPrompt('main.md');
const BUILDER_PROMPT = readDefaultCardPrompt('builder.md');
const THINKGRAPH_PROMPT = readDefaultCardPrompt('thinkgraph.md');
const TEAM_PROMPT = readDefaultCardPrompt('team.md');
const KNOWGRAPH_PROMPT = readDefaultCardPrompt('knowgraph.md');

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
        subagentModel: { ...DEFAULT_SUBAGENT_MODEL },
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
        subagentModel: { ...DEFAULT_SUBAGENT_MODEL },
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
        subagentModel: { ...DEFAULT_SUBAGENT_MODEL },
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
        subagentModel: { ...DEFAULT_SUBAGENT_MODEL },
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
        subagentModel: { ...DEFAULT_SUBAGENT_MODEL },
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
