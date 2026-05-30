import type {
  SemanticGraphRecord,
  SemanticGraphRecordKind,
  SemanticGraphSourceRef,
  SemanticGraphWriter,
} from "../types";

function asString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    const json = JSON.stringify(value);
    return typeof json === "string" ? json : String(value);
  } catch {
    return String(value);
  }
}

function toSourceRefs(input: unknown): SemanticGraphSourceRef[] {
  if (!Array.isArray(input)) return [];
  const refs: SemanticGraphSourceRef[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const type = asString(raw.type).trim().toLowerCase();
    const ref = asString(raw.ref).trim();
    if (!ref) continue;
    const normalizedType: SemanticGraphSourceRef["type"] =
      type === "chat" ||
      type === "url" ||
      type === "file" ||
      type === "code" ||
      type === "mission" ||
      type === "agent_run" ||
      type === "graph_record" ||
      type === "user_input"
        ? (type as SemanticGraphSourceRef["type"])
        : "chat";
    refs.push({
      type: normalizedType,
      ref,
      title: asString(raw.title).trim() || null,
      summary: asString(raw.summary).trim() || null,
      excerpt: asString(raw.excerpt).trim() || null,
      retrievedAt: asString(raw.retrievedAt).trim() || null,
      confidence: Number.isFinite(Number(raw.confidence)) ? Number(raw.confidence) : null,
    });
  }
  return refs;
}

function normalizeRecord(
  input: unknown,
  options: {
    graph: SemanticGraphRecord["graph"];
    defaultKind: SemanticGraphRecordKind;
    writer: SemanticGraphWriter;
    now: string;
  },
): SemanticGraphRecord | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const id = asString(raw.id).trim();
  if (!id) return null;
  const label = asString(raw.label).trim() || id;
  const summary = asString(raw.summary).trim() || asString(raw.text).trim() || label;
  const kindRaw = asString(raw.kind).trim().toLowerCase();
  const kind: SemanticGraphRecordKind =
    kindRaw === "entity" ||
    kindRaw === "relationship" ||
    kindRaw === "claim" ||
    kindRaw === "evidence" ||
    kindRaw === "source" ||
    kindRaw === "decision" ||
    kindRaw === "summary" ||
    kindRaw === "action" ||
    kindRaw === "question" ||
    kindRaw === "hypothesis" ||
    kindRaw === "contradiction" ||
    kindRaw === "mission" ||
    kindRaw === "agent_run" ||
    kindRaw === "file" ||
    kindRaw === "component" ||
    kindRaw === "symbol"
      ? (kindRaw as SemanticGraphRecordKind)
      : options.defaultKind;

  return {
    id,
    graph: options.graph,
    kind,
    label,
    summary,
    entities: Array.isArray(raw.entities) ? (raw.entities as SemanticGraphRecord["entities"]) : [],
    relationships: Array.isArray(raw.relationships)
      ? (raw.relationships as SemanticGraphRecord["relationships"])
      : [],
    properties:
      raw.properties && typeof raw.properties === "object"
        ? (raw.properties as Record<string, unknown>)
        : {},
    sourceRefs: toSourceRefs(raw.sourceRefs),
    confidence: Number.isFinite(Number(raw.confidence)) ? Number(raw.confidence) : null,
    vectorText: asString(raw.vectorText).trim() || summary,
    provenance:
      raw.provenance && typeof raw.provenance === "object"
        ? (raw.provenance as SemanticGraphRecord["provenance"])
        : null,
    writer: options.writer,
    writeMode: "agent-owned",
    createdAt: asString(raw.createdAt).trim() || options.now,
    updatedAt: asString(raw.updatedAt).trim() || options.now,
    "@context":
      raw["@context"] && (typeof raw["@context"] === "string" || Array.isArray(raw["@context"]) || typeof raw["@context"] === "object")
        ? (raw["@context"] as SemanticGraphRecord["@context"])
        : undefined,
    "@id": asString(raw["@id"]).trim() || undefined,
    "@type":
      typeof raw["@type"] === "string" || Array.isArray(raw["@type"])
        ? (raw["@type"] as SemanticGraphRecord["@type"])
        : undefined,
  };
}

export function normalizeKnowGraphOutputToSemanticRecords(
  payload: unknown,
): SemanticGraphRecord[] {
  const now = new Date().toISOString();
  const rows = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as any).records)
      ? ((payload as any).records as unknown[])
      : [];

  const normalized = rows
    .map((entry) =>
      normalizeRecord(entry, {
        graph: "know",
        defaultKind: "claim",
        writer: "knowgraph-agent",
        now,
      }),
    )
    .filter((entry): entry is SemanticGraphRecord => Boolean(entry));

  return normalized;
}

export function normalizeThinkGraphOutputToSemanticRecords(
  payload: unknown,
): SemanticGraphRecord[] {
  const now = new Date().toISOString();
  const rows = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as any).records)
      ? ((payload as any).records as unknown[])
      : [];

  const normalized = rows
    .map((entry) =>
      normalizeRecord(entry, {
        graph: "think",
        defaultKind: "summary",
        writer: "thinkgraph-agent",
        now,
      }),
    )
    .filter((entry): entry is SemanticGraphRecord => Boolean(entry));

  return normalized;
}

export function canApplyGraphUpdateRequest(actor: string): boolean {
  const normalized = asString(actor).trim().toLowerCase();
  return (
    normalized === "thinkgraph-agent" ||
    normalized === "knowgraph-agent" ||
    normalized === "codegraph-agent"
  );
}
