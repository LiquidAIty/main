export type PlanItem = { id: string; text: string; status: "draft" | "approved" | "done" };

export type LinkRef = {
  id: string;
  title: string;
  url: string;
  src: string;
  accepted: boolean;
  ts: number;
};

export type AnchorSurface = {
  anchor: string;
  whatChanged: string[];
  openQuestions: string[];
  sources: string[];
};

export type PlanContractMode =
  | "active_run"
  | "draft"
  | "meta"
  | "template"
  | "archived";

export type PlanStepStatus =
  | "proposed"
  | "approved"
  | "running"
  | "blocked"
  | "done";

export type StructuredAssistPlanStep = {
  id: string;
  title: string;
  status: PlanStepStatus;
  assignedAgentId: string | null;
  skillId: string | null;
  toolIds: string[];
  generatedPrompt: string;
  expectedOutput: string;
  relatedFiles: string[];
  relatedObjects: string[];
  relatedSurface: string | null;
  validationCommand: string | null;
  approvalRequired: boolean;
  resultSummary: string;
  blocker: string;
};

export type StructuredAssistPlanSurface = {
  planMode: PlanContractMode;
  goal: string;
  steps: StructuredAssistPlanStep[];
  whatMattersNow: string[];
  nextMove: string[];
  assumptions: string[];
  research: string[];
  openQuestions: string[];
  humanTasks: string[];
  agentTasks: string[];
  pathOptions: string[];
  explicitPlanText: string;
  hasExplicitPlanDocument: boolean;
  whatChanged: string[];
  sources: string[];
};

function safeText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    const json = JSON.stringify(value);
    if (typeof json === "string") return json;
  } catch {
    // fallback below
  }
  return String(value);
}

const uid = () => Math.random().toString(36).slice(2, 8);

function normalizePlanMode(value: unknown): PlanContractMode {
  const mode = safeText(value).trim().toLowerCase();
  if (
    mode === "active_run" ||
    mode === "draft" ||
    mode === "meta" ||
    mode === "template" ||
    mode === "archived"
  ) {
    return mode;
  }
  return "draft";
}

function normalizePlanStepStatus(value: unknown): PlanStepStatus {
  const status = safeText(value).trim().toLowerCase();
  if (
    status === "proposed" ||
    status === "approved" ||
    status === "running" ||
    status === "blocked" ||
    status === "done"
  ) {
    return status;
  }
  if (status === "complete") return "done";
  if (status === "awaiting_review" || status === "review") return "approved";
  if (status === "ready" || status === "seeded") return "proposed";
  return "proposed";
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const normalized = safeText(value).trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

const PLAN_RUNTIME_NOISE_PATTERNS = [
  /\bautogen(?:[_:\-\s]|$)/i,
  /\bhttp[_:\-\s]?500\b/i,
  /\bparticipants_required\b/i,
  /\bassistant_tool_not_supported\b/i,
  /\bmagentic_callable_heads_required\b/i,
  /\binternal server error\b/i,
  /\bhealth check failed\b/i,
] as const;

function isPlanRuntimeNoise(value: string): boolean {
  const normalized = safeText(value).trim();
  if (!normalized) return false;
  return PLAN_RUNTIME_NOISE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function sanitizePlanText(value: unknown): string {
  const normalized = safeText(value).trim();
  if (!normalized || isPlanRuntimeNoise(normalized)) return "";
  return normalized;
}

function sanitizePlanTextList(input: unknown): string[] {
  return normalizeTextList(input).filter((entry) => !isPlanRuntimeNoise(entry));
}

export function normalizePlanItems(input: unknown): PlanItem[] {
  const source = Array.isArray(input)
    ? input
    : input && typeof input === "object"
      ? Array.isArray((input as any).tasks)
        ? (input as any).tasks
        : Array.isArray((input as any).items)
          ? (input as any).items
          : []
      : [];
  const out: PlanItem[] = [];
  source.forEach((item: any, idx: number) => {
    const text = safeText(item?.text ?? item?.title ?? item).trim();
    if (!text) return;
    const statusRaw = safeText(item?.status ?? item?.state).toLowerCase();
    const status: PlanItem["status"] =
      statusRaw === "approved" || statusRaw === "done" ? (statusRaw as PlanItem["status"]) : "draft";
    out.push({
      id: safeText(item?.id).trim() || `plan_${idx}_${uid()}`,
      text,
      status,
    });
  });
  return out;
}

export function normalizeLinks(input: unknown): LinkRef[] {
  if (!Array.isArray(input)) return [];
  const out: LinkRef[] = [];
  input.forEach((item: any, idx) => {
    const id = safeText(item?.id).trim() || `link_${idx}_${uid()}`;
    const title = safeText(item?.title).trim() || "Untitled";
    const url = safeText(item?.url).trim();
    if (!url) return;
    const src = safeText(item?.src).trim();
    const accepted = Boolean(item?.accepted);
    const tsNum = Number(item?.ts);
    out.push({
      id,
      title,
      url,
      src,
      accepted,
      ts: Number.isFinite(tsNum) ? tsNum : Date.now(),
    });
  });
  return out;
}

export function normalizeTextList(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input
      .map((item: any) => safeText(item?.text ?? item?.title ?? item).trim())
      .filter(Boolean);
  }
  if (typeof input === "string") {
    return input
      .split(/\r?\n+/)
      .map((line) => line.replace(/^[-*]\s*/, "").trim())
      .filter(Boolean);
  }
  if (input && typeof input === "object") {
    const text = safeText((input as any).text ?? (input as any).title).trim();
    return text ? [text] : [];
  }
  return [];
}

export function matchesExplicitTaskExecutor(value: unknown, expected: "human" | "agent"): boolean {
  const normalized = safeText(value).trim().toLowerCase();
  if (!normalized) return false;
  if (expected === "human") {
    return normalized === "human" || normalized === "user" || normalized === "person";
  }
  return (
    normalized === "agent" ||
    normalized === "assistant" ||
    normalized === "ai" ||
    normalized === "automation" ||
    normalized === "system"
  );
}

export function normalizeTypedTaskList(input: unknown, expected: "human" | "agent"): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item: any) => {
      const executor =
        item?.executorType ??
        item?.executor_type ??
        item?.executor ??
        item?.ownerType ??
        item?.owner_type;
      if (!matchesExplicitTaskExecutor(executor, expected)) return "";
      return safeText(item?.text ?? item?.title ?? item).trim();
    })
    .filter(Boolean);
}

export function pickExplicitPlanText(input: unknown): string {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const planObj = input as any;
    return safeText(
      planObj.anchor ??
      planObj.anchorText ??
      planObj.anchor_text ??
      planObj.planWiki ??
      planObj.plan_wiki ??
      planObj.memo ??
      planObj.article ??
      planObj.summary ??
      planObj.body ??
      planObj.text,
    ).trim();
  }
  if (typeof input === "string") {
    return input.trim();
  }
  return "";
}

export function hasExplicitPlanDocument(input: unknown): boolean {
  if (pickExplicitPlanText(input)) return true;
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const planObj = input as any;
  return Boolean(
    planObj.editorState ??
    planObj.editor_state ??
    planObj.lexical ??
    planObj.lexicalState ??
    planObj.lexical_state ??
    planObj.planWikiState ??
    planObj.plan_wiki_state ??
    planObj.documentState ??
    planObj.document_state ??
    planObj.document,
  );
}

export function buildStructuredAssistPlanSurface(
  input: unknown,
  context: {
    planItems?: PlanItem[];
    anchorSurface?: AnchorSurface;
  } = {},
): StructuredAssistPlanSurface {
  const planObj = input && typeof input === "object" && !Array.isArray(input) ? (input as any) : null;
  const planItems = Array.isArray(context.planItems) ? context.planItems : [];
  const explicitNextMove = sanitizePlanTextList(
    planObj?.nextMove ??
    planObj?.next_move ??
    planObj?.nextTry ??
    planObj?.next_try,
  );
  const explicitHumanTasks = sanitizePlanTextList(
    planObj?.humanTasks ?? planObj?.human_tasks,
  );
  const explicitAgentTasks = sanitizePlanTextList(
    planObj?.agentTasks ?? planObj?.agent_tasks,
  );
  const structuredSteps: StructuredAssistPlanStep[] = Array.isArray(planObj?.steps)
    ? (planObj.steps as Array<Record<string, unknown>>)
        .map((step, index) => {
          const title = sanitizePlanText(step?.title);
          if (!title) return null;
          const relatedObjects = normalizeTextList(
            step?.relatedObjects ??
            step?.relatedObjectIds ??
            step?.relatedObjectId,
          );
          return {
            id: safeText(step?.id).trim() || `plan_step_${index + 1}`,
            title,
            status: normalizePlanStepStatus(step?.status),
            assignedAgentId: safeText(step?.assignedAgentId).trim() || null,
            skillId: safeText(step?.skillId).trim() || null,
            toolIds: normalizeTextList(step?.toolIds ?? step?.tools),
            generatedPrompt:
              safeText(step?.generatedPrompt ?? step?.starterPrompt).trim(),
            expectedOutput: sanitizePlanText(step?.expectedOutput),
            relatedFiles: normalizeTextList(step?.relatedFiles),
            relatedObjects,
            relatedSurface: safeText(step?.relatedSurface).trim() || null,
            validationCommand:
              safeText(step?.validationCommand).trim() || null,
            approvalRequired: normalizeBoolean(step?.approvalRequired),
            resultSummary: sanitizePlanText(step?.resultSummary),
            blocker: sanitizePlanText(step?.blocker),
          };
        })
        .filter((step): step is StructuredAssistPlanStep => Boolean(step))
    : [];
  const structuredApprovalGates = Array.isArray(planObj?.approvalGates)
    ? (planObj.approvalGates as Array<Record<string, unknown>>)
        .map((gate) => {
          const title = safeText(gate?.title).trim();
          const requiredBefore = safeText(gate?.requiredBefore).trim();
          const reason = safeText(gate?.reason).trim();
          if (!title || !requiredBefore || !reason) return "";
          return `Approval gate ${title}: review required before ${requiredBefore}. ${reason}`;
        })
        .filter(Boolean)
    : [];
  const structuredMissingAgents = Array.isArray(planObj?.missingAgentsProposed)
    ? (planObj.missingAgentsProposed as Array<Record<string, unknown>>)
        .map((agent) => {
          const name = safeText(agent?.name).trim() || safeText(agent?.proposedAgentId).trim();
          const purpose = safeText(agent?.purpose).trim();
          const whyNeeded = safeText(agent?.whyNeeded).trim();
          if (!name || !purpose || !whyNeeded) return "";
          return `Propose ${name}: ${purpose}. ${whyNeeded} (approval required).`;
        })
        .filter(Boolean)
    : [];
  const structuredAgentTasks = structuredSteps.map((step) =>
    step.assignedAgentId
      ? `${step.title} [agent: ${step.assignedAgentId}]`
      : step.title,
  );
  const structuredApprovalTasks = structuredSteps
    .filter((step) => step.approvalRequired)
    .map((step) => `Approve step "${step.title}" before execution.`);
  const structuredWhatMattersNow = Array.isArray(planObj?.availableAgentsConsidered)
    ? (planObj.availableAgentsConsidered as Array<Record<string, unknown>>)
        .map((entry) => {
          const name = safeText(entry?.name).trim() || safeText(entry?.agentId).trim();
          const reason = safeText(entry?.reasonUseful).trim();
          return name && reason ? `Available agent ${name}: ${reason}` : "";
        })
        .filter(Boolean)
    : [];
  const structuredNextSafeStep = sanitizePlanText(
    planObj?.nextSafeStep ?? planObj?.next_safe_step,
  );
  const sanitizedPlanItems = planItems.filter(
    (item) => !isPlanRuntimeNoise(safeText(item.text).trim()),
  );

  return {
    planMode: normalizePlanMode(planObj?.planMode ?? planObj?.mode),
    goal: sanitizePlanText(planObj?.goal ?? planObj?.title ?? planObj?.objective),
    steps: structuredSteps,
    whatMattersNow: [
      ...sanitizePlanTextList(
        planObj?.whatMattersNow ??
        planObj?.what_matters_now ??
        planObj?.whatWeKnow ??
        planObj?.what_we_know ??
        planObj?.knowledge ??
        planObj?.knownFacts ??
        planObj?.facts,
      ),
      ...structuredWhatMattersNow,
    ],
    nextMove:
      explicitNextMove.length > 0
        ? explicitNextMove
        : structuredNextSafeStep
          ? [structuredNextSafeStep]
          : structuredSteps.length > 0
            ? structuredSteps.slice(0, 3).map((step) => step.title)
        : sanitizedPlanItems
            .filter((item) => item.status !== "done")
            .slice(0, 3)
            .map((item) => safeText(item.text).trim())
            .filter(Boolean),
    assumptions: sanitizePlanTextList(
      planObj?.assumptions ??
      planObj?.assumptionList ??
      planObj?.assumption_list,
    ),
    research: sanitizePlanTextList(
      planObj?.research ??
      planObj?.researchSection ??
      planObj?.research_section ??
      planObj?.researchTracks ??
      planObj?.research_tracks,
    ),
    openQuestions:
      context.anchorSurface?.openQuestions ??
      sanitizePlanTextList(
        planObj?.openQuestions ??
        planObj?.open_questions ??
        planObj?.unknowns ??
        planObj?.questions,
      ),
    humanTasks:
      explicitHumanTasks.length > 0
        ? explicitHumanTasks
        : [
            ...normalizeTypedTaskList(planObj?.tasks ?? planObj?.items, "human"),
            ...structuredApprovalTasks,
            ...structuredMissingAgents,
            ...structuredApprovalGates,
          ],
    agentTasks:
      explicitAgentTasks.length > 0
        ? explicitAgentTasks
        : [
            ...normalizeTypedTaskList(planObj?.tasks ?? planObj?.items, "agent"),
            ...structuredAgentTasks,
          ],
    pathOptions: normalizeTextList(
      planObj?.pathOptions ??
      planObj?.path_options ??
      planObj?.bestPaths ??
      planObj?.best_paths ??
      planObj?.paths,
    ),
    explicitPlanText: pickExplicitPlanText(input),
    hasExplicitPlanDocument: hasExplicitPlanDocument(input),
    whatChanged: context.anchorSurface?.whatChanged ?? [],
    sources: context.anchorSurface?.sources ?? [],
  };
}

export function buildDerivedAnchorText(
  input: unknown,
  context: {
    messages?: { role: "assistant" | "user"; text: string }[];
    planItems?: PlanItem[];
    links?: LinkRef[];
  } = {},
): string {
  const planObj = input && typeof input === "object" && !Array.isArray(input) ? (input as any) : null;
  const fallbackItems = context.planItems && context.planItems.length > 0
    ? context.planItems
    : normalizePlanItems(input);
  const explicitGoal = safeText(
    planObj?.goal ??
    planObj?.title ??
    planObj?.objective ??
    (typeof input === "string" ? input : ""),
  ).trim();
  const stableNotes = normalizeTextList(
    planObj?.whatWeKnow ??
    planObj?.what_we_know ??
    planObj?.knowledge ??
    planObj?.knownFacts ??
    planObj?.facts,
  );
  const bestPaths = normalizeTextList(
    planObj?.bestPaths ??
    planObj?.best_paths ??
    planObj?.paths,
  );
  const currentBet = safeText(planObj?.currentBet ?? planObj?.current_bet).trim();
  const nextTry = safeText(planObj?.nextTry ?? planObj?.next_try).trim();
  const lastUserMessage =
    [...(Array.isArray(context.messages) ? context.messages : [])]
      .reverse()
      .find((message) => message.role === "user")
      ?.text
      ?.trim() || "";
  const lastAssistantMessage =
    [...(Array.isArray(context.messages) ? context.messages : [])]
      .reverse()
      .find((message) => message.role === "assistant")
      ?.text
      ?.trim() || "";
  const sourceCount = Array.isArray(context.links) ? context.links.length : 0;
  const paragraphs: string[] = [];

  if (explicitGoal) {
    paragraphs.push(`This pass is anchored on ${explicitGoal}.`);
  } else if (lastUserMessage) {
    paragraphs.push(`This pass is anchored on the user's latest request: ${lastUserMessage}`);
  } else {
    paragraphs.push("No saved anchor text exists for this Assist project yet.");
  }

  if (stableNotes.length > 0) {
    paragraphs.push(`What currently appears stable: ${stableNotes.slice(0, 3).join("; ")}.`);
  } else if (fallbackItems.length > 0) {
    paragraphs.push(`Active working threads: ${fallbackItems.slice(0, 3).map((item) => item.text).join("; ")}.`);
  }

  if (bestPaths.length > 0 || currentBet || nextTry) {
    const strategyBits = [
      bestPaths.length > 0 ? `best paths in play: ${bestPaths.slice(0, 3).join("; ")}` : "",
      currentBet ? `current bet: ${currentBet}` : "",
      nextTry ? `next try: ${nextTry}` : "",
    ].filter(Boolean);
    if (strategyBits.length > 0) {
      paragraphs.push(`Working direction: ${strategyBits.join(". ")}.`);
    }
  }

  if (lastAssistantMessage) {
    paragraphs.push(`Latest assistant direction: ${lastAssistantMessage}`);
  }

  if (sourceCount > 0) {
    paragraphs.push(`This project currently has ${sourceCount} saved source link${sourceCount === 1 ? "" : "s"} available for grounding.`);
  }

  return paragraphs.join("\n\n");
}

export function normalizeAnchorSurface(
  input: unknown,
  context: {
    messages?: { role: "assistant" | "user"; text: string }[];
    planItems?: PlanItem[];
    links?: LinkRef[];
  } = {},
): AnchorSurface {
  const planObj = input && typeof input === "object" && !Array.isArray(input) ? (input as any) : null;
  const whatChanged = normalizeTextList(
    planObj?.whatChanged ??
    planObj?.what_changed ??
    planObj?.recentChanges ??
    planObj?.recent_changes ??
    planObj?.changes ??
    planObj?.updates,
  );
  const openQuestions = normalizeTextList(
    planObj?.openQuestions ??
    planObj?.open_questions ??
    planObj?.unknowns ??
    planObj?.questions,
  );
  const explicitSources = normalizeTextList(planObj?.sources);
  const derivedSources = Array.isArray(context.links)
    ? context.links
        .slice(0, 6)
        .map((link) => safeText(link.title || link.url).trim())
        .filter(Boolean)
    : [];
  const explicitAnchor = safeText(
    planObj?.anchor ??
    planObj?.anchorText ??
    planObj?.anchor_text ??
    planObj?.planWiki ??
    planObj?.plan_wiki ??
    planObj?.memo ??
    planObj?.article ??
    planObj?.summary ??
    planObj?.body ??
    planObj?.text ??
    (typeof input === "string" ? input : ""),
  ).trim();

  return {
    anchor: explicitAnchor || buildDerivedAnchorText(input, context),
    whatChanged,
    openQuestions,
    sources: explicitSources.length > 0 ? explicitSources : derivedSources,
  };
}
