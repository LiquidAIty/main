export type ToolCatalogDefinition = {
  canonicalId: string;
  provider: string;
  providerToolName: string;
  namespace: string;
  publications: Array<'card-runtime' | 'external-mcp'>;
  displayName: string;
  description: string;
  available: boolean;
  grantEligible: boolean;
  access: 'read' | 'write';
  inputSchema: Record<string, unknown>;
  canonicalInputSchema: Record<string, unknown>;
  serverInjectedArguments: string[];
  dispatcherContextArguments: string[];
  dispatcherOwner: string;
  annotations: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  requiredCallerRuntimeKind?: 'hermes';
  requiredCallerRuntimeMode?: 'main' | 'delegate' | 'magentic_one';
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
};

export type ScriptToolSelection = {
  selectedIds: readonly string[];
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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
    definitionsById.set(canonicalId, definition);
  }
  return { references: [...definitions], definitionsById };
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
  const selectedIds = (search.selectedIds || []).map(asText).filter(Boolean);
  const unresolvedSelectedIds = selectedIds.filter((id) => !catalog.definitionsById.has(id));
  const offset = Math.max(0, Math.floor(Number(search.offset) || 0));
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(Number(search.limit) || DEFAULT_LIMIT)));
  const matches = catalog.references.filter((reference) => {
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
    return Boolean(definition && (!access || definition.access === access));
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
): ToolCatalogDefinition[] {
  const selectedIds = selection.selectedIds.map(asText).filter(Boolean);
  const unresolved = selectedIds.find((id) => !catalog.definitionsById.has(id));
  if (unresolved) throw new Error(`tool_catalog_selected_id_unknown:${unresolved}`);
  return resolveToolCatalogDefinitions(catalog, selectedIds)
    .filter((reference) => (
      reference.available
      && reference.grantEligible
      && reference.publications.includes('card-runtime')
    ));
}
