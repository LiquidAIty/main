import type {
  AgentCardInstance,
  AgentTemplate,
  DeckDocument,
} from '../../types/agentgraph';

/**
 * Magentic-One card prompt-chain step 4: the default, editable PlanFlow
 * task-object output contract. This is the CARD-CONFIG default (surfaced and
 * editable in the Magentic-One card inspector). It is NOT owned by the backend
 * or Python — those only transport/consume whatever the card carries. The
 * post-Mag-One structured pass uses this as a JSON-only output contract.
 */
export const DEFAULT_PLANFLOW_TASK_OUTPUT_CONTRACT = `PlanFlow task-object output contract.

Alongside the standard Magentic-One Task Ledger (team composition, facts, plan, and
agent responsibilities — never omit or hide connected agents), produce a separate
PlanFlow task-object artifact for the workbench canvas.

Return ONLY a JSON object of this exact shape and nothing else:
{
  "planFlowTaskObjects": [
    {
      "id": "stable short id",
      "title": "short task title",
      "detail": "one concise task detail",
      "status": "proposed",
      "stepNumber": 1,
      "dependsOn": ["other task ids"],
      "approvalRequired": false,
      "nextNeeded": "next action",
      "proofNeeded": "what proof would show completion"
    }
  ]
}

Rules:
- Task objects must be explicit structured output, not parsed or rewritten chat text.
- Do not create completed statuses unless real proof exists.
- Do not omit agent/team context; do not hide connected agents.
- If there is no actionable work, return {"planFlowTaskObjects": []}.`;

/**
 * Ensure every Magentic-One card carries an explicit PlanFlow task-output
 * contract in its runtimeOptions before a run. The card's own value is the
 * editable source of truth (inspector); this only fills the visible default
 * when a card has none, so an un-edited deck still emits structured tasks.
 * Returns the same document untouched when nothing needs filling.
 */
export function withMagenticTaskLedgerContractDefault(
  document: DeckDocument,
): DeckDocument {
  const nodes = Array.isArray(document.nodes) ? document.nodes : [];
  let changed = false;
  const nextNodes = nodes.map((node) => {
    if (node.runtimeType !== 'magentic_one') return node;
    const existing = String(node.runtimeOptions?.taskLedgerOutputContract || '').trim();
    if (existing) return node;
    changed = true;
    return {
      ...node,
      runtimeOptions: {
        ...(node.runtimeOptions || {}),
        taskLedgerOutputContract: DEFAULT_PLANFLOW_TASK_OUTPUT_CONTRACT,
      },
    };
  });
  return changed ? { ...document, nodes: nextNodes } : document;
}

export function resolveEffectiveAgent(
  card: AgentCardInstance,
  templates: AgentTemplate[],
): AgentTemplate | null {
  const template = templates.find((item) => item.id === card.templateId);
  if (!template) return null;

  const overrides = card.overrides || {};
  const selectedTools = Array.isArray(card.runtimeOptions?.tools)
    ? card.runtimeOptions.tools
    : Array.isArray(card.tools)
      ? card.tools
      : [];
  return {
    ...template,
    ...overrides,
    tools: selectedTools,
    skills: Array.isArray(overrides.skills) ? overrides.skills : template.skills,
    personas: Array.isArray(overrides.personas) ? overrides.personas : template.personas,
    knowledgeSources: Array.isArray(overrides.knowledgeSources)
      ? overrides.knowledgeSources
      : template.knowledgeSources,
    ioSchema:
      overrides.ioSchema && typeof overrides.ioSchema === 'object'
        ? overrides.ioSchema
        : template.ioSchema,
  };
}
