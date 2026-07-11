import type { AgentCardInstance, DeckEdge, PromptTemplate } from '../types';

export const MAIN_CHAT_CARD_ID = 'card_main_chat';
export const MAIN_CHAT_PROMPT_ID = 'prompt_main_chat';
export const MAIN_CHAT_TEMPLATE_ID = 'template_main_chat';
export const MAIN_CHAT_CONTROL_EDGE_ID = 'edge_main_chat_magentic_control';
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
    'Your working context: read-only graph tools (ThinkGraph project reasoning, KnowGraph grounded knowledge, CodeGraph repository reality), canvas/agent metadata, and the current job folder under coder-workspace/handoff/<jobId>/.',
    'Your direct subagents are the cards orange-connected to you on the canvas (native Agent invocations). Invoke Hermes — your background context/planning steward — when a turn benefits from deeper preparation: memory enrichment, research shaping, draft work. Invoke the Coder directly only for a bounded coding task the user has agreed to. Model judgment decides; there is no fixed cadence and no required call per turn.',
    '',
    'Hermes prepares useful working files under handoff/<jobId>/ (draft.md, context.md, sources.md, screenshots/documents, code notes, and other bounded artifacts). Review, question, edit, remove, or replace those files before execution. The final prompt.md is written last and is the only semantic start signal.',
    'Execution happens ONLY when the user explicitly asks to run the team in this conversation. Then use write_mag_one_instructions to create the final prompt.md last, and call mcp__liquidaity__run_mag_one with jobId, projectId, and deckId. The backend resolves the live worker roster from blue side edges — never type a roster by hand. Mag One reads prompt.md and referenced files, plans its own team decomposition, and writes results under returns/<jobId>/<cardId>/.',
    '',
    'Hard rules:',
    '- Never claim a run, graph write, code change, or tool execution that a real returned result does not show. No result → say it failed or is blocked, and why.',
    '- Never start a team run without an explicit user request in this conversation; Hermes readiness alone is never authority.',
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
        'read_thinkgraph_scope',
        'retrieve_knowgraph_context',
        'codegraph_search',
        'codegraph_status',
        'canvas.inspect',
        'write_mag_one_instructions',
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
  };
}

/** Main Chat's CONTROL connection to the Mag One bus: the dedicated top input
 * that submits the finalized prompt. Never a side worker slot — Main Chat is
 * structurally not a worker. */
export function buildMainChatControlEdge(): DeckEdge {
  return {
    id: MAIN_CHAT_CONTROL_EDGE_ID,
    source: MAIN_CHAT_CARD_ID,
    sourceHandle: null,
    target: 'card_magentic',
    targetHandle: 'task-bus-top',
    edgeType: 'magentic_control',
  };
}
