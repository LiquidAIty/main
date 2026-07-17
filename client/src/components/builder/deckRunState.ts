// @graph entity: DeckRunState
// @graph role: deck-run-stream-client
// @graph relates_to: AgentBuilderWorkspace, BuilderDeckRuntimeActions, DeckRuntime
// @graph depends_on: DeckRunRoute
// @graph feeds_to: DeckRunRoute
import type { LinkRef } from "./deckContinuityTypes";
import { safeJson } from "./requestGuards";
import type { DeckDocument, DeckRun, DeckRunResponse, DeckRuntimeEvent } from "../../types/agentgraph";

type DeckRunStreamResult = DeckRunResponse & {
  deck?: DeckDocument;
  run?: DeckRun;
};

// Live-run canvas activity only: which cards/edges glow while a run streams.
// (The old reasoning/team/report line buffers had no renderer and were removed.)
type DeckRuntimeVisualState = {
  activeCardIds: string[];
  activeEdgeIds: string[];
};

const EMPTY_PROJECT_STATE = {
  messages: [] as { role: "assistant" | "user"; text: string }[],
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

export function buildDeckRuntimeVisualState(
  events: DeckRuntimeEvent[] | null | undefined,
): DeckRuntimeVisualState {
  const activeCardIds = new Set<string>();
  const activeEdgeIds = new Set<string>();
  const activeEdgeIdsByCard = new Map<string, string[]>();

  (Array.isArray(events) ? events : []).forEach((event) => {
    if (event.kind === "step_started") {
      if (event.cardId) {
        activeCardIds.add(event.cardId);
        const edgeIds = Array.isArray(event.edgeIds) ? event.edgeIds.filter(Boolean) : [];
        activeEdgeIdsByCard.set(event.cardId, edgeIds);
        edgeIds.forEach((edgeId) => activeEdgeIds.add(edgeId));
      }
      return;
    }

    if (event.kind === "magentic_assignment") {
      if (event.cardId && Array.isArray(event.edgeIds)) {
        event.edgeIds.filter(Boolean).forEach((edgeId) => activeEdgeIds.add(edgeId));
      }
      return;
    }

    if (event.kind === "swarm_progress") {
      const cardId = cleanOptionalText(event.cardId);
      if (cardId) activeCardIds.add(cardId);
      return;
    }

    if (event.kind === "step_completed" || event.kind === "step_skipped") {
      const cardId = cleanOptionalText(event.cardId);
      if (cardId) {
        activeCardIds.delete(cardId);
        const edgeIds = activeEdgeIdsByCard.get(cardId) || [];
        edgeIds.forEach((edgeId) => activeEdgeIds.delete(edgeId));
        activeEdgeIdsByCard.delete(cardId);
      }
      return;
    }

    if (event.kind === "run_completed") {
      activeCardIds.clear();
      activeEdgeIds.clear();
    }
  });

  return {
    activeCardIds: Array.from(activeCardIds),
    activeEdgeIds: Array.from(activeEdgeIds),
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
    links: [...EMPTY_PROJECT_STATE.links],
  };
}
