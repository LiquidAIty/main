import { createHash } from 'node:crypto';

import { exactStrings, objectRecord } from './savedCardAuthority';

export type HermesDynamicToolDefinition = {
  type: 'function';
  name: string;
  canonical_name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export type HermesCardScriptDefinition = {
  version: number;
  source: string;
  source_hash: string;
  compiled_hash: string;
  mode: 'tool_recipe';
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  tool_aliases: Record<string, string>;
  tool_states: Record<string, number>;
  timeout_seconds: number;
  max_tool_calls: number;
  max_output_bytes: number;
};
function hermesDynamicToolName(canonicalName: string): string {
  const stem = canonicalName.replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+/, '').slice(0, 72)
    || 'tool';
  const suffix = createHash('sha256').update(canonicalName).digest('hex').slice(0, 10);
  return `card__${stem}__${suffix}`;
}

export function hermesDynamicToolDefinitions(value: unknown): HermesDynamicToolDefinition[] {
  if (!Array.isArray(value)) return [];
  const seenNames = new Set<string>();
  return value.map(objectRecord).map((definition, index) => {
    const canonicalName = String(definition.canonicalId || '').trim();
    const publications = exactStrings(definition.publications);
    const inputSchema = objectRecord(definition.inputSchema);
    if (
      !canonicalName
      || definition.available !== true
      || !publications.some((item) => item === 'card-runtime' || item === 'external-mcp')
      || !Object.keys(inputSchema).length
    ) {
      throw new Error(`dynamic_tool_contract_unavailable:${canonicalName || index}`);
    }
    const name = hermesDynamicToolName(canonicalName);
    if (seenNames.has(name)) throw new Error(`dynamic_tool_name_collision:${canonicalName}`);
    seenNames.add(name);
    return {
      type: 'function' as const,
      name,
      canonical_name: canonicalName,
      description: String(definition.description || ''),
      input_schema: inputSchema,
    };
  });
}

export function hermesCardScriptDefinition(
  requestValue: unknown,
): HermesCardScriptDefinition | undefined {
  const request = objectRecord(requestValue);
  if (objectRecord(request.scriptPresentation).mode !== 'script') return undefined;
  const script = objectRecord(objectRecord(request.runtimeOptions).script);
  const compiled = objectRecord(script.compiled);
  const source = String(script.source || '');
  const sourceHash = String(script.sourceHash || '');
  const compiledHash = String(script.compiledHash || '');
  const version = Number(script.version);
  const inputSchema = objectRecord(compiled.inputSchema);
  const outputSchema = objectRecord(compiled.outputSchema);
  const toolStates = objectRecord(compiled.toolStates);
  const scriptToolIds = exactStrings(compiled.scriptToolIds);
  const agentToolIds = exactStrings(compiled.agentToolIds);
  const enabledTools = new Set(exactStrings(request.enabledTools));
  const presentedTools = exactStrings(request.presentedTools);
  const boundedInteger = (value: unknown, minimum: number, maximum: number): number => {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
      throw new Error('card_script_compiled_budget_invalid');
    }
    return parsed;
  };
  if (
    !Number.isSafeInteger(version) || version < 1
    || !source.trim() || Buffer.byteLength(source, 'utf8') > 32_768
    || !/^[0-9a-f]{64}$/.test(sourceHash)
    || createHash('sha256').update(source, 'utf8').digest('hex') !== sourceHash
    || !/^[0-9a-f]{64}$/.test(compiledHash)
    || compiled.mode !== 'tool_recipe'
    || inputSchema.type !== 'object'
    || outputSchema.type !== 'object'
    || script.lastValidation === undefined
    || objectRecord(script.lastValidation).status !== 'valid'
  ) {
    throw new Error('card_script_compiled_contract_invalid');
  }
  if (
    [...scriptToolIds, ...agentToolIds].some((name) => !enabledTools.has(name))
    || presentedTools.length !== agentToolIds.length
    || presentedTools.some((name, index) => name !== agentToolIds[index])
  ) {
    throw new Error('card_script_tool_scope_invalid');
  }
  const normalizedStates: Record<string, number> = {};
  for (const [name, rawMode] of Object.entries(toolStates)) {
    const mode = Number(rawMode);
    if (!enabledTools.has(name) || !Number.isInteger(mode) || mode < 0 || mode > 3) {
      throw new Error('card_script_tool_scope_invalid');
    }
    normalizedStates[name] = mode;
  }
  const expectedScriptTools = Object.entries(normalizedStates)
    .filter(([, mode]) => mode === 1 || mode === 3)
    .map(([name]) => name);
  if (
    expectedScriptTools.length !== scriptToolIds.length
    || expectedScriptTools.some((name, index) => name !== scriptToolIds[index])
  ) {
    throw new Error('card_script_tool_scope_invalid');
  }
  return {
    version,
    source,
    source_hash: sourceHash,
    compiled_hash: compiledHash,
    mode: 'tool_recipe',
    input_schema: inputSchema,
    output_schema: outputSchema,
    tool_aliases: Object.fromEntries(scriptToolIds.map((canonicalName) => [
      canonicalName,
      hermesDynamicToolName(canonicalName),
    ])),
    tool_states: normalizedStates,
    timeout_seconds: boundedInteger(compiled.timeoutSeconds, 1, 60),
    max_tool_calls: boundedInteger(compiled.maxToolCalls, 1, 32),
    max_output_bytes: boundedInteger(compiled.maxOutputBytes, 256, 50_000),
  };
}

export function hermesCallbackToolNames(
  dynamicTools: HermesDynamicToolDefinition[],
  cardScript?: HermesCardScriptDefinition,
): string[] {
  return [...new Set([
    ...dynamicTools.map((tool) => tool.canonical_name),
    ...Object.keys(cardScript?.tool_aliases || {}),
  ])];
}
