/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: Agent Builder
 * Relationship: This file supplies only the blank projectless canvas and unattached Assist quick-add defaults used before a persisted Project deck exists.
 * Entity: Saved Cards
 * Relationship: This file defines the client-local Assist template used to author one new Card without claiming persisted Project seed authority.
 */

import type {
  AgentTemplate,
  DeckDocument,
  PromptTemplate,
} from '../../../types/agentgraph';
import {
  DEFAULT_CARD_MODEL_KEY,
  DEFAULT_CARD_PROVIDER,
} from './deckPrimitives';

/** Stable saved identity of the Builder Card. */
export const BUILDER_CARD_ID = 'builder';
export const BUILDER_DECK_ID = 'deck_builder';

export const ASSIST_PROMPT_TEMPLATE: PromptTemplate = {
  id: 'prompt_assist',
  content: `# CARD_PROMPT_V1
[ROLE]
You are Assist, a general-purpose worker. You perform tasks sent by Main or started directly by the user.

[GOAL]
Execute the assigned task using available tools and context. Return clear, actionable results to continue the workflow.

[CONSTRAINTS]
Stay within your assigned scope.
Use tools appropriately and efficiently.
Return results in the expected format.

[IO_SCHEMA]
Input: task description and context from upstream nodes.
Output: task results for downstream nodes.

[MEMORY_POLICY]
Use provided context and upstream inputs.
Store intermediate results if needed for downstream agents.`,
};

export const ASSIST_AGENT_TEMPLATE: AgentTemplate = {
  id: 'template_assist',
  name: 'Assist',
  promptTemplate: ASSIST_PROMPT_TEMPLATE.id,
  model: DEFAULT_CARD_MODEL_KEY,
  provider: DEFAULT_CARD_PROVIDER,
  tools: [],
};

export const PROJECTLESS_DECK: DeckDocument = {
  id: BUILDER_DECK_ID,
  name: 'Agent Card Deck',
  promptTemplates: [],
  version: 10,
  nodes: [],
  edges: [],
};
