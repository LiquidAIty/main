export type NativeToolContract = {
  sourceId: string;
  nativeName: string;
  connectionKind: string;
  available: boolean;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  securitySchemes?: Record<string, unknown>[];
};

export type ToolCatalogReference = {
  canonicalId: string;
  kind: 'tool' | 'agent';
  namespace: string;
  sourceIds: string[];
  displayName: string;
  shortDescription: string;
  availability: 'available' | 'disabled';
  contracts: NativeToolContract[];
  requiredCallerRuntimeBinding?: string;
};

export type ToolCatalogIndex = {
  references: ToolCatalogReference[];
  definitionsById: ReadonlyMap<string, ToolCatalogReference>;
};

export type ToolCatalogSearch = {
  query?: string;
  namespace?: string;
  selectedIds?: readonly string[];
  offset?: number;
  limit?: number;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Index already-materialized IDD references for lookup only. No metadata is
 * inferred, merged, scored, or classified in TypeScript. */
export function indexToolCatalogReferences(
  references: readonly ToolCatalogReference[],
): ToolCatalogIndex {
  const definitionsById = new Map<string, ToolCatalogReference>();
  for (const reference of references) {
    const canonicalId = asText(reference.canonicalId);
    if (!canonicalId) throw new Error('tool_catalog_id_missing');
    if (definitionsById.has(canonicalId)) {
      throw new Error(`tool_catalog_duplicate_id:${canonicalId}`);
    }
    definitionsById.set(canonicalId, reference);
  }
  return { references: [...references], definitionsById };
}

export function resolveToolCatalogDefinitions(
  catalog: ToolCatalogIndex,
  selectedIds: readonly string[],
): ToolCatalogReference[] {
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

export function searchToolCatalogReferences(catalog: ToolCatalogIndex, search: ToolCatalogSearch) {
  const query = asText(search.query).toLowerCase();
  const namespace = asText(search.namespace).toLowerCase();
  const selectedIds = (search.selectedIds || []).map(asText).filter(Boolean);
  const unresolvedSelectedIds = selectedIds.filter((id) => !catalog.definitionsById.has(id));
  const offset = Math.max(0, Math.floor(Number(search.offset) || 0));
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(Number(search.limit) || DEFAULT_LIMIT)));
  const matches = catalog.references.filter((reference) => {
    if (namespace && reference.namespace.toLowerCase() !== namespace) return false;
    if (!query) return true;
    const haystack = [
      reference.canonicalId,
      reference.namespace,
      reference.displayName,
      reference.shortDescription,
      ...reference.sourceIds,
      ...reference.contracts.map((contract) => contract.nativeName),
    ].join('\n').toLowerCase();
    return query.split(/\s+/).every((term) => haystack.includes(term));
  });
  const selectedKnownIds = selectedIds.filter((id) => catalog.definitionsById.has(id));
  return {
    references: matches.slice(offset, offset + limit),
    selectedKnownReferences: resolveToolCatalogDefinitions(catalog, selectedKnownIds),
    unresolvedSelectedIds,
    namespaces: [...new Set(catalog.references.map((reference) => reference.namespace))].sort(),
    total: matches.length,
    offset,
    limit,
    hasMore: offset + limit < matches.length,
  };
}
