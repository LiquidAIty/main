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

export type StructuredAssistPlanSurface = {
  goal: string;
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
  const explicitNextMove = normalizeTextList(
    planObj?.nextMove ??
    planObj?.next_move ??
    planObj?.nextTry ??
    planObj?.next_try,
  );
  const explicitHumanTasks = normalizeTextList(planObj?.humanTasks ?? planObj?.human_tasks);
  const explicitAgentTasks = normalizeTextList(planObj?.agentTasks ?? planObj?.agent_tasks);

  return {
    goal: safeText(planObj?.goal ?? planObj?.title ?? planObj?.objective).trim(),
    whatMattersNow: normalizeTextList(
      planObj?.whatMattersNow ??
      planObj?.what_matters_now ??
      planObj?.whatWeKnow ??
      planObj?.what_we_know ??
      planObj?.knowledge ??
      planObj?.knownFacts ??
      planObj?.facts,
    ),
    nextMove:
      explicitNextMove.length > 0
        ? explicitNextMove
        : planItems
            .filter((item) => item.status !== "done")
            .slice(0, 3)
            .map((item) => safeText(item.text).trim())
            .filter(Boolean),
    assumptions: normalizeTextList(
      planObj?.assumptions ??
      planObj?.assumptionList ??
      planObj?.assumption_list,
    ),
    research: normalizeTextList(
      planObj?.research ??
      planObj?.researchSection ??
      planObj?.research_section ??
      planObj?.researchTracks ??
      planObj?.research_tracks,
    ),
    openQuestions:
      context.anchorSurface?.openQuestions ??
      normalizeTextList(
        planObj?.openQuestions ??
        planObj?.open_questions ??
        planObj?.unknowns ??
        planObj?.questions,
      ),
    humanTasks:
      explicitHumanTasks.length > 0
        ? explicitHumanTasks
        : normalizeTypedTaskList(planObj?.tasks ?? planObj?.items, "human"),
    agentTasks:
      explicitAgentTasks.length > 0
        ? explicitAgentTasks
        : normalizeTypedTaskList(planObj?.tasks ?? planObj?.items, "agent"),
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
