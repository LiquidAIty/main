import type {
  AgentCardInstance,
  AgentTemplate,
  DeckDocument,
} from '../../types/agentgraph';

/**
 * Compact OWL-shaped graph payload a model emits alongside human text whenever it
 * produces reusable knowledge. JSON is transport; OWL classes/relations are the
 * semantic layer; a property graph (nodes/edges/properties) is the storage target.
 * This is the shape downstream local SLM graph extraction normalizes.
 */
export type OwlShapedGraphPayload = {
  targetGraph: 'thinkgraph' | 'knowgraph' | 'codegraph';
  inputKind: string;
  sourceRef: string;
  entities: Array<{
    id?: string;
    label: string;
    type: string;
    evidence?: string;
    confidence?: number;
    uncertainty?: string | number | string[];
  }>;
  relations: Array<{
    from: string;
    to: string;
    type: string;
    evidence?: string;
    confidence?: number;
    uncertainty?: string | number | string[];
  }>;
  categories?: string[];
  assertions?: Array<{
    subject?: string;
    predicate?: string;
    object?: string;
    evidence?: string;
    confidence?: number;
    uncertainty?: string | number | string[];
  }>;
  sourceRefs: Array<{ ref: string; kind?: string }>;
  confidence?: number;
  uncertainty?: string[];
  nextSearchSeedCandidates?: string[];
  graphDelta?: { adds?: unknown[]; updates?: unknown[]; conflicts?: unknown[]; rejected?: unknown[] };
  taskDelta?: { proposedTasks?: unknown[]; updatedTasks?: unknown[]; blockedTasks?: unknown[] };
  proofRefs?: string[];
};

/**
 * Reusable OWL-shaped output contract. Drop into any model/worker system prompt so its
 * output is graph-ready: JSON transport, OWL-style classes/relations as the semantic
 * layer, property-graph nodes/edges/properties as the storage target. Honest by
 * construction — no invented facts, evidence/sourceRefs preserved, uncertainty marked,
 * empty arrays over fabrication, unavailable marked rather than faked.
 */
export const OWL_SHAPED_OUTPUT_CONTRACT = `OWL-shaped graph-ready output contract.

Transport: JSON is the transport format — return well-formed JSON.
Semantic layer: organize meaning with OWL-style classes (a node's "type") and relations
(an edge's "type"). Entities are individuals of a class; relations are typed object
properties between them; assertions are subject-predicate-object triples.
Storage target: this maps to a property graph — entities become nodes, relations become
edges, scalar fields become node/edge properties.

Whenever you produce reusable knowledge, also emit it as a structured graph payload (the
OwlShapedGraphPayload below) — not only prose. Human-readable text is allowed, but
reusable knowledge MUST also appear as structured JSON.

Honesty rules — assert what is present, never invent what is unknown:
- ASSERT graph facts that are explicitly present in the user text, task objects, prompt,
  graph context, or tool results: named things become entities (each with a class/type), and
  the relationships stated or clearly implied between them become relations. Attach sourceRef
  and evidence to each.
- Do not return empty entities/relations when the input contains explicit graph-worthy
  entities and relationships. Return empty arrays ONLY when there is genuinely no reusable
  graph content.
- Do not invent unknown facts: a current price with no live quote source, a current valuation
  with no source, proof that was not run, or repo files not in context.
- A named entity and its stated class or relationship is NOT an invention, even when a
  specific value about it (a price, a valuation) is unknown. Assert the entity/relation and
  put the missing value in the uncertainty field AND keep a task that fetches it — never assert
  a guessed value to fill a slot. Every unsourced unknown (a current price or valuation you did
  not fetch) gets a short note in the top-level uncertainty array, not just a task.
- A value you cannot source as current must be rejected or marked stale, never presented as
  current.
- Set sourceRef/sourceRefs to where the facts came from (the user request, a named tool
  result, a graph context id); do not leave them empty when you assert facts drawn from input.
- Preserve evidence. If graph context is unavailable, mark it unavailable instead of pretending.

OwlShapedGraphPayload shape:
{
  "targetGraph": "thinkgraph" | "knowgraph" | "codegraph",
  "inputKind": "string",
  "sourceRef": "string",
  "entities": [{ "id": "", "label": "", "type": "", "evidence": "", "confidence": 0, "uncertainty": "" }],
  "relations": [{ "from": "", "to": "", "type": "", "evidence": "", "confidence": 0, "uncertainty": "" }],
  "categories": [],
  "assertions": [{ "subject": "", "predicate": "", "object": "", "evidence": "", "confidence": 0 }],
  "sourceRefs": [{ "ref": "", "kind": "" }],
  "confidence": 0,
  "uncertainty": [],
  "nextSearchSeedCandidates": []
}

Use stable field names, entity labels, class/type names, relation names, sourceRefs,
confidence, uncertainty, and nextSearchSeedCandidates so a downstream local SLM graph
extraction worker can normalize the output without guessing.`;

/**
 * Magentic-One / planner-specific OWL-shaped instruction block. Builds on the reusable
 * contract above with task-ledger-specific graph vocabulary and grounding rules.
 */
export const MAG_ONE_OWL_TASK_LEDGER_CONTRACT = `Magentic-One Task Ledger + OWL-shaped planning payload.

When graph context (CodeGraph, ThinkGraph, SkillGraph, KnowGraph) is provided, READ it
before tasking. Prefer tasks grounded in real files/symbols, project memory, and proven
skills. Do not invent repo files or claim proof that does not exist. Do not create tasks
without grounding when graph context is available. Do not classify user intent with
deterministic rules or regex routing — reason from the real provided context.

Produce Task Ledger output as explicit task objects (never fake chat status), AND an
OWL-shaped graph payload capturing the reusable planning knowledge.

Planning graph vocabulary (use these OWL classes/relations):
- entity types: project, task, file, skill, blocker, model, graph, source, decision
- relation types: depends_on, modifies, blocked_by, uses_skill, proves, writes_to,
  reads_from, supersedes

Task Ledger graphPayload minimum: when the request names concrete subjects and relationships
— companies, tickers, research topics, the tasks themselves, the data sources a task
requires, the agents/tools/workflow — the graphPayload MUST represent them as entities and
relations. Do not leave entities/relations empty while planFlowTaskObjects is full; the
planning subjects and their typed relationships are graph-worthy facts that belong in the
graph. Use uncertainty for values you cannot source (an unknown current price or valuation),
and keep a task that fetches the unknown value rather than asserting a guessed value.

Preserve sourceRefs from CodeGraph, ThinkGraph, SkillGraph, KnowGraph, user text, and
tool results. Mark uncertainty instead of guessing. Keep private reasoning separate from
user-facing task text.`;

/**
 * Magentic-One card prompt-chain step 4: the default, editable PlanFlow task-object
 * output contract — now OWL-shaped so Mag One output is graph-ready before the local SLM
 * receives it. This is the CARD-CONFIG default (surfaced and editable in the Magentic-One
 * card inspector). It is NOT owned by the backend or Python — those only transport/consume
 * whatever the card carries. The post-Mag-One structured pass uses this as the JSON-only
 * output contract.
 */
export const DEFAULT_PLANFLOW_TASK_OUTPUT_CONTRACT = `PlanFlow task-object output contract.

Alongside the standard Magentic-One Task Ledger (team composition, facts, plan, and
agent responsibilities — never omit or hide connected agents), produce a separate
PlanFlow task-object artifact for the workbench canvas, plus an OWL-shaped graph payload.

${OWL_SHAPED_OUTPUT_CONTRACT}

${MAG_ONE_OWL_TASK_LEDGER_CONTRACT}

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
  ],
  "graphPayload": {
    "targetGraph": "thinkgraph",
    "inputKind": "task_ledger_planning",
    "sourceRef": "",
    "entities": [],
    "relations": [],
    "categories": [],
    "sourceRefs": [],
    "confidence": 0,
    "uncertainty": [],
    "nextSearchSeedCandidates": []
  }
}

Rules:
- Task objects and graphPayload must be explicit structured output, not parsed or
  rewritten chat text.
- Do not create completed statuses unless real proof exists.
- Do not invent repo files, sources, skills, or proof. But DO assert into graphPayload the
  entities and relations explicitly present in the request; return empty graph arrays only
  when there is genuinely no graph-worthy content.
- Do not omit agent/team context; do not hide connected agents.
- If there is no actionable work, return {"planFlowTaskObjects": [], "graphPayload": { ... empty ... }}.`;

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
