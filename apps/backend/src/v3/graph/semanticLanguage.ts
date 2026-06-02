import type {
  SemanticAnnotationProperty,
  SemanticDatatypeProperty,
  SemanticGraphEntity,
  SemanticGraphRecord,
  SemanticGraphRecordKind,
  SemanticGraphRelationship,
  SemanticGraphSourceRef,
  SemanticGraphSourceRefType,
  SemanticObjectProperty,
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

const VALID_RECORD_KINDS: SemanticGraphRecordKind[] = [
  "entity",
  "relationship",
  "claim",
  "evidence",
  "source",
  "decision",
  "summary",
  "action",
  "question",
  "hypothesis",
  "contradiction",
  "mission",
  "agent_run",
  "file",
  "component",
  "symbol",
  "concept",
  "event",
  "observation",
];

const VALID_SOURCE_REF_TYPES: SemanticGraphSourceRefType[] = [
  "chat",
  "url",
  "file",
  "code",
  "mission",
  "agent_run",
  "graph_record",
  "user_input",
  "tool_result",
  "model_output",
];

type ValidationResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

function toSourceRefs(input: unknown, warnings: string[]): SemanticGraphSourceRef[] {
  if (!Array.isArray(input)) return [];
  const refs: SemanticGraphSourceRef[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const type = asString(raw.type).trim().toLowerCase();
    const ref = asString(raw.ref).trim();
    if (!ref) continue;
    if (!VALID_SOURCE_REF_TYPES.includes(type as SemanticGraphSourceRefType)) {
      warnings.push(`sourceRefs has unsupported type "${type}" for ref "${ref}"`);
      continue;
    }
    refs.push({
      id: asString(raw.id).trim() || undefined,
      type: type as SemanticGraphSourceRef["type"],
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
): { record: SemanticGraphRecord | null; warnings: string[] } {
  const warnings: string[] = [];
  if (!input || typeof input !== "object") return { record: null, warnings: ["skipped non-object row"] };
  const raw = input as Record<string, unknown>;
  const id = asString(raw.id).trim();
  if (!id) return { record: null, warnings: ["skipped row with missing id"] };
  const label = asString(raw.label).trim() || id;
  const summary = asString(raw.summary).trim() || asString(raw.text).trim() || "";
  const kindRaw = asString(raw.kind).trim().toLowerCase();
  const kind: SemanticGraphRecordKind = VALID_RECORD_KINDS.includes(kindRaw as SemanticGraphRecordKind)
    ? (kindRaw as SemanticGraphRecordKind)
    : options.defaultKind;
  if (kindRaw && kindRaw !== kind) {
    warnings.push(`unsupported kind "${kindRaw}", defaulted to "${options.defaultKind}"`);
  }

  const sourceRefs = toSourceRefs(raw.sourceRefs, warnings);
  const entities: SemanticGraphEntity[] = Array.isArray(raw.entities)
    ? (raw.entities as SemanticGraphEntity[])
    : [];
  const relationships: SemanticGraphRelationship[] = Array.isArray(raw.relationships)
    ? (raw.relationships as SemanticGraphRelationship[])
    : [];
  const properties =
    raw.properties && typeof raw.properties === "object"
      ? (raw.properties as Record<string, unknown>)
      : {};
  const objectProperties: SemanticObjectProperty[] = Array.isArray(raw.objectProperties)
    ? (raw.objectProperties as SemanticObjectProperty[])
    : relationships
        .filter((rel) => Boolean(rel?.from && rel?.to && rel?.type))
        .map((rel) => ({
          id: rel.id,
          from: rel.from,
          to: rel.to,
          type: rel.type,
          confidence: typeof rel.confidence === "number" ? rel.confidence : null,
        }));
  const datatypeProperties: SemanticDatatypeProperty[] = Array.isArray(raw.datatypeProperties)
    ? (raw.datatypeProperties as SemanticDatatypeProperty[])
    : Object.entries(properties).map(([key, value]) => ({
        key,
        value,
        valueType: Array.isArray(value) ? "array" : value === null ? "null" : typeof value,
      }));
  const annotationProperties: SemanticAnnotationProperty[] = Array.isArray(raw.annotationProperties)
    ? (raw.annotationProperties as SemanticAnnotationProperty[])
    : [
        { key: "sourceRefs", value: sourceRefs },
        { key: "provenance", value: raw.provenance ?? null },
      ];

  const owlClassRaw = raw.owlClass ?? raw["@type"] ?? kind;
  const owlClass = typeof owlClassRaw === "string" || Array.isArray(owlClassRaw)
    ? (owlClassRaw as SemanticGraphRecord["owlClass"])
    : null;
  const owlIndividual = asString(raw.owlIndividual).trim() || asString(raw["@id"]).trim() || id;

  const record: SemanticGraphRecord = {
    id,
    graph: options.graph,
    kind,
    label,
    summary,
    entities,
    relationships,
    properties,
    owlClass,
    owlIndividual: owlIndividual || null,
    objectProperties,
    datatypeProperties,
    annotationProperties,
    sourceRefs,
    confidence: Number.isFinite(Number(raw.confidence)) ? Number(raw.confidence) : null,
    vectorText: asString(raw.vectorText).trim() || summary || null,
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

  for (const key of Object.keys(raw)) {
    if (key.startsWith("@") && key !== "@context" && key !== "@id" && key !== "@type") {
      warnings.push(`unsupported JSON-LD field "${key}"`);
      annotationProperties.push({ key, value: raw[key] });
    }
  }
  return { record, warnings };
}

export function validateSemanticGraphRecord(
  record: SemanticGraphRecord,
  context?: { source: "knowgraph" | "thinkgraph" },
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!asString(record.id).trim() && !asString(record["@id"]).trim()) errors.push("missing id / @id");
  if (!asString(record.graph).trim()) errors.push("missing graph");
  const hasType = Boolean(record["@type"] && asString(record["@type"]).trim());
  const hasOwlClass = Boolean(record.owlClass && asString(record.owlClass).trim());
  if (!asString(record.kind).trim() && !hasType && !hasOwlClass) errors.push("missing kind / @type / owlClass");
  if (!asString(record.label).trim()) errors.push("missing label");
  if (!asString(record.writer).trim()) errors.push("missing writer");
  if (!asString(record.writeMode).trim()) errors.push("missing writeMode");
  if (!record.provenance || typeof record.provenance !== "object") errors.push("missing provenance");
  if (!asString(record.summary).trim()) warnings.push("empty summary");
  if (!asString(record.vectorText).trim()) warnings.push("no vectorText");
  if (typeof record.confidence === "number" && record.confidence < 0.5) warnings.push("low confidence");
  if (!Array.isArray(record.relationships) || record.relationships.length === 0) warnings.push("no relationships");

  for (const rel of record.relationships || []) {
    if (!rel?.from || !rel?.to || !rel?.type) {
      errors.push("malformed relationship / object property assertion");
      break;
    }
  }
  for (const rel of record.objectProperties || []) {
    if (!rel?.from || !rel?.to || !rel?.type) {
      errors.push("malformed relationship / object property assertion");
      break;
    }
  }
  for (const prop of record.datatypeProperties || []) {
    if (!prop?.key) {
      errors.push("malformed property / datatype property assertion");
      break;
    }
  }

  if (context?.source === "thinkgraph" && (!record.sourceRefs || record.sourceRefs.length === 0)) {
    warnings.push("ThinkGraph record missing sourceRefs");
  }
  if (
    context?.source === "knowgraph" &&
    (record.kind === "claim" || record.kind === "evidence" || record.kind === "source") &&
    (!record.sourceRefs || record.sourceRefs.length === 0)
  ) {
    const confidence = typeof record.confidence === "number" ? record.confidence : 0;
    if (confidence < 0.35) warnings.push("KnowGraph record missing sourceRefs with low confidence");
    else errors.push("KnowGraph source-backed claim/evidence missing sourceRef");
  }

  for (const ref of record.sourceRefs || []) {
    if (ref.type === "url" && !/^https?:\/\//i.test(ref.ref || "")) {
      errors.push("URL source missing openable ref");
    } else if (ref.type !== "url" && !ref.ref) {
      warnings.push("source target not currently openable");
    }
  }

  for (const ann of record.annotationProperties || []) {
    if (ann?.key?.startsWith("@") && ann.key !== "@context" && ann.key !== "@id" && ann.key !== "@type") {
      warnings.push("unsupported OWL field retained as annotation");
      break;
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function normalizeKnowGraphOutputToSemanticRecordsWithValidation(
  payload: unknown,
): { records: SemanticGraphRecord[]; validation: ValidationResult } {
  const now = new Date().toISOString();
  const rows = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as any).records)
      ? ((payload as any).records as unknown[])
      : [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const records: SemanticGraphRecord[] = [];
  for (const row of rows) {
    const normalized = normalizeRecord(row, {
      graph: "know",
      defaultKind: "claim",
      writer: "knowgraph-agent",
      now,
    });
    warnings.push(...normalized.warnings);
    if (!normalized.record) continue;
    const validation = validateSemanticGraphRecord(normalized.record, { source: "knowgraph" });
    warnings.push(...validation.warnings.map((w) => `${normalized.record?.id}: ${w}`));
    if (!validation.ok) {
      errors.push(...validation.errors.map((e) => `${normalized.record?.id}: ${e}`));
      continue;
    }
    records.push(normalized.record);
  }
  return { records, validation: { ok: errors.length === 0, errors, warnings } };
}

export function normalizeKnowGraphOutputToSemanticRecords(
  payload: unknown,
): SemanticGraphRecord[] {
  return normalizeKnowGraphOutputToSemanticRecordsWithValidation(payload).records;
}

export function normalizeThinkGraphOutputToSemanticRecordsWithValidation(
  payload: unknown,
): { records: SemanticGraphRecord[]; validation: ValidationResult } {
  const now = new Date().toISOString();
  const rows = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as any).records)
      ? ((payload as any).records as unknown[])
      : [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const records: SemanticGraphRecord[] = [];
  for (const row of rows) {
    const normalized = normalizeRecord(row, {
      graph: "think",
      defaultKind: "summary",
      writer: "thinkgraph-agent",
      now,
    });
    warnings.push(...normalized.warnings);
    if (!normalized.record) continue;
    const validation = validateSemanticGraphRecord(normalized.record, { source: "thinkgraph" });
    warnings.push(...validation.warnings.map((w) => `${normalized.record?.id}: ${w}`));
    if (!validation.ok) {
      errors.push(...validation.errors.map((e) => `${normalized.record?.id}: ${e}`));
      continue;
    }
    records.push(normalized.record);
  }
  return { records, validation: { ok: errors.length === 0, errors, warnings } };
}

export function normalizeThinkGraphOutputToSemanticRecords(
  payload: unknown,
): SemanticGraphRecord[] {
  return normalizeThinkGraphOutputToSemanticRecordsWithValidation(payload).records;
}

export function canApplyGraphUpdateRequest(actor: string): boolean {
  const normalized = asString(actor).trim().toLowerCase();
  return (
    normalized === "thinkgraph-agent" ||
    normalized === "knowgraph-agent" ||
    normalized === "codegraph-agent"
  );
}