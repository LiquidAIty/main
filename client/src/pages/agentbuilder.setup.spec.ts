import { describe, expect, it } from 'vitest';

import type { AgentCardInstance, DeckDocument } from '../types/agentgraph';
import {
  buildAssistStarterDeckMutation,
  buildQuickAddDeckMutation,
} from './agentbuilder';
import {
  findDeckNodePreset,
  getAssistStarterRecipe,
  getCommonAssistNextPresetKeys,
} from '../components/builder/deckPresets';
import { buildExecutionPlan } from '../components/builder/deckExecution';
import { sanitizeDeckEdges } from '../components/builder/deckValidation';

function createAgent(
  id: string,
  title: string,
  runtimeBinding: AgentCardInstance['runtimeBinding'],
  templateId = 'template_main_chat',
): AgentCardInstance {
  return {
    id,
    kind: 'agent',
    templateId,
    prompt: '',
    runtimeBinding,
    title,
    position: { x: 0, y: 0 },
  };
}

function createDeck(nodes: AgentCardInstance[]): DeckDocument {
  return {
    id: 'deck_setup',
    name: 'Deck Setup',
    promptTemplates: [],
    version: 1,
    nodes,
    edges: [],
  };
}

describe('agentbuilder quick setup', () => {
  it('surfaces common next-step roles for the active Assist flow nodes', () => {
    expect(
      getCommonAssistNextPresetKeys(
        createAgent('card_main_chat', 'Main Chat', 'main_chat', 'template_main_chat'),
      ),
    ).toEqual(['kg_ingest', 'summary', 'blackboard']);

    expect(
      getCommonAssistNextPresetKeys(
        createAgent('card_kg_ingest', 'ThinkGraph / Extract', 'kg_ingest', 'template_kg_ingest'),
      ),
    ).toEqual(['research', 'summary', 'blackboard']);

    expect(
      getCommonAssistNextPresetKeys(
        createAgent('card_research', 'Research Worker', 'research_agent', 'template_research'),
      ),
    ).toEqual(['blackboard', 'knowgraph', 'summary']);
  });

  it('builds the common Assist spine and worker writeback with visible links only', () => {
    const deck = createDeck([
      createAgent('card_main_chat', 'Main Chat', 'main_chat', 'template_main_chat'),
    ]);
    const thinkgraphPreset = findDeckNodePreset('kg_ingest');
    const researchPreset = findDeckNodePreset('research');
    const blackboardPreset = findDeckNodePreset('blackboard');
    const summaryPreset = findDeckNodePreset('summary');

    expect(thinkgraphPreset).toBeTruthy();
    expect(researchPreset).toBeTruthy();
    expect(blackboardPreset).toBeTruthy();
    expect(summaryPreset).toBeTruthy();

    const thinkgraphMutation = buildQuickAddDeckMutation(
      deck,
      thinkgraphPreset!,
      'card_main_chat',
    );
    const researchMutation = buildQuickAddDeckMutation(
      thinkgraphMutation.nextDeck,
      researchPreset!,
      thinkgraphMutation.nextNode.id,
    );
    const boardMutation = buildQuickAddDeckMutation(
      researchMutation.nextDeck,
      blackboardPreset!,
      researchMutation.nextNode.id,
    );
    const summaryMutation = buildQuickAddDeckMutation(
      researchMutation.nextDeck,
      summaryPreset!,
      researchMutation.nextNode.id,
    );

    expect(boardMutation.nextDeck.edges.map((edge) => `${edge.source}->${edge.target}`)).toEqual([
      `card_main_chat->${thinkgraphMutation.nextNode.id}`,
      `${thinkgraphMutation.nextNode.id}->${researchMutation.nextNode.id}`,
      `${researchMutation.nextNode.id}->${boardMutation.nextNode.id}`,
    ]);

    expect(buildExecutionPlan(boardMutation.nextDeck).simpleOrderCardIds).toEqual([
      'card_main_chat',
      thinkgraphMutation.nextNode.id,
      researchMutation.nextNode.id,
    ]);

    expect(summaryMutation.nextDeck.edges.map((edge) => `${edge.source}->${edge.target}`)).toEqual([
      `card_main_chat->${thinkgraphMutation.nextNode.id}`,
      `${thinkgraphMutation.nextNode.id}->${researchMutation.nextNode.id}`,
      `${researchMutation.nextNode.id}->${summaryMutation.nextNode.id}`,
    ]);

    expect(buildExecutionPlan(summaryMutation.nextDeck).simpleOrderCardIds).toEqual([
      'card_main_chat',
      thinkgraphMutation.nextNode.id,
      researchMutation.nextNode.id,
      summaryMutation.nextNode.id,
    ]);
  });

  it('builds the full Assist starter recipe as plain nodes and plain visible links only', () => {
    const mutation = buildAssistStarterDeckMutation(createDeck([]), null);

    expect(mutation).toBeTruthy();
    expect(mutation?.recipe.presetKeys).toEqual([
      'main_chat',
      'kg_ingest',
      'research',
      'summary',
      'blackboard',
    ]);
    expect(mutation?.createdNodes.map((node) => node.title)).toEqual([
      'Main Chat',
      'ThinkGraph / Extract',
      'Research Worker',
      'Summary Step',
      'Blackboard',
    ]);
    expect(mutation?.createdEdges.map((edge) => `${edge.source}->${edge.target}`)).toEqual([
      `${mutation?.createdNodes[0].id}->${mutation?.createdNodes[1].id}`,
      `${mutation?.createdNodes[1].id}->${mutation?.createdNodes[2].id}`,
      `${mutation?.createdNodes[2].id}->${mutation?.createdNodes[3].id}`,
      `${mutation?.createdNodes[3].id}->${mutation?.createdNodes[4].id}`,
    ]);
    expect(mutation?.focusNodeId).toBe(mutation?.createdNodes[0].id);
    expect(buildExecutionPlan(mutation!.nextDeck).simpleOrderCardIds).toEqual(
      mutation!.createdNodes
        .filter((node) => node.kind !== 'blackboard')
        .map((node) => node.id),
    );
    expect(
      mutation?.createdEdges.every((edge) =>
        Object.keys(edge).sort().join(',') === 'id,source,target',
      ),
    ).toBe(true);
    expect(
      mutation?.createdNodes.every(
        (node) =>
          !('runtimePolicy' in node) &&
          !('blackboardReadFields' in (node as Record<string, unknown>)) &&
          !('blackboardWriteFields' in (node as Record<string, unknown>)),
      ),
    ).toBe(true);
  });

  it('creates truthful starter tail variants from selected Assist nodes and preserves save-load shape', () => {
    const mainChatDeck = createDeck([
      createAgent('card_main_chat', 'Main Chat', 'main_chat', 'template_main_chat'),
    ]);
    const tailMutation = buildAssistStarterDeckMutation(mainChatDeck, 'card_main_chat');

    expect(getAssistStarterRecipe(mainChatDeck.nodes[0])?.presetKeys).toEqual([
      'kg_ingest',
      'research',
      'summary',
      'blackboard',
    ]);
    expect(tailMutation?.createdEdges.map((edge) => `${edge.source}->${edge.target}`)).toEqual([
      `card_main_chat->${tailMutation?.createdNodes[0].id}`,
      `${tailMutation?.createdNodes[0].id}->${tailMutation?.createdNodes[1].id}`,
      `${tailMutation?.createdNodes[1].id}->${tailMutation?.createdNodes[2].id}`,
      `${tailMutation?.createdNodes[2].id}->${tailMutation?.createdNodes[3].id}`,
    ]);
    expect(tailMutation?.focusNodeId).toBe(tailMutation?.createdNodes[0].id);

    const persistedDeck = JSON.parse(JSON.stringify(tailMutation?.nextDeck));
    expect(persistedDeck.nodes).toEqual(tailMutation?.nextDeck.nodes);
    expect(sanitizeDeckEdges(persistedDeck.edges)).toEqual(tailMutation?.nextDeck.edges);
  });
});
