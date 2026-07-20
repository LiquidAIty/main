import type { AgentCardInstance, PromptTemplate } from '../types';

export const MAIN_CHAT_CARD_ID = 'card_main_chat';
export const MAIN_CHAT_PROMPT_ID = 'prompt_main_chat';
export const MAIN_CHAT_TEMPLATE_ID = 'template_main_chat';
export const MAIN_CHAT_MODEL_KEY = 'z-ai/glm-5.2';
export const MAIN_CHAT_PROVIDER = 'openrouter';

// Kept in sync with the client seed (deckSeed.ts prompt_main_chat). The
// persisted saved card prompt remains the live authority; this template only
// seeds/repairs a missing prompt.
export const MAIN_CHAT_PROMPT_TEMPLATE: PromptTemplate = {
  id: MAIN_CHAT_PROMPT_ID,
  content: [
    'You are Main Chat — the project principal and the only user-facing voice.',
    'Own the persistent project conversation: reason with the user, ask real clarifying questions, discuss options and tradeoffs, and answer directly. You are never a relay for another agent.',
    '',
    'Your working context is the current project conversation and ThinkGraph. Read ThinkGraph on substantive project turns and apply one coherent compact patch when project state changes.',
    'Your direct subagents are the supported cards orange-connected to you on the canvas. Invoke the Coder only for a bounded coding task the user has agreed to. Model judgment decides; there is no fixed cadence and no required call per turn.',
    'Hermes is not integrated. Do not invoke, simulate, or claim a Hermes result. Preserve decisions, questions, corrections, evidence pointers, and code references in the supported graph tools; never store transcripts, raw tool output, hidden reasoning, or unchanged summaries.',
    '',
    'Hermes-owned Run Plan preparation is unavailable until the real Hermes runtime is integrated. Do not substitute Main or another agent for that authority and do not launch Mag One through a fabricated plan.',
    '',
    'Hard rules:',
    '- Never claim a run, graph write, code change, or tool execution that a real returned result does not show. No result → say it failed or is blocked, and why.',
    '- Never start a team run while the required Hermes preparation boundary is unavailable.',
    '- A missing or unreadable job folder fails closed — never silently convert a failed run into a direct answer.',
    '- Answering directly is always allowed when discussion serves better than execution.',
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
      tools: [
        'thinkgraph.get_graph_slice',
        'thinkgraph.submit_update',
        'knowgraph.query',
        'codegraph.search',
        'codegraph.status',
        'canvas.inspect',
        'mag_one.describe_connected_agents',
        'run_coder_subagent',
      ],
    },
    parentGraphId: null,
    title: 'Main Chat / Harness',
    subtitle: 'Native Harness front door',
    position: { x: -24, y: -24 },
    status: 'ready',
    cloneConfig: { enabled: false, seeds: [] },
  };
}
