// @graph entity: DeckRunState
// @graph role: deck-run-stream-client
// @graph relates_to: AgentBuilderWorkspace, BuilderDeckRuntimeActions, DeckRuntime
// @graph depends_on: DeckRunRoute
// @graph feeds_to: DeckRunRoute
import type {
  LinkRef,
  PlanContractMode,
  PlanItem,
  PlanStepStatus,
  StructuredAssistPlanStep,
} from "./assistPlanSurface";
import { safeJson } from "./requestGuards";
import type { DeckDocument, DeckRun, DeckRuntimeEvent } from "../../types/agentgraph";

type DeckRunStreamResult = {
  ok?: boolean;
  deck?: DeckDocument;
  run?: DeckRun;
  meta?: Record<string, unknown> | null;
};

type DeckRuntimeVisualState = {
  activeCardIds: string[];
  activeEdgeIds: string[];
  swarmProgressByCardId: Record<string, { completed: number; total: number }>;
  reasoningLines: string[];
  teamLines: string[];
  reportLines: string[];
};

const EMPTY_PROJECT_STATE = {
  messages: [] as { role: "assistant" | "user"; text: string }[],
  plan: [] as PlanItem[],
  links: [] as LinkRef[],
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

function cleanOptionalText(value: unknown): string | null {
  const text = safeText(value).trim();
  return text || null;
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const source = String(text || "").trim();
  if (!source) return null;
  const firstBrace = source.indexOf("{");
  const lastBrace = source.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) return null;
  try {
    const parsed = JSON.parse(source.slice(firstBrace, lastBrace + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function normalizeTextList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.map((entry) => safeText(entry).trim()).filter(Boolean);
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const normalized = safeText(value).trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

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

function normalizeStructuredPlanCandidate(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const goal = safeText(raw.goal).trim();
  const steps: StructuredAssistPlanStep[] = (Array.isArray(raw.steps) ? raw.steps : [])
    .map((entry, index) => {
      const step = entry as Record<string, unknown>;
      const title = safeText(step.title).trim();
      if (!title) return null;
      const relatedObjects = normalizeTextList(
        step.relatedObjects ?? step.relatedObjectIds ?? step.relatedObjectId,
      );
      return {
        id: safeText(step.id).trim() || `plan_step_${index + 1}`,
        title,
        status: normalizePlanStepStatus(step.status),
        assignedAgentId: safeText(step.assignedAgentId).trim() || null,
        skillId: safeText(step.skillId).trim() || null,
        toolIds: normalizeTextList(step.toolIds ?? step.tools),
        generatedPrompt: safeText(step.generatedPrompt ?? step.starterPrompt).trim(),
        expectedOutput: safeText(step.expectedOutput).trim(),
        relatedObjects,
        relatedSurface: safeText(step.relatedSurface).trim() || null,
        relatedFiles: normalizeTextList(step.relatedFiles),
        validationCommand: safeText(step.validationCommand).trim() || null,
        approvalRequired: normalizeBoolean(step.approvalRequired),
        resultSummary: safeText(step.resultSummary).trim(),
        blocker: safeText(step.blocker).trim(),
      };
    })
    .filter((step): step is NonNullable<typeof step> => Boolean(step));
  if (!goal && steps.length === 0) return null;
  const nextSafeStep =
    safeText(raw.nextSafeStep ?? raw.next_safe_step).trim() ||
    String((steps[0] as { title?: unknown } | undefined)?.title || "").trim() ||
    "Await human approval before execution.";
  return {
    planMode: normalizePlanMode(raw.planMode ?? raw.mode),
    goal,
    availableAgentsConsidered: Array.isArray(raw.availableAgentsConsidered) ? raw.availableAgentsConsidered : [],
    missingAgentsProposed: Array.isArray(raw.missingAgentsProposed) ? raw.missingAgentsProposed : [],
    steps,
    approvalGates: Array.isArray(raw.approvalGates) ? raw.approvalGates : [],
    nextSafeStep,
  };
}

function extractStructuredPlanFromRun(run: DeckRun | null | undefined): Record<string, unknown> | null {
  const steps = [...(run?.steps || [])].reverse();
  for (const step of steps) {
    const fromField = normalizeStructuredPlanCandidate(
      (step as { structuredPlan?: unknown }).structuredPlan,
    );
    if (fromField) return fromField;
    const fromOutput = normalizeStructuredPlanCandidate(extractJsonObject(String(step.output || "")));
    if (fromOutput) return fromOutput;
  }
  return null;
}

function prefixRuntimeLine(label: string, value: string): string {
  const text = safeText(value).trim();
  return text ? `${label}: ${text}` : "";
}

export function buildDeckRuntimeVisualState(
  events: DeckRuntimeEvent[] | null | undefined,
): DeckRuntimeVisualState {
  const activeCardIds = new Set<string>();
  const activeEdgeIds = new Set<string>();
  const activeEdgeIdsByCard = new Map<string, string[]>();
  const swarmProgressByCardId: Record<string, { completed: number; total: number }> = {};
  const reasoningLines: string[] = [];
  const teamLines: string[] = [];
  const reportLines: string[] = [];

  (Array.isArray(events) ? events : []).forEach((event) => {
    const cardTitle = safeText(event.cardTitle || event.cardId || "Card").trim() || "Card";
    if (event.kind === "message" || event.type === "message") {
      const content = safeText(event.content || "").trim();
      if (content) teamLines.push(content);
      return;
    }

    if (event.kind === "step_started") {
      if (event.cardId) {
        activeCardIds.add(event.cardId);
        const edgeIds = Array.isArray(event.edgeIds) ? event.edgeIds.filter(Boolean) : [];
        activeEdgeIdsByCard.set(event.cardId, edgeIds);
        edgeIds.forEach((edgeId) => activeEdgeIds.add(edgeId));
      }
      if (Array.isArray(event.notes)) {
        event.notes
          .map((note) => safeText(note).trim())
          .filter(Boolean)
          .forEach((note) => reasoningLines.push(note));
      }
      const line = prefixRuntimeLine(
        "Progress",
        safeText(event.progressText || event.text || `${cardTitle} started.`),
      );
      if (line) teamLines.push(line);
      return;
    }

    if (event.kind === "magentic_assignment") {
      const assignmentLine = prefixRuntimeLine("Assignment", safeText(event.text || ""));
      if (assignmentLine) {
        reasoningLines.push(assignmentLine);
        teamLines.push(assignmentLine);
      }
      const progressLine = prefixRuntimeLine("Progress", safeText(event.progressText || ""));
      if (progressLine) {
        reasoningLines.push(progressLine);
        teamLines.push(progressLine);
      }
      if (event.cardId && Array.isArray(event.edgeIds)) {
        event.edgeIds.filter(Boolean).forEach((edgeId) => activeEdgeIds.add(edgeId));
      }
      return;
    }

    if (event.kind === "swarm_progress") {
      const cardId = cleanOptionalText(event.cardId);
      if (cardId && event.completedWorkers && event.totalWorkers) {
        swarmProgressByCardId[cardId] = {
          completed: event.completedWorkers,
          total: event.totalWorkers,
        };
        activeCardIds.add(cardId);
      }
      const line = prefixRuntimeLine("Progress", safeText(event.progressText || event.text || ""));
      if (line) teamLines.push(line);
      return;
    }

    if (event.kind === "step_completed" || event.kind === "step_skipped") {
      const cardId = cleanOptionalText(event.cardId);
      if (cardId) {
        activeCardIds.delete(cardId);
        const edgeIds = activeEdgeIdsByCard.get(cardId) || [];
        edgeIds.forEach((edgeId) => activeEdgeIds.delete(edgeId));
        activeEdgeIdsByCard.delete(cardId);
        delete swarmProgressByCardId[cardId];
      }
      const line = prefixRuntimeLine("Progress", safeText(event.progressText || event.text || ""));
      if (line) teamLines.push(line);
      if (event.kind === "step_completed") {
        const reportText = safeText(event.outputSummary || line).trim();
        if (reportText) reportLines.push(prefixRuntimeLine("Result", `${cardTitle}: ${reportText}`));
      } else if (line) {
        reportLines.push(prefixRuntimeLine("Result", `${cardTitle}: ${line}`));
      }
      return;
    }

    if (event.kind === "run_completed") {
      activeCardIds.clear();
      activeEdgeIds.clear();
      Object.keys(swarmProgressByCardId).forEach((cardId) => delete swarmProgressByCardId[cardId]);
      const line = prefixRuntimeLine(
        event.status === "running" ? "Waiting" : "Result",
        safeText(event.progressText || event.text || ""),
      );
      if (line) reportLines.push(line);
      return;
    }

    const line = prefixRuntimeLine("Progress", safeText(event.progressText || event.text || ""));
    if (line) teamLines.push(line);
  });

  return {
    activeCardIds: Array.from(activeCardIds),
    activeEdgeIds: Array.from(activeEdgeIds),
    swarmProgressByCardId,
    reasoningLines,
    teamLines,
    reportLines,
  };
}

export async function streamDeckRunRequest(options: {
  endpoint: string;
  body: Record<string, unknown>;
  onEvent: (event: DeckRuntimeEvent) => void;
  signal?: AbortSignal;
}): Promise<DeckRunStreamResult> {
  const response = await fetch(`${options.endpoint}?stream=1`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...options.body,
      stream: true,
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    const data = await safeJson(response);
    throw new Error(safeText(data?.error || data?.message || "deck_run_failed"));
  }

  if (!response.body) {
    return (await safeJson(response)) as DeckRunStreamResult;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult: DeckRunStreamResult | null = null;

  const processLine = (line: string) => {
    if (!line.trim()) return;
    const parsed = JSON.parse(line) as
      | { kind: "event"; event?: DeckRuntimeEvent }
      | ({ kind: "result" } & DeckRunStreamResult)
      | { kind: "error"; error?: string }
      | DeckRunStreamResult;

    if ("kind" in parsed && parsed.kind === "event" && parsed.event && typeof parsed.event === "object") {
      options.onEvent(parsed.event);
      return;
    }
    if ("kind" in parsed && parsed.kind === "result") {
      finalResult = parsed;
      return;
    }
    if ("kind" in parsed && parsed.kind === "error") {
      throw new Error(safeText(parsed.error || "deck_run_failed"));
    }
    if (parsed && typeof parsed === "object" && "run" in parsed) {
      finalResult = parsed;
      return;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      processLine(line);
      newlineIndex = buffer.indexOf("\n");
    }

    if (done) break;
  }

  if (buffer.trim()) {
    processLine(buffer);
  }

  if (!finalResult) {
    throw new Error("deck_run_stream_incomplete");
  }

  return finalResult;
}

export function resolveDeckRunFinalText(run: DeckRun | null | undefined): string {
  if (!run) return "";
  const successfulStep = [...(run.steps || [])]
    .reverse()
    .find((step) => step.status === "success" && cleanOptionalText(step.output));
  if (successfulStep?.output) {
    return String(successfulStep.output).trim();
  }
  const summarizedStep = [...(run.steps || [])]
    .reverse()
    .find((step) => step.status === "success" && cleanOptionalText(step.outputSummary));
  if (summarizedStep?.outputSummary) {
    return String(summarizedStep.outputSummary).trim();
  }
  const failedStep = [...(run.steps || [])]
    .reverse()
    .find((step) => step.status === "error" && (cleanOptionalText(step.error) || cleanOptionalText(step.outputSummary)));
  return (
    cleanOptionalText(failedStep?.error) ||
    cleanOptionalText(failedStep?.outputSummary) ||
    cleanOptionalText(run.error) ||
    ""
  );
}

function buildStructuredPlanSummary(structuredPlan: Record<string, unknown> | null): string {
  if (!structuredPlan) return "";
  const rawSteps = Array.isArray((structuredPlan as { steps?: unknown }).steps)
    ? ((structuredPlan as { steps?: Array<Record<string, unknown>> }).steps || [])
    : [];
  const steps = rawSteps
    .map((step) => safeText(step.title).trim())
    .filter(Boolean)
    .slice(0, 5);
  if (steps.length === 0) return "";
  return steps.map((title, index) => `${index + 1}. ${title}`).join("\n");
}

export function resolveDeckRunChatReply(run: DeckRun | null | undefined): string {
  const structuredPlan = extractStructuredPlanFromRun(run);
  const summary = buildStructuredPlanSummary(structuredPlan);
  if (summary) return summary;
  return resolveDeckRunFinalText(run);
}

export function buildReloadStateFromDeckRuns(
  runsInput: DeckRun[] | null | undefined,
  latestRunInput: DeckRun | null | undefined,
): {
  messages: { role: "assistant" | "user"; text: string }[];
  planSource: unknown;
  plan: PlanItem[];
  links: LinkRef[];
} {
  const orderedRuns = [...(Array.isArray(runsInput) ? runsInput : [])];
  const latestRun =
    latestRunInput && typeof latestRunInput === "object"
      ? latestRunInput
      : orderedRuns[0] || null;
  if (latestRun && !orderedRuns.some((run) => run.id === latestRun.id)) {
    orderedRuns.unshift(latestRun);
  }
  if (orderedRuns.length === 0) {
    return {
      messages: [...EMPTY_PROJECT_STATE.messages],
      planSource: [...EMPTY_PROJECT_STATE.plan],
      plan: [...EMPTY_PROJECT_STATE.plan],
      links: [...EMPTY_PROJECT_STATE.links],
    };
  }

  const chronologicalRuns = [...orderedRuns].reverse();
  const messages = chronologicalRuns.flatMap((run) => {
    const entries: { role: "assistant" | "user"; text: string }[] = [];
    const userText = cleanOptionalText(run.input);
    if (userText) {
      entries.push({ role: "user", text: userText });
    }
    const assistantText = cleanOptionalText(resolveDeckRunChatReply(run));
    const fallbackText =
      assistantText ||
      cleanOptionalText(run.error) ||
      (run.status === "error" ? "Deck run failed." : null);
    if (fallbackText) {
      entries.push({ role: "assistant", text: fallbackText });
    }
    return entries;
  });

  const latestEvents = Array.isArray(latestRun?.events) ? latestRun.events : [];
  const latestProgressText =
    [...latestEvents]
      .reverse()
      .map((event) => cleanOptionalText(event.progressText) || cleanOptionalText(event.text))
      .find(Boolean) || "";
  const latestAssignmentText =
    [...latestEvents]
      .reverse()
      .filter((event) => event.kind === "magentic_assignment")
      .map((event) => cleanOptionalText(event.text))
      .find(Boolean) || "";
  const latestResultSummary =
    [...(latestRun?.steps || [])]
      .reverse()
      .map((step) => cleanOptionalText(step.outputSummary) || cleanOptionalText(step.output))
      .find(Boolean) || "";
  const structuredPlan = extractStructuredPlanFromRun(latestRun);

  const plan = structuredPlan
    ? (Array.isArray((structuredPlan as { steps?: unknown }).steps)
        ? ((structuredPlan as { steps?: Array<Record<string, unknown>> }).steps || [])
        : []
      ).map((step, index) => ({
        id: safeText(step.id).trim() || `plan_step_${index}`,
        text: safeText(step.title).trim() || `Step ${index + 1}`,
        status:
          safeText(step.status).trim().toLowerCase() === "done"
            ? ("done" as const)
            : safeText(step.status).trim().toLowerCase() === "approved"
              ? ("approved" as const)
              : ("draft" as const),
      }))
    : (latestRun?.steps || [])
        .map((step, index) => {
          const summary = cleanOptionalText(step.outputSummary) || cleanOptionalText(step.error);
          const text = summary ? `${step.title}: ${summary}` : step.title;
          return text
            ? {
                id: cleanOptionalText(step.id) || `${latestRun?.id || "run"}:step_${index}`,
                text,
                status: step.status === "success" || step.status === "skipped" ? "done" : "draft",
              }
            : null;
        })
        .filter((item): item is PlanItem => Boolean(item));

  const planSource = structuredPlan
    ? structuredPlan
    : latestRun
    ? {
        goal: cleanOptionalText(latestRun.input) || "",
        nextMove:
          latestRun.status === "success"
            ? ["Waiting for the next user input."]
            : [cleanOptionalText(latestProgressText || latestRun.error || "")].filter(Boolean),
        whatMattersNow: [cleanOptionalText(latestAssignmentText || latestProgressText || "")].filter(Boolean),
        whatChanged: [cleanOptionalText(latestResultSummary || "")].filter(Boolean),
        sources: [] as string[],
        anchor: [
          cleanOptionalText(latestRun.input) ? `Goal: ${String(latestRun.input).trim()}` : "",
          latestProgressText ? `Progress: ${latestProgressText}` : "",
          latestResultSummary ? `Result: ${latestResultSummary}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      }
    : [...EMPTY_PROJECT_STATE.plan];

  return {
    messages,
    planSource,
    plan,
    links: [...EMPTY_PROJECT_STATE.links],
  };
}
