// @graph entity: DeckRunState
// @graph role: deck-run-stream-client
// @graph relates_to: AgentBuilderWorkspace, BuilderDeckRuntimeActions, DeckRuntime
// @graph depends_on: DeckRunRoute
// @graph feeds_to: DeckRunRoute
import type {
  LinkRef,
  PlanItem,
} from "./assistPlanSurface";
import { safeJson } from "./requestGuards";
import type { DeckDocument, DeckRun, DeckRunResponse, DeckRuntimeEvent } from "../../types/agentgraph";

type DeckRunStreamResult = DeckRunResponse & {
  deck?: DeckDocument;
  run?: DeckRun;
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

    if (event.kind === "magentic_trace") {
      if (event.plan && typeof event.plan === "object" && !Array.isArray(event.plan)) {
        const p = event.plan as any;
        if (p.summary) reasoningLines.push(prefixRuntimeLine("Plan Summary", p.summary));
        if (p.deltaSummary) reasoningLines.push(prefixRuntimeLine("Plan Delta", p.deltaSummary));
        if (Array.isArray(p.openQuestions)) {
          p.openQuestions.forEach((q: string) => reasoningLines.push(prefixRuntimeLine("Question", q)));
        }
      }

      if (Array.isArray(event.blackboardEntries)) {
        event.blackboardEntries.forEach((entry: any) => {
          if (entry && entry.content) {
            reasoningLines.push(prefixRuntimeLine("Blackboard", entry.content));
          } else {
            reasoningLines.push(prefixRuntimeLine("Blackboard", JSON.stringify(entry)));
          }
        });
      }

      if (Array.isArray(event.reportBacks)) {
        event.reportBacks.forEach((entry: any) => {
          if (entry && entry.summary) {
            reportLines.push(prefixRuntimeLine("Report", entry.summary));
          } else {
            reportLines.push(prefixRuntimeLine("Report", JSON.stringify(entry)));
          }
        });
      }

      if (Array.isArray(event.transcript)) {
        event.transcript.slice(-3).forEach((msg: any) => {
          if (msg && msg.content) {
            teamLines.push(prefixRuntimeLine("Transcript", msg.content));
          } else {
            teamLines.push(prefixRuntimeLine("Transcript", JSON.stringify(msg)));
          }
        });
      }

      if (event.metrics && typeof event.metrics === "object") {
        reasoningLines.push(prefixRuntimeLine("Metrics", JSON.stringify(event.metrics)));
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

export function resolveDeckRunChatReply(run: DeckRun | null | undefined): string {
  // Only a real final output from a successful run may become assistant chat.
  // No structured-plan JSON, no Task Ledger artifact, and no error text is ever
  // turned into a chat reply; absent a real final output this returns "".
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
  return "";
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
    // Only a real, clean assistant answer from a successful run may appear in
    // chat. Errors and failures are NOT mirrored into the conversation as
    // assistant bubbles — they surface as non-chat status elsewhere. No
    // fallback/placeholder/"Deck run failed." assistant text.
    const assistantText =
      run.status === "error" ? "" : cleanOptionalText(resolveDeckRunChatReply(run));
    if (assistantText) {
      entries.push({ role: "assistant", text: assistantText });
    }
    return entries;
  });

  return {
    messages,
    planSource: [...EMPTY_PROJECT_STATE.plan],
    plan: [...EMPTY_PROJECT_STATE.plan],
    links: [...EMPTY_PROJECT_STATE.links],
  };
}
