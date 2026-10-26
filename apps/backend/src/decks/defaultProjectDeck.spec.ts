/**
 * Entity: Projects
 * Relationship: This file verifies each new Project receives an independent canonical source-default deck and exact persistence readback.
 * Entity: Saved Cards
 * Relationship: This file verifies the source-default roster contains exactly Main, Builder, ThinkGraph, Magnetic, Team, and KnowGraph with stable saved identities.
 * Entity: Card Prompts
 * Relationship: This file verifies the six source-default prompts are loaded from dedicated Markdown assets without changing their exact persisted bytes.
 * Entity: Card Topology
 * Relationship: This file verifies the default deck contains only the intended Main-to-Builder flow and Team-to-Magnetic membership.
 * Entity: Main Chat
 * Relationship: This file verifies Main's source-default saved mode, profile, model, and selected capabilities.
 * Entity: Builder Card
 * Relationship: This file verifies Builder's source-default saved profile, model, skills, and construction toolsets.
 * Entity: ThinkGraph
 * Relationship: This file verifies the source-default ThinkGraph Card receives only its intended Engraphis operations.
 * Entity: KnowGraph
 * Relationship: This file verifies the source-default KnowGraph Card uses its intended model and Graphiti operations.
 * Entity: Magnetic Membership
 * Relationship: This file verifies Magnetic retains its distinct saved identity and blue Team membership.
 * Entity: Team
 * Relationship: This file verifies Team retains its distinct saved identity, model, and bounded research toolset.
 * Entity: Card Profiles
 * Relationship: This file verifies every source-default Card has one unique stable profile and expected runtime mode.
 * Entity: Tool Catalog
 * Relationship: This file verifies the exact source-default capability selections stored on the core Cards.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createDefaultProjectDeck,
  DEFAULT_PROJECT_DECK,
  DEFAULT_PROJECT_DECK_ID,
  isDefaultProjectDeckReadback,
} from './defaultProjectDeck';

const EXPECTED_PROMPT_CONTRACTS = [
  {
    asset: 'magnetic.md',
    templateId: 'prompt_magentic',
    cardId: 'card_magentic',
    bytes: 1529,
    sha256: '1e1c2637989231c605e9c04c54658dcb13830a51fd9abc918ed614cb2a73b5ae',
  },
  {
    asset: 'main.md',
    templateId: 'prompt_main_chat',
    cardId: 'card_main_chat',
    bytes: 6510,
    sha256: '3ecfe88ac669e5719a0aba0201bab3d68d12efdae0f1866fbdc0c44f7edb7036',
  },
  {
    asset: 'builder.md',
    templateId: 'prompt_builder',
    cardId: 'builder',
    bytes: 1852,
    sha256: '7ad48c7e9ae1ad707f8fe255e5da0f516c538acbf5df71d685b59a0edfbe8ed5',
  },
  {
    asset: 'thinkgraph.md',
    templateId: 'prompt_thinkgraph',
    cardId: 'card_thinkgraph',
    bytes: 5498,
    sha256: 'eabc43f0cac64fb50aca8ec60583e0581b51582ea920456391f9f4939db2998d',
  },
  {
    asset: 'team.md',
    templateId: 'prompt_team',
    cardId: 'card_team',
    bytes: 1549,
    sha256: 'e8636f8cfd9d6f302cfe447de110f2bccb0a4ababa4546da8895c33b62a97a67',
  },
  {
    asset: 'knowgraph.md',
    templateId: 'prompt_knowgraph',
    cardId: 'card_knowgraph',
    bytes: 4980,
    sha256: '8bda90b55303353c590d5b37f83cc7efbec118c23a6e81d1743411a583ba2a82',
  },
] as const;

describe('backend-owned default Project deck', () => {
  it('loads byte-identical source-default prompts from dedicated Markdown assets', () => {
    const source = readFileSync(join(__dirname, 'defaultProjectDeck.ts'), 'utf8');
    const templates = new Map(
      DEFAULT_PROJECT_DECK.promptTemplates.map((template) => [template.id, template.content]),
    );
    const cards = new Map(DEFAULT_PROJECT_DECK.nodes.map((card) => [card.id, card]));

    expect(source).not.toContain('# CARD_PROMPT_V1');
    expect(source).not.toContain('[ROLE]');

    for (const contract of EXPECTED_PROMPT_CONTRACTS) {
      const asset = readFileSync(join(__dirname, 'prompts', contract.asset), 'utf8');
      const assetPrompt = asset.endsWith('\n') ? asset.slice(0, -1) : asset;
      const templatePrompt = templates.get(contract.templateId);
      const cardPrompt = cards.get(contract.cardId)?.prompt;

      expect(templatePrompt).toBe(assetPrompt);
      expect(cardPrompt).toBe(assetPrompt);
      expect(Buffer.byteLength(assetPrompt, 'utf8')).toBe(contract.bytes);
      expect(createHash('sha256').update(assetPrompt, 'utf8').digest('hex'))
        .toBe(contract.sha256);
    }
  });

  it('defines exactly the six intended core Cards with unique stable profiles', () => {
    expect(DEFAULT_PROJECT_DECK.id).toBe(DEFAULT_PROJECT_DECK_ID);
    expect(DEFAULT_PROJECT_DECK.projectCodeFolder).toBe('workspace');
    expect(DEFAULT_PROJECT_DECK.nodes.map((card) => ({
      id: card.id,
      title: card.title,
      mode: card.runtime.mode,
      profile: card.runtime.profile,
    }))).toEqual([
      { id: 'card_main_chat', title: 'Main', mode: 'main', profile: 'main' },
      { id: 'builder', title: 'Builder', mode: 'delegate', profile: 'builder' },
      { id: 'card_thinkgraph', title: 'ThinkGraph', mode: 'delegate', profile: 'thinkgraph' },
      { id: 'card_magentic', title: 'Magnetic', mode: 'magentic_one', profile: 'card_magentic' },
      { id: 'card_team', title: 'Team', mode: 'delegate', profile: 'team' },
      { id: 'card_knowgraph', title: 'KnowGraph', mode: 'delegate', profile: 'knowgraph' },
    ]);
    expect(new Set(DEFAULT_PROJECT_DECK.nodes.map((card) => card.runtime.profile)).size)
      .toBe(DEFAULT_PROJECT_DECK.nodes.length);
  });

  it('defines only the intended Main-to-Builder flow and Team-to-Magnetic membership', () => {
    expect(DEFAULT_PROJECT_DECK.edges).toEqual([
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
    ]);
  });

  it('keeps the exact saved role configuration on its owning Cards', () => {
    const byId = new Map(DEFAULT_PROJECT_DECK.nodes.map((card) => [card.id, card]));
    expect(byId.get('card_main_chat')?.runtimeOptions).toMatchObject({
      subagentType: 'none',
      modelKey: 'gpt-5.6-sol',
      tools: [
        'canvas.inspect',
        'project_graph.list_entities',
        'project_graph.read_entity_context',
        'worldview.set_capability',
      ],
    });
    expect(byId.get('card_main_chat')?.prompt).toContain(
      'Project Entity/Relationship map as the current shape',
    );
    expect(byId.get('card_main_chat')?.prompt).toContain(
      'granted project_graph read operations',
    );
    expect(byId.get('card_main_chat')?.prompt).toContain(
      'do not paste raw source lists unless the user explicitly asks',
    );
    expect(byId.get('card_main_chat')?.prompt).toContain(
      'Do not tell KnowGraph not to write graphs or memories',
    );
    expect(byId.get('card_main_chat')?.prompt).toContain(
      'Unless the user explicitly prohibits Project-knowledge persistence itself',
    );
    expect(byId.get('card_main_chat')?.prompt).toContain(
      'The Know inspector owns provenance and record detail',
    );
    expect(byId.get('card_main_chat')?.prompt).toContain(
      'do not call ThinkGraph to retrieve, refresh, confirm, or persist ordinary per-turn context',
    );
    expect(byId.get('card_main_chat')?.prompt).toContain(
      'broader historical summary across multiple prior Thinks',
    );
    expect(byId.get('card_main_chat')?.prompt).toContain(
      'Do not call ThinkGraph to perform, trigger, refresh, or confirm automatic completed-turn capture',
    );
    expect(byId.get('builder')?.runtimeOptions).toMatchObject({
      subagentType: 'none',
      modelKey: 'gpt-5.6-sol',
      skills: ['agent-builder-inspection'],
      toolsets: ['web', 'terminal', 'file', 'browser', 'vision', 'code_execution'],
    });
    expect(byId.get('card_thinkgraph')?.runtimeOptions?.tools).toEqual([
      'engraphis_recall_context',
      'engraphis_get_memory',
      'engraphis_remember_entities',
      'engraphis_discover_actions',
      'engraphis_execute_read',
    ]);
    expect(byId.get('card_thinkgraph')?.prompt).toContain(
      'OUTPUT_SCHEMA plus EXTRACTION_PROMPT means automatic completed-pair extraction',
    );
    expect(byId.get('card_thinkgraph')?.prompt).toContain(
      'An explicit summary is not a new Think',
    );
    expect(byId.get('card_thinkgraph')?.prompt).toContain(
      'Explicit summary output: a concise read-only synthesis',
    );
    expect(byId.get('card_thinkgraph')?.prompt).toContain(
      'never more than one Think for the same Entity in that turn',
    );
    expect(byId.get('card_thinkgraph')?.prompt).toContain(
      'Put one simple, concise, self-contained paragraph in think.summary',
    );
    expect(byId.get('card_thinkgraph')?.prompt).toContain(
      'For automatic intake, recover and steelman only the completed User/Main pair',
    );
    expect(byId.get('card_thinkgraph')?.prompt).not.toContain(
      'use the most Relevant Think first',
    );
    expect(byId.get('card_thinkgraph')?.prompt).not.toContain(
      'One Think may relate to several Entities',
    );
    expect(byId.get('card_team')?.runtimeOptions).toMatchObject({
      modelKey: 'gpt-5.6-terra',
      tools: [
        'canvas.inspect',
        'engraphis_recall_context',
        'engraphis_get_memory',
        'graphiti.search_nodes',
        'graphiti.search_memory_facts',
        'graphiti.get_episodes',
      ],
    });
    expect(byId.get('card_knowgraph')?.runtimeOptions).toMatchObject({
      modelKey: 'gpt-5.6-sol',
      subagentType: 'none',
      tools: expect.arrayContaining([
        'graphiti.add_know',
        'graphiti.get_know',
        'graphiti.get_entity_knows',
        'graphiti.get_status',
        'graphiti.search_knows',
      ]),
      toolsets: ['web'],
    });
    expect(byId.get('card_knowgraph')?.runtimeOptions?.skills).toEqual([
      'grounded-citations',
    ]);
    expect(byId.get('card_knowgraph')?.prompt).toContain(
      'One Know is one first-class durable Graphiti object',
    );
    expect(byId.get('card_knowgraph')?.prompt).toContain(
      'Do not create another team, board, scheduler, worker pool, or delegation path',
    );
    expect(byId.get('card_knowgraph')?.prompt).toContain(
      'preserve the returned final or resolved URL exactly',
    );
    expect(byId.get('card_knowgraph')?.prompt).toContain(
      'When retrieval does not return a usable final URL and matching passage, do not persist that finding',
    );
    expect(byId.get('card_knowgraph')?.prompt).not.toContain(
      'use the saved grounded-citations skill',
    );
    expect(byId.get('card_knowgraph')?.prompt).not.toContain('For and Against');
    expect(byId.get('card_knowgraph')?.prompt).not.toContain('two-sided cited record');
    expect(byId.get('card_knowgraph')?.prompt).toContain(
      'the Know inspector, not the chat answer, presents citations and Graphiti record detail',
    );
    expect(byId.get('card_knowgraph')?.prompt).toContain(
      'omit persistence logistics instead of claiming completion',
    );
  });

  it('returns an independent document copy for every Project creation', () => {
    const first = createDefaultProjectDeck();
    const second = createDefaultProjectDeck();
    first.nodes[0].title = 'Changed locally';
    first.edges.length = 0;

    expect(second).toEqual(DEFAULT_PROJECT_DECK);
    expect(DEFAULT_PROJECT_DECK.nodes[0].title).toBe('Main');
    expect(DEFAULT_PROJECT_DECK.edges).toHaveLength(2);
  });

  it('accepts server revision metadata but rejects any changed seed behavior', () => {
    const persisted = createDefaultProjectDeck();
    for (const [index, card] of persisted.nodes.entries()) {
      card.enabled = true;
      card._cardRevisionId = `revision-${index}`;
      card._cardRevision = 1;
      card._cardRevisionSha256 = `hash-${index}`;
      card.runtimeOptions = {
        ...card.runtimeOptions,
        tools: card.runtimeOptions?.tools ?? [],
        toolsets: card.runtimeOptions?.toolsets ?? [],
      };
    }
    persisted.edges = persisted.edges.map((edge) => ({ ...edge, enabled: true }));

    expect(isDefaultProjectDeckReadback(persisted)).toBe(true);
    persisted.nodes[0].runtimeOptions = {
      ...persisted.nodes[0].runtimeOptions,
      tools: ['unexpected.tool'],
    };
    expect(isDefaultProjectDeckReadback(persisted)).toBe(false);
  });
});
