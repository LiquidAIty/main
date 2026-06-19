// Shared Neo4j-safe property serializer. Neo4j node/edge properties must be primitives or
// arrays of primitives — never maps or arrays-of-maps. Keep primitives and string/number/
// boolean arrays as-is; JSON-stringify any nested object / array-of-object so writes persist
// instead of throwing "Property values can only be of primitive types or arrays thereof".
// Reused by the KnowGraph semantic seed and the search-evidence ingest.
export function toNeoSafeProperties(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined) {
      out[key] = null;
    } else if (Array.isArray(value)) {
      const allPrimitive = value.every(
        (item) => item === null || ['string', 'number', 'boolean'].includes(typeof item),
      );
      out[key] = allPrimitive ? value : JSON.stringify(value);
    } else if (typeof value === 'object') {
      out[key] = JSON.stringify(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}
