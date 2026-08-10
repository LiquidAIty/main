import { createHash } from 'node:crypto';

export type ToolInputDictionarySource = {
  sourceId?: unknown;
  kind?: unknown;
  namespace?: unknown;
  name?: unknown;
  id?: unknown;
  title?: unknown;
  displayName?: unknown;
  nativeName?: unknown;
  description?: unknown;
  inputSchema?: unknown;
  capability?: unknown;
  enabled?: unknown;
  availability?: unknown;
  publication?: unknown;
  execution?: unknown;
  metadata?: unknown;
};

export type ToolInputReference = {
  canonicalId: string;
  kind: 'tool' | 'agent';
  namespace: string;
  sourceId: string;
  sourceIds: string[];
  nativeName: string;
  displayName: string;
  shortDescription: string;
  availability: 'available' | 'disabled';
  enabled: boolean;
  effect?: string;
  location?: string;
  schemaHash: string;
  publication: {
    externalMcp: boolean;
  };
  execution: {
    authority: string;
    nativeName: string;
  };
  schemaVersion?: string;
  latency?: string;
  reliability?: string;
  cost?: string;
  capability: {
    runtimeCompatibility: string[];
    assignableRuntimeBindings: string[];
    assignableRuntimeTypes: string[];
    cardAssignable: boolean;
  };
};

export type ToolInputImplementation = {
  sourceId: string;
  kind: ToolInputReference['kind'];
  nativeName: string;
  enabled: boolean;
  publication: ToolInputReference['publication'];
  execution: ToolInputReference['execution'];
  inputSchema: Record<string, unknown>;
  capability: ToolInputReference['capability'];
};

export type ToolInputDefinition = ToolInputReference & {
  implementations: ToolInputImplementation[];
};

export type ToolInputDataDictionary = {
  references: ToolInputReference[];
  definitionsById: ReadonlyMap<string, ToolInputDefinition>;
};

export type ToolInputSearch = {
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

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function schemaHash(schema: Record<string, unknown>): string {
  return createHash('sha256').update(stableJson(schema)).digest('hex');
}

function namespaceFor(id: string): string {
  const separator = id.indexOf('.');
  return separator > 0 ? id.slice(0, separator) : 'main';
}

function optionalText(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = asText(metadata[key]);
  return value || undefined;
}

function definitionFrom(source: ToolInputDictionarySource): ToolInputDefinition {
  const canonicalId = asText(source.name) || asText(source.id);
  if (!canonicalId) throw new Error('tool_input_dictionary_id_missing');
  const sourceId = asText(source.sourceId) || 'main_mcp';
  if (!source.inputSchema || typeof source.inputSchema !== 'object' || Array.isArray(source.inputSchema)) {
    throw new Error(`tool_input_dictionary_schema_invalid:${canonicalId}`);
  }
  const inputSchema = source.inputSchema as Record<string, unknown>;
  const capability = object(source.capability);
  const publication = object(source.publication);
  const sourceExecution = object(source.execution);
  const metadata = object(source.metadata);
  const enabled = source.enabled !== false && source.availability !== 'disabled';
  const displayName = asText(source.title) || asText(source.displayName) || canonicalId;
  const description = asText(source.description);
  const nativeName = asText(source.nativeName) || canonicalId;
  const kind = source.kind === 'agent' ? 'agent' : 'tool';
  const execution = object(metadata.runtimeExecution);
  const referenceCapability = {
    runtimeCompatibility: stringArray(capability.runtimeCompatibility),
    assignableRuntimeBindings: stringArray(capability.assignableRuntimeBindings),
    assignableRuntimeTypes: stringArray(capability.assignableRuntimeTypes),
    cardAssignable: capability.cardAssignable === true,
  };
  return {
    canonicalId,
    kind,
    namespace: asText(source.namespace) || namespaceFor(canonicalId),
    sourceId,
    sourceIds: [sourceId],
    nativeName,
    displayName,
    shortDescription: description.slice(0, 280),
    availability: enabled ? 'available' : 'disabled',
    enabled,
    publication: {
      externalMcp: publication.externalMcp === true,
    },
    execution: {
      authority: asText(sourceExecution.authority) || sourceId,
      nativeName: asText(sourceExecution.nativeName) || nativeName,
    },
    ...(optionalText(execution, 'risk') ? { effect: optionalText(execution, 'risk') } : {}),
    ...(optionalText(capability, 'location') ? { location: optionalText(capability, 'location') } : {}),
    ...(optionalText(metadata, 'schemaVersion') ? { schemaVersion: optionalText(metadata, 'schemaVersion') } : {}),
    ...(optionalText(metadata, 'latency') ? { latency: optionalText(metadata, 'latency') } : {}),
    ...(optionalText(metadata, 'reliability') ? { reliability: optionalText(metadata, 'reliability') } : {}),
    ...(optionalText(metadata, 'cost') ? { cost: optionalText(metadata, 'cost') } : {}),
    schemaHash: schemaHash(inputSchema),
    capability: referenceCapability,
    implementations: [{
      sourceId,
      kind,
      nativeName,
      enabled,
      publication: {
        externalMcp: publication.externalMcp === true,
      },
      execution: {
        authority: asText(sourceExecution.authority) || sourceId,
        nativeName: asText(sourceExecution.nativeName) || nativeName,
      },
      inputSchema,
      capability: referenceCapability,
    }],
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function mergeDefinitions(
  current: ToolInputDefinition,
  incoming: ToolInputDefinition,
): ToolInputDefinition {
  const incomingSourceId = incoming.implementations[0].sourceId;
  if (current.sourceIds.includes(incomingSourceId)) {
    throw new Error(`tool_input_dictionary_duplicate_id:${incoming.canonicalId}`);
  }
  if (current.kind !== incoming.kind) {
    throw new Error(`tool_input_dictionary_kind_conflict:${incoming.canonicalId}`);
  }
  const implementations = [...current.implementations, ...incoming.implementations];
  const enabled = implementations.some((implementation) => implementation.enabled);
  return {
    ...current,
    sourceId: 'federated',
    sourceIds: [...current.sourceIds, incomingSourceId],
    nativeName: current.canonicalId,
    displayName: current.displayName || incoming.displayName,
    shortDescription: current.shortDescription || incoming.shortDescription,
    availability: enabled ? 'available' : 'disabled',
    enabled,
    publication: {
      externalMcp: implementations.some(
        (implementation) => implementation.publication.externalMcp,
      ),
    },
    execution: {
      authority: 'federated',
      nativeName: current.canonicalId,
    },
    schemaHash: schemaHash({
      implementations: implementations.map((implementation) => ({
        sourceId: implementation.sourceId,
        inputSchema: implementation.inputSchema,
      })),
    }),
    capability: {
      runtimeCompatibility: unique(implementations.flatMap(
        (implementation) => implementation.capability.runtimeCompatibility,
      )),
      assignableRuntimeBindings: unique(implementations.flatMap(
        (implementation) => implementation.capability.assignableRuntimeBindings,
      )),
      assignableRuntimeTypes: unique(implementations.flatMap(
        (implementation) => implementation.capability.assignableRuntimeTypes,
      )),
      cardAssignable: implementations.some(
        (implementation) => implementation.capability.cardAssignable,
      ),
    },
    implementations,
  };
}

export function buildToolInputDataDictionary(
  catalog: readonly ToolInputDictionarySource[],
): ToolInputDataDictionary {
  const sourceDefinitions = catalog.map(definitionFrom);
  const definitionsById = new Map<string, ToolInputDefinition>();
  for (const definition of sourceDefinitions) {
    const current = definitionsById.get(definition.canonicalId);
    definitionsById.set(
      definition.canonicalId,
      current ? mergeDefinitions(current, definition) : definition,
    );
  }
  const definitions = [...definitionsById.values()]
    .sort((left, right) => left.canonicalId.localeCompare(right.canonicalId));
  const references = definitions.map(({ implementations: _implementations, ...reference }) => reference);
  return { references, definitionsById };
}

export function resolveToolInputDefinitions(
  dictionary: ToolInputDataDictionary,
  selectedIds: readonly string[],
): ToolInputDefinition[] {
  const seen = new Set<string>();
  return selectedIds.map((rawId) => {
    const id = asText(rawId);
    if (!id) throw new Error('tool_input_dictionary_selected_id_empty');
    if (seen.has(id)) throw new Error(`tool_input_dictionary_selected_id_duplicate:${id}`);
    seen.add(id);
    const definition = dictionary.definitionsById.get(id);
    if (!definition) throw new Error(`tool_input_dictionary_selected_id_unknown:${id}`);
    return definition;
  });
}

export function searchToolInputReferences(dictionary: ToolInputDataDictionary, search: ToolInputSearch) {
  const query = asText(search.query).toLowerCase();
  const namespace = asText(search.namespace).toLowerCase();
  const selectedIds = (search.selectedIds || []).map(asText).filter(Boolean);
  const unresolvedSelectedIds = selectedIds.filter((id) => !dictionary.definitionsById.has(id));
  const offset = Math.max(0, Math.floor(Number(search.offset) || 0));
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(Number(search.limit) || DEFAULT_LIMIT)));
  const matches = dictionary.references.filter((reference) => {
    if (namespace && reference.namespace.toLowerCase() !== namespace) return false;
    if (!query) return true;
    const haystack = [reference.canonicalId, reference.nativeName, reference.namespace, reference.displayName, reference.shortDescription]
      .join('\n').toLowerCase();
    return query.split(/\s+/).every((term) => haystack.includes(term));
  });
  const selectedKnownIds = selectedIds.filter((id) => dictionary.definitionsById.has(id));
  const selectedKnownReferences = resolveToolInputDefinitions(dictionary, selectedKnownIds)
    .map(({ implementations: _implementations, ...reference }) => reference);
  return {
    references: matches.slice(offset, offset + limit),
    selectedKnownReferences,
    unresolvedSelectedIds,
    namespaces: [...new Set(dictionary.references.map((reference) => reference.namespace))].sort(),
    total: matches.length,
    offset,
    limit,
    hasMore: offset + limit < matches.length,
  };
}
