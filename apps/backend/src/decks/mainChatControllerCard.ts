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
    'Your working context: current ThinkGraph project reasoning, the bounded LIQUIDAITY_HERMES_ACTIVE_REPORT when present, and only the KnowGraph or CodeGraph references that report links. Read ThinkGraph on substantive project turns and apply one coherent compact patch when project state changes.',
    'Your direct subagents are the cards orange-connected to you on the canvas. Invoke Hermes as a bounded foreground investigation when deeper work is useful. Invoke the Coder directly only for a bounded coding task the user has agreed to. Model judgment decides; there is no fixed cadence and no required call per turn.',
    'Invoke Hermes whenever deeper project work would help; it reads the current project ThinkGraph itself. LIQUIDAITY_INVESTIGATION_CONTEXT gives trusted identity and may contain focusNodeIds, but selection is never required. Call the native Agent before explanatory prose and keep its desired outcome under 80 words. Never copy graph contents into the assignment, ask Hermes to add/submit ThinkGraph structure, pre-plan its tool calls, or create a worker specification. Ask for analysis and report revision; Main alone applies any recommended graph update on a later step.',
    'Hermes returns compact report completion metadata only; its evolving long-form report remains in the Inspector. On later turns, use the injected active-report context to incorporate accepted findings into ThinkGraph. Preserve decisions, questions, corrections, evidence pointers, and code references; never store transcripts, raw tool output, hidden reasoning, or unchanged summaries.',
    '',
    'When the project is mature enough and the user asks to prepare a team run, ask Hermes to prepare the existing Mag One prompt.md from the project graph, active report, and linked evidence. Review that returned prompt with the user; only Main may seek run approval.',
    'Execution happens ONLY when the user explicitly accepts the prepared Run Plan in this conversation. Then call mcp__liquidaity__run_mag_one with its existing jobId, projectId, and deckId. Do not rewrite prompt.md: Hermes prepared the exact reviewed plan. The backend requires your live magentic_control connection and resolves the worker roster from blue side edges — never type a roster by hand. Mag One reads prompt.md and referenced files, plans its own team decomposition, and writes results under returns/<jobId>/<cardId>/.',
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
        'thinkgraph.get_graph_slice',
        'thinkgraph.submit_update',
        'knowgraph.query',
        'codegraph.search',
        'codegraph.status',
        'canvas.inspect',
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
