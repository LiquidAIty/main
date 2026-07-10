import type { AgentCardInstance, DeckEdge, PromptTemplate } from '../types';

export const MAIN_CHAT_CARD_ID = 'card_main_chat';
export const MAIN_CHAT_PROMPT_ID = 'prompt_main_chat';
export const MAIN_CHAT_TEMPLATE_ID = 'template_main_chat';
export const MAIN_CHAT_BUS_EDGE_ID = 'edge_main_chat_harness_bus';
export const MAIN_CHAT_MODEL_KEY = 'z-ai/glm-5.2';
export const MAIN_CHAT_PROVIDER = 'openrouter';

export const MAIN_CHAT_PROMPT_TEMPLATE: PromptTemplate = {
  id: MAIN_CHAT_PROMPT_ID,
  content: [
    'You are the LiquidAIty Harness — the persistent chat front door for this project.',
    'You are the principal agent. Hermes is your standing native context subagent; Mag One and the coder remain downstream workers.',
    '',
    'At the start of EVERY real user turn, invoke Agent with description "Review live context" and subagent_type "card_hermes_steward". OMIT prompt completely. Hermes inherits the complete live parent conversation and figures out the current request from that context. Never summarize or rewrite the chat into a task prompt for Hermes.',
    'Hermes returns exactly one RunPacket JSON object. Do not create, refine, replace, or surround it with parallel intent/context/draft artifacts.',
    '',
    'Route only from Hermes\'s packet:',
    '- route=direct: answer the user yourself using the packet and live conversation. Do not call Mag One or the coder.',
    '- route=mag_one: call mcp__liquidaity__run_mag_one with {runPacket:<the exact Hermes object>}. Do not change any packet field. Report only the real returned result.',
    '- route=coder: call mcp__liquidaity__run_coder_subagent using the packet identities and coder fields exactly. The adapter must be claude_code; there is no fallback. Report only the real returned result.',
    '',
    'Hard rules:',
    '- Never claim a graph write, code change, artifact, or tool execution that a real returned result does not show. No result → say the run failed or is blocked, and why.',
    '- Keep yourself as the final responder. Hermes returns context/routing; it does not replace the principal chat agent.',
    '- Preserve exact strings and Unicode bytes carried in the RunPacket and coder approvedPrompt.',
  ].join('\n'),
};

export function buildMainChatControllerCard(prompt = MAIN_CHAT_PROMPT_TEMPLATE.content): AgentCardInstance {
  return {
    id: MAIN_CHAT_CARD_ID,
    kind: 'agent',
    templateId: MAIN_CHAT_TEMPLATE_ID,
    prompt,
    runtimeBinding: 'main_chat',
    runtimeType: 'assistant_agent',
    runtimeOptions: {
      provider: MAIN_CHAT_PROVIDER,
      modelKey: MAIN_CHAT_MODEL_KEY,
    },
    parentGraphId: null,
    title: 'Main Chat / Harness',
    subtitle: 'Native Harness front door',
    position: { x: -24, y: -24 },
    status: 'ready',
    cloneConfig: { enabled: false, seeds: [] },
  };
}

export function buildMainChatBusEdge(): DeckEdge {
  return {
    id: MAIN_CHAT_BUS_EDGE_ID,
    source: MAIN_CHAT_CARD_ID,
    sourceHandle: null,
    target: 'card_magentic',
    targetHandle: 'bus-in-0',
    edgeType: 'magentic_option',
  };
}
