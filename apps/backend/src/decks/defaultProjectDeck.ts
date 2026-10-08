export const DEFAULT_PROJECT_DECK_ID = 'deck_builder';

export const DEFAULT_PROJECT_CARDS = [
  { cardId: 'card_main_chat', profile: 'main', x: -24, y: -24 },
  { cardId: 'builder', profile: 'builder', x: 360, y: -80 },
  { cardId: 'card_thinkgraph', profile: 'thinkgraph', x: -260, y: 120 },
  { cardId: 'card_magentic', profile: 'card_magentic', x: 140, y: 120 },
  { cardId: 'card_team', profile: 'team', x: 600, y: 340 },
  { cardId: 'card_knowgraph', profile: 'knowgraph', x: 260, y: 480 },
] as const;

export const DEFAULT_PROJECT_EDGES = [
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
] as const;
