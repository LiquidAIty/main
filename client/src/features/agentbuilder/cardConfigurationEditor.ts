import type { CardRuntime, SavedCardConfiguration } from '../../types/agentgraph';

export type CardEditorModelOption = {
  key: string;
  label: string;
  providerModelId: string;
};

export type CardEditorAutoModelCandidate = {
  provider: string;
  accessMode: string;
  modelKey: string;
  eligible: boolean;
};

export type InputDictionaryEditorOption = {
  value: string;
  label: string;
  when?: Record<string, string>;
};

export type InputDictionaryEditorField = {
  name: string;
  label: string;
  path: string;
  control: 'select' | 'catalog-select' | 'catalog-multiselect' | 'number' | 'integer' | 'text' | 'checkbox';
  allowUnset?: boolean;
  catalog?: string;
  filteredBy?: string;
  minimum?: number;
  maximum?: number;
  step?: number;
  blockedRuntimeBindings?: string[];
  blockedRuntimeTypes?: string[];
  help?: string;
  options?: InputDictionaryEditorOption[];
};

export type InputDictionaryToolReference = {
  canonicalId: string;
  provider: string;
  providerToolName: string;
  namespace?: string;
  displayName?: string;
  description?: string;
  available: boolean;
  access: 'read' | 'write';
};

export type InputDictionaryToolPage = {
  references: InputDictionaryToolReference[];
  selectedKnownReferences: InputDictionaryToolReference[];
  unresolvedSelectedIds: string[];
  namespaces: string[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
};

export type DisplayedToolRow = {
  name: string;
  title?: string;
  description?: string;
  availability: 'available' | 'disabled' | 'stale';
};

export type CardEditorConfiguration = {
  runtime: CardRuntime;
  runtime_options?: SavedCardConfiguration | null;
  parent_graph_id?: string | null;
  role?: string | null;
  output_contract?: unknown;
  provider?: 'openai' | 'openrouter' | 'local_openai_compatible' | '' | null;
  access_mode?: 'chatgpt-account' | 'openai-api' | 'openrouter-api' | '' | null;
  model_key?: string | null;
  prompt_template?: string | null;
  tools?: unknown[];
  skills?: unknown[];
  toolsets?: unknown[];
  mcp_connection_ids?: unknown[];
};

export type CardPromptFields = {
  role: string;
  goal: string;
  constraints: string;
  ioSchema: string;
  memoryPolicy: string;
  outputExpectations: string;
  connectedAgents: string;
};

const PROMPT_HEADINGS: Record<string, keyof CardPromptFields> = {
  ROLE: 'role',
  GOAL: 'goal',
  CONSTRAINTS: 'constraints',
  IO_SCHEMA: 'ioSchema',
  INPUT_SCHEMA: 'ioSchema',
  MEMORY_POLICY: 'memoryPolicy',
  OUTPUT_EXPECTATIONS: 'outputExpectations',
  OUTPUT_CONTRACT: 'outputExpectations',
  OUTPUT_REQUIREMENTS: 'outputExpectations',
  ALL_CONNECTED_AGENTS: 'connectedAgents',
  ALL_AGENTS_CONNECTED: 'connectedAgents',
};

const CANONICAL_PROMPT_HEADING: Record<keyof CardPromptFields, string> = {
  role: 'ROLE',
  goal: 'GOAL',
  constraints: 'CONSTRAINTS',
  ioSchema: 'IO_SCHEMA',
  memoryPolicy: 'MEMORY_POLICY',
  outputExpectations: 'OUTPUT_EXPECTATIONS',
  connectedAgents: 'ALL CONNECTED AGENTS',
};

function promptHeadingKey(label: string): string {
  return label.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function promptHeadings(template: string): Array<{ label: string; index: number; end: number }> {
  const headings: Array<{ label: string; index: number; end: number }> = [];
  let fence: string | null = null;
  for (const line of template.matchAll(/^.*(?:\r?\n|$)/gm)) {
    const marker = line[0].match(/^\s*(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
      continue;
    }
    if (fence) continue;
    const heading = line[0].match(/^(?:\[([^\]\r\n]+)\][ \t]*|#{1,6}[ \t]+([^\r\n]+))(?:\r?\n|$)/);
    if (heading) {
      headings.push({
        label: heading[1] ?? heading[2],
        index: line.index!,
        end: line.index! + line[0].length,
      });
    }
  }
  return headings;
}

export function cardPromptFieldRanges(template: string): Array<{
  key: string;
  label: string;
  start: number;
  end: number;
}> {
  const headings = promptHeadings(template);
  const ranges: Array<{ key: string; label: string; start: number; end: number }> = [];
  const seen = new Set<keyof CardPromptFields>();
  headings.forEach((heading, index) => {
    const field = PROMPT_HEADINGS[promptHeadingKey(heading.label)];
    const key = field && !seen.has(field) ? field : `section:${heading.index}`;
    if (field) seen.add(field);
    const start = heading.end;
    const end = headings[index + 1]?.index ?? template.length;
    const body = template.slice(start, end);
    const leading = body.match(/^\s*/)?.[0].length || 0;
    const trailing = body.match(/\s*$/)?.[0].length || 0;
    ranges.push({
      key,
      label: heading.label,
      start: start + leading,
      end: Math.max(start + leading, end - trailing),
    });
  });
  const preambleEnd = headings[0]?.index ?? template.length;
  if (template.slice(0, preambleEnd).trim()) {
    ranges.unshift({ key: 'instructions', label: 'Instructions', start: 0, end: preambleEnd });
  }
  return ranges;
}

export function parseCardListEditorText(value: string): string[] {
  const text = String(value || '').trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean);
    }
  } catch {
    // Saved text also accepts the editor's newline/comma form.
  }
  return text
    .split(/[\r\n,]+/)
    .map((entry) => entry.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean);
}

export function parseCardEditorOptions(payload: unknown): {
  fields: InputDictionaryEditorField[];
  modelsByProvider: Record<string, CardEditorModelOption[]>;
  autoModelCandidates: CardEditorAutoModelCandidate[];
} {
  if (!payload || typeof payload !== 'object') throw new Error('runtime_options_invalid');
  const document = payload as Record<string, unknown>;
  if (!Array.isArray(document.fields)) throw new Error('runtime_options_invalid');
  const fields = document.fields.filter((field): field is InputDictionaryEditorField => (
    Boolean(field)
    && typeof field === 'object'
    && typeof (field as InputDictionaryEditorField).name === 'string'
    && typeof (field as InputDictionaryEditorField).label === 'string'
    && typeof (field as InputDictionaryEditorField).control === 'string'
  ));
  const catalogs = document.catalogs && typeof document.catalogs === 'object'
    ? document.catalogs as Record<string, unknown>
    : {};
  const models = Array.isArray(catalogs['configured-models'])
    ? catalogs['configured-models']
    : [];
  const modelsByProvider: Record<string, CardEditorModelOption[]> = {};
  for (const rawModel of models) {
    if (!rawModel || typeof rawModel !== 'object') continue;
    const model = rawModel as Record<string, unknown>;
    const provider = String(model.provider || '').trim();
    const key = String(model.key || '').trim();
    const label = String(model.label || '').trim();
    const providerModelId = String(model.providerModelId || '').trim();
    if (!provider || !key || !label || !providerModelId) continue;
    (modelsByProvider[provider] ||= []).push({ key, label, providerModelId });
  }
  const autoModelCandidates = Array.isArray(document.autoModelCandidates)
    ? document.autoModelCandidates
      .filter((value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value))
      .map((value) => value as Record<string, unknown>)
      .filter((value) => (
        typeof value.provider === 'string'
        && typeof value.accessMode === 'string'
        && typeof value.modelKey === 'string'
        && typeof value.eligible === 'boolean'
      ))
      .map((value) => ({
        provider: String(value.provider), accessMode: String(value.accessMode),
        modelKey: String(value.modelKey), eligible: value.eligible === true,
      }))
    : [];
  return { fields, modelsByProvider, autoModelCandidates };
}

export function buildInputDictionarySelectedRows(
  selectedReferences: InputDictionaryToolReference[],
  unresolvedSelectedIds: string[],
): DisplayedToolRow[] {
  const known = selectedReferences.map((reference) => ({
    name: reference.canonicalId,
    title: reference.displayName || reference.canonicalId,
    description: reference.description,
    availability: reference.available ? 'available' as const : 'disabled' as const,
  }));
  const knownNames = new Set(known.map((reference) => reference.name));
  return [
    ...known,
    ...unresolvedSelectedIds
      .filter((canonicalId) => !knownNames.has(canonicalId))
      .map((canonicalId) => ({ name: canonicalId, availability: 'stale' as const })),
  ];
}

export function toggleSavedToolAssignment(
  savedToolNames: string[],
  name: string,
  checked: boolean,
): string[] {
  if (checked) return savedToolNames.includes(name) ? savedToolNames : [...savedToolNames, name];
  return savedToolNames.filter((savedName) => savedName !== name);
}

export function assertUniqueCanonicalPromptSections(template: string): void {
  const seen = new Set<keyof CardPromptFields>();
  for (const heading of promptHeadings(template)) {
    const field = PROMPT_HEADINGS[promptHeadingKey(heading.label)];
    if (!field) continue;
    if (seen.has(field)) {
      const canonical = CANONICAL_PROMPT_HEADING[field];
      throw new Error(`card_prompt_duplicate_section:${canonical}. Keep exactly one [${canonical}] block before saving.`);
    }
    seen.add(field);
  }
}

export function parseCardPromptTemplate(
  template: string,
): CardPromptFields & Record<string, string> {
  const fields: CardPromptFields & Record<string, string> = {
    role: '',
    goal: '',
    constraints: '',
    ioSchema: '',
    memoryPolicy: '',
    outputExpectations: '',
    connectedAgents: '',
  };
  for (const range of cardPromptFieldRanges(template)) {
    fields[range.key] = template.slice(range.start, range.end);
  }
  return fields;
}

export function serializeCardPromptFields(
  fields: CardPromptFields & Record<string, string>,
  original: string,
  edited: Record<string, boolean>,
): string {
  const ranges = cardPromptFieldRanges(original);
  const previous = parseCardPromptTemplate(original);
  let result = original;
  for (const range of [...ranges].reverse()) {
    if (edited[range.key] && fields[range.key] !== previous[range.key]) {
      result = result.slice(0, range.start) + fields[range.key] + result.slice(range.end);
    }
  }
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  for (const [key, heading] of Object.entries(CANONICAL_PROMPT_HEADING) as Array<[
    keyof CardPromptFields,
    string,
  ]>) {
    if (!edited[key] || ranges.some((range) => range.key === key) || !fields[key]) continue;
    result += `${result ? newline + newline : ''}[${heading}]${newline}${fields[key]}`;
  }
  return result;
}

export function buildCardConfigurationFromEditorFields(input: {
  runtime: CardRuntime;
  provider: NonNullable<CardEditorConfiguration['provider']>;
  accessMode: 'chatgpt-account' | 'openai-api' | 'openrouter-api' | '';
  modelKey: string;
  promptTemplate: string;
  toolsText: string;
  skillsText: string;
  toolsetsText: string;
  mcpConnectionIdsText: string;
}): CardEditorConfiguration {
  return {
    runtime: input.runtime,
    provider: input.provider,
    access_mode: input.accessMode,
    model_key: input.modelKey || null,
    prompt_template: input.promptTemplate,
    tools: parseCardListEditorText(input.toolsText),
    skills: parseCardListEditorText(input.skillsText),
    toolsets: parseCardListEditorText(input.toolsetsText),
    mcp_connection_ids: parseCardListEditorText(input.mcpConnectionIdsText),
  };
}
