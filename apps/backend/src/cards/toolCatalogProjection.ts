// Entity: Tool Catalog
// Relationship: This file indexes immutable live tool definitions and resolves searches, saved selections, profile grants, and executable Card Script tools without inferring metadata.

export type ToolCatalogDefinition = {
  canonicalId: string;
  provider: string;
  providerToolName: string;
  namespace: string;
  publications: Array<'card-profile' | 'external-mcp'>;
  displayName: string;
  description: string;
  available: boolean;
  grantEligible: boolean;
  grantProfiles: string[];
  access: 'read' | 'write';
  inputSchema: Record<string, unknown>;
  canonicalInputSchema: Record<string, unknown>;
  serverInjectedArguments: string[];
  dispatcherContextArguments: string[];
  dispatcherOwner: string;
  annotations: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
};

export type ToolCatalogIndex = {
  references: ToolCatalogDefinition[];
  definitionsById: ReadonlyMap<string, ToolCatalogDefinition>;
};

export type ToolCatalogSearch = {
  query?: string;
  namespace?: string;
  access?: 'read' | 'write';
  selectedIds?: readonly string[];
  offset?: number;
  limit?: number;
  profile?: string;
};

export type ScriptToolSelection = {
  selectedIds: readonly string[];
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export function toolGrantMatchesProfile(
  definition: ToolCatalogDefinition,
  profileValue: unknown,
): boolean {
  if (!definition.grantEligible) return false;
  if (!definition.grantProfiles.length) return true;
  const profile = asText(profileValue).toLowerCase();
  return Boolean(profile) && definition.grantProfiles.includes(profile);
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function immutable<T>(value: T): T {
  const copy = structuredClone(value);
  const freeze = (item: unknown): void => {
    if (!item || typeof item !== 'object' || Object.isFrozen(item)) return;
    for (const child of Object.values(item)) freeze(child);
    Object.freeze(item);
  };
  freeze(copy);
  return copy;
}

function paginationInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isSafeInteger(parsed)) {
    throw new Error('tool_catalog_pagination_invalid');
  }
  return Math.min(maximum, Math.max(minimum, parsed));
}

/** Index already-normalized live catalog references for lookup only. No metadata is
 * inferred, merged, scored, or classified in TypeScript. */
export function indexLiveToolCatalog(
  definitions: readonly ToolCatalogDefinition[],
): ToolCatalogIndex {
  const definitionsById = new Map<string, ToolCatalogDefinition>();
  for (const definition of definitions) {
    const canonicalId = asText(definition.canonicalId);
    if (!canonicalId) throw new Error('tool_catalog_id_missing');
    if (definitionsById.has(canonicalId)) {
      throw new Error(`tool_catalog_duplicate_id:${canonicalId}`);
    }
    definitionsById.set(canonicalId, immutable(definition));
  }
  const references = Object.freeze([...definitionsById.values()]);
  return {
    references: references as unknown as ToolCatalogDefinition[],
    definitionsById,
  };
}

export function resolveToolCatalogDefinitions(
  catalog: ToolCatalogIndex,
  selectedIds: readonly string[],
): ToolCatalogDefinition[] {
  const seen = new Set<string>();
  return selectedIds.map((rawId) => {
    const id = asText(rawId);
    if (!id) throw new Error('tool_catalog_selected_id_empty');
    if (seen.has(id)) throw new Error(`tool_catalog_selected_id_duplicate:${id}`);
    seen.add(id);
    const definition = catalog.definitionsById.get(id);
    if (!definition) throw new Error(`tool_catalog_selected_id_unknown:${id}`);
    return definition;
  });
}

export function searchToolCatalogDefinitions(catalog: ToolCatalogIndex, search: ToolCatalogSearch) {
  const query = asText(search.query).toLowerCase();
  const namespace = asText(search.namespace).toLowerCase();
  const access = search.access;
  const profile = asText(search.profile).toLowerCase();
  const selectedIds = (search.selectedIds || []).map(asText).filter(Boolean);
  const unresolvedSelectedIds = selectedIds.filter((id) => {
    const definition = catalog.definitionsById.get(id);
    return !definition || !toolGrantMatchesProfile(definition, profile);
  });
  const offset = paginationInteger(search.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const limit = paginationInteger(search.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const matches = catalog.references.filter((reference) => {
    if (!toolGrantMatchesProfile(reference, profile)) return false;
    if (access && reference.access !== access) return false;
    if (namespace && reference.namespace.toLowerCase() !== namespace) return false;
    if (!query) return true;
    const haystack = [
      reference.canonicalId,
      reference.namespace,
      reference.displayName,
      reference.description,
      reference.provider,
      reference.providerToolName,
      ...reference.publications,
    ].join('\n').toLowerCase();
    return query.split(/\s+/).every((term) => haystack.includes(term));
  });
  const selectedKnownIds = selectedIds.filter((id) => {
    const definition = catalog.definitionsById.get(id);
    return Boolean(
      definition
      && toolGrantMatchesProfile(definition, profile)
      && (!access || definition.access === access),
    );
  });
  return {
    references: matches.slice(offset, offset + limit),
    selectedKnownReferences: resolveToolCatalogDefinitions(catalog, selectedKnownIds),
    unresolvedSelectedIds,
    namespaces: [...new Set(
      catalog.references
        .filter((reference) => !access || reference.access === access)
        .map((reference) => reference.namespace),
    )].sort(),
    total: matches.length,
    offset,
    limit,
    hasMore: offset + limit < matches.length,
  };
}

/** Resolve the exact executable/autocomplete surface from the live catalog and
 * saved Tools-tab policy used by Run materialization. */
export function resolveScriptToolDefinitions(
  catalog: ToolCatalogIndex,
  selection: ScriptToolSelection,
  profile = '',
): ToolCatalogDefinition[] {
  const selectedIds = selection.selectedIds.map(asText).filter(Boolean);
  const unresolved = selectedIds.find((id) => !catalog.definitionsById.has(id));
  if (unresolved) throw new Error(`tool_catalog_selected_id_unknown:${unresolved}`);
  return resolveToolCatalogDefinitions(catalog, selectedIds)
    .filter((reference) => (
      reference.available
      && toolGrantMatchesProfile(reference, profile)
      && reference.publications.includes('card-profile')
    ));
}
