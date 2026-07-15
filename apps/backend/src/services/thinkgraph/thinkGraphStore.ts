// Thin canonical ThinkGraph contract over the Engraphis-v2 Python authority.
// TypeScript validates bounded transport shape only. It never interprets graph
// content and never reads or writes legacy AGE.
import {
  applyThinkGraphPatchOnPython,
  fetchThinkGraphScope,
} from '../autogen/autogenOrchestratorClient';

export type ThinkGraphViewNode = {
  id: string;
  label: string;
  kind: 'resource' | 'statement';
  itemKind?: string;
  review?: string;
  turnId?: string;
  degree?: number;
  properties?: Record<string, unknown>;
  mentionCount: number;
  lastMentionedAt?: string;
  provenanceCount: number;
  conversationId?: string;
  cardId?: string;
  correlationId?: string;
  updatedAt?: string;
};

export type ThinkGraphViewEdge = {
  id: string;
  source: string;
  target: string;
  predicate: string;
  weight?: number;
  latestContextId?: string;
  properties?: Record<string, unknown>;
  mentionCount: number;
  lastMentionedAt?: string;
  provenanceCount: number;
};

export type ThinkGraphView = {
  nodes: ThinkGraphViewNode[];
  edges: ThinkGraphViewEdge[];
};

export type ThinkGraphPatchAuthority = {
  projectId: string;
  cardId: string;
  correlationId: string;
  conversationId: string;
};

export type ThinkGraphProperties = Record<string, string | number | boolean>;

export type ThinkGraphPatch = {
  resources?: Array<{ id: string; label: string; kind?: string; properties?: ThinkGraphProperties }>;
  relations?: Array<{ a: string; b: string }>;
  statements?: Array<{
    id: string;
    subject: string;
    predicateTerm: string;
    object: string;
    rationale?: string;
    review?: string;
    tag?: string;
    properties?: ThinkGraphProperties;
  }>;
};

export type ApplyThinkGraphPatchResult =
  | {
      ok: true;
      status: 'applied' | 'duplicate' | 'empty';
      correlationId: string;
      storedResourceIds: string[];
      storedStatementIds: string[];
      relationCount: number;
    }
  | { ok: false; error: string };

const PATCH_MAX_RESOURCES = 40;
const PATCH_MAX_RELATIONS = 80;
const PATCH_MAX_STATEMENTS = 30;
const PATCH_MAX_TEXT = 2000;
const ITEM_KIND_MAX_LEN = 60;
const RELATION_TAG_MAX_LEN = 60;
const PROPERTIES_MAX_KEYS = 20;
const PROPERTY_KEY_MAX_LEN = 60;
const PROPERTY_VALUE_MAX_LEN = 200;
const REVIEW_REQUIRES_REAL_EVIDENCE = ['source_linked', 'supported', 'evidenced', 'verified'];

function text(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function validatePropertiesShape(id: string, value: unknown): string | null {
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return `patch_properties_must_be_flat_object: ${id}`;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > PROPERTIES_MAX_KEYS) return `patch_properties_too_many_keys: ${id}`;
  for (const [key, item] of entries) {
    if (!key.trim() || key.length > PROPERTY_KEY_MAX_LEN || /\n/.test(key)) {
      return `patch_property_key_not_compact: ${id} (${key})`;
    }
    if (!['string', 'number', 'boolean'].includes(typeof item)) {
      return `patch_property_value_must_be_scalar: ${id} (${key})`;
    }
    if (typeof item === 'string' && (item.length > PROPERTY_VALUE_MAX_LEN || /\n/.test(item))) {
      return `patch_property_value_not_compact: ${id} (${key})`;
    }
  }
  return null;
}

/** Structural/ownership validation only; meaning remains model-authored. */
export function validateThinkGraphPatch(
  authority: ThinkGraphPatchAuthority,
  patch: ThinkGraphPatch,
): string | null {
  for (const key of ['projectId', 'cardId', 'correlationId', 'conversationId'] as const) {
    if (!text(authority?.[key]).trim()) return `patch_authority_${key}_missing`;
  }
  const resources = patch?.resources ?? [];
  const relations = patch?.relations ?? [];
  const statements = patch?.statements ?? [];
  if (resources.length > PATCH_MAX_RESOURCES) return 'patch_too_many_resources';
  if (relations.length > PATCH_MAX_RELATIONS) return 'patch_too_many_relations';
  if (statements.length > PATCH_MAX_STATEMENTS) return 'patch_too_many_statements';
  for (const resource of resources) {
    if (!text(resource?.id).trim()) return 'patch_resource_id_required';
    if (!text(resource?.label).trim()) return `patch_resource_label_required: ${resource.id}`;
    if (text(resource.label).length > PATCH_MAX_TEXT) return `patch_resource_label_too_long: ${resource.id}`;
    if (resource.kind !== undefined) {
      const kind = text(resource.kind).trim();
      if (!kind) return `patch_resource_kind_empty: ${resource.id}`;
      if (kind.length > ITEM_KIND_MAX_LEN || /\n/.test(kind)) {
        return `patch_resource_kind_not_compact: ${resource.id}`;
      }
    }
    const propertiesError = validatePropertiesShape(text(resource.id), resource.properties);
    if (propertiesError) return propertiesError;
  }
  for (const relation of relations) {
    const a = text(relation?.a).trim();
    const b = text(relation?.b).trim();
    if (!a || !b) return 'patch_relation_endpoints_required';
    if (a === b) return `patch_relation_self_pair_rejected: ${a}`;
  }
  for (const statement of statements) {
    if (!text(statement?.id).trim()) return 'patch_statement_id_required';
    if (!text(statement?.subject).trim() || !text(statement?.object).trim()) {
      return `patch_statement_endpoints_required: ${statement.id}`;
    }
    if (!text(statement?.predicateTerm).trim()) {
      return `patch_statement_predicate_required: ${statement.id}`;
    }
    const review = text(statement?.review).trim().toLowerCase();
    if (review && REVIEW_REQUIRES_REAL_EVIDENCE.includes(review)) {
      return `patch_statement_review_requires_persisted_source_provenance: ${statement.id} (${review})`;
    }
    if (statement.tag !== undefined) {
      const tag = text(statement.tag).trim();
      if (!tag) return `patch_statement_tag_empty: ${statement.id}`;
      if (tag.length > RELATION_TAG_MAX_LEN || /\n/.test(tag)) {
        return `patch_statement_tag_not_compact: ${statement.id}`;
      }
    }
    const propertiesError = validatePropertiesShape(text(statement.id), statement.properties);
    if (propertiesError) return propertiesError;
  }
  return null;
}

export async function getThinkGraphView(args: {
  projectId: string;
  limit?: number;
}): Promise<ThinkGraphView> {
  const projectId = text(args.projectId).trim();
  if (!projectId) return { nodes: [], edges: [] };
  const limit = Math.min(Math.max(Math.trunc(args.limit ?? 500) || 500, 1), 2000);
  const result = (await fetchThinkGraphScope(projectId, limit)) as ThinkGraphView;
  if (!result || !Array.isArray(result.nodes) || !Array.isArray(result.edges)) {
    throw new Error('thinkgraph_engraphis_scope_invalid');
  }
  return result;
}

export async function readThinkGraphScope(args: {
  projectId: string;
  limit?: number;
}): Promise<ThinkGraphView> {
  return getThinkGraphView({
    projectId: args.projectId,
    limit: Math.min(Math.trunc(args.limit ?? 300) || 300, 500),
  });
}

export async function applyThinkGraphPatch(
  authority: ThinkGraphPatchAuthority,
  patch: ThinkGraphPatch,
): Promise<ApplyThinkGraphPatchResult> {
  const error = validateThinkGraphPatch(authority, patch);
  if (error) return { ok: false, error };
  const result = (await applyThinkGraphPatchOnPython(authority, patch)) as ApplyThinkGraphPatchResult;
  if (!result || typeof result.ok !== 'boolean') {
    return { ok: false, error: 'thinkgraph_engraphis_write_invalid_response' };
  }
  return result;
}
