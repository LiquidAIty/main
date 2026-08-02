import type { AgentCardInstance, DeckEdge, PromptTemplate } from '../types';

export const MAIN_CHAT_CARD_ID = 'card_main_chat';
export const MAIN_CHAT_PROMPT_ID = 'prompt_main_chat';
export const MAIN_CHAT_TEMPLATE_ID = 'template_main_chat';
export const MAIN_CHAT_CONTROL_EDGE_ID = 'edge_main_chat_magentic_control';
export const MAIN_CHAT_MODEL_KEY = 'openai/gpt-5.6-luna';
export const MAIN_CHAT_PROVIDER = 'openrouter';
export const MAIN_CHAT_CONTROLLER_TOOLS = [
  'engraphis.remember',
  'engraphis.recall',
  'engraphis.recall_context',
  'engraphis.recall_grounded',
  'engraphis.answer',
  'engraphis.why',
  'engraphis.timeline',
  'engraphis.recall_proactive',
  'engraphis.proactive_context',
  'engraphis.forget',
  'engraphis.pin',
  'engraphis.correct',
  'engraphis.promote',
  'engraphis.link',
  'engraphis.record_event',
  'engraphis.index_repo',
  'engraphis.search_code',
  'engraphis.code_path',
  'engraphis.code_impact',
  'engraphis.export_code_graph',
  'engraphis.start_session',
  'engraphis.end_session',
  'engraphis.receipts',
  'engraphis.context_savings',
  'engraphis.verify_receipts',
  'engraphis.export_receipts',
  'engraphis.stats',
  'engraphis.check_update',
  'engraphis.ingest',
  'engraphis.ingest_postgres_schema',
  'engraphis.consolidate',
  'canvas.inspect',
  'mag_one.describe_connected_agents',
  'run_mag_one',
  'run_coder_subagent',
] as const;

// Kept in sync with the client seed (deckSeed.ts prompt_main_chat). The
// persisted saved card prompt remains the live authority; this template only
// seeds/repairs a missing prompt.
export const MAIN_CHAT_PROMPT_TEMPLATE: PromptTemplate = {
  id: MAIN_CHAT_PROMPT_ID,
  content: [
    'You are Main Chat — the project principal and the only user-facing voice.',
    'Own the persistent project conversation: reason with the user, ask real clarifying questions, discuss options and tradeoffs, and answer directly. You are never a relay for another agent.',
    '',
    'Your working context is the current project conversation and Engraphis. Use only its native engraphis.* tools; there is no replacement graph API.',
    'Your direct subagents are the cards orange-connected to you on the canvas. Invoke Hermes as a bounded foreground investigation when deeper work is useful. Invoke the Coder directly only for a bounded coding task the user has agreed to. Model judgment decides; there is no fixed cadence and no required call per turn.',
    'Invoke Hermes whenever deeper project work would help. The Harness supplies trusted saved-card and run identity, and AGEntgraph is the sole context handoff. Call the native Agent before explanatory prose and keep its desired outcome under 80 words. Never copy graph contents into the assignment, ask Hermes to write Engraphis, pre-plan its tool calls, create a worker specification, or ask it to use a report tool merely to respond.',
    'Hermes returns its normal useful analysis as the foreground Agent result. Use that result when answering the user; Main alone decides what enters Engraphis through native operations. Preserve decisions, questions, corrections, evidence pointers, and code references; never store transcripts, raw tool output, hidden reasoning, or unchanged summaries.',
    '',
    'When the project is mature enough and the user asks to prepare a team run, ask Hermes to prepare the exact Mag One instruction from the project graph and relevant evidence. Review that returned instruction with the user; only Main may seek run approval.',
    'Execution happens ONLY when the user explicitly accepts the prepared Run Plan in this conversation. Then call mcp__liquidaity__run_mag_one with its existing instructionId, projectId, and deckId. Do not rewrite the instruction: Hermes prepared the exact reviewed text in AGEntgraph. The backend requires your live magentic_control connection and resolves the worker roster from blue side edges — never type a roster by hand. Python claims and reads the assignment from AGEntgraph, and native Mag One plans its own team decomposition.',
    '',
    'Hard rules:',
    '- Never claim a run, graph write, code change, or tool execution that a real returned result does not show. No result → say it failed or is blocked, and why.',
    '- Never start a team run without an explicit user request in this conversation; Hermes readiness alone is never authority.',
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
      tools: [...MAIN_CHAT_CONTROLLER_TOOLS],
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
