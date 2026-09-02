import type { AgentCardInstance } from '../../../types/agentgraph';

export type AgentBuilderMode = 'create' | 'edit';

export type AgentBuilderTemplateOption = {
  id: string;
  label: string;
};

export type AgentBuilderModelOption = {
  provider: string;
  modelKey: string;
  providerModelId: string;
  accessMode: 'chatgpt-account' | 'openai-api' | 'openrouter-api';
  label: string;
};

export type AgentBuilderToolOption = {
  id: string;
  label: string;
  access: 'read' | 'write';
  category: string;
};

export type AgentBuilderOperation = {
  mode: AgentBuilderMode;
  expectedDeckRevision: string;
  targetCardId?: string;
  targetCardRevisionId?: string;
  templateId?: string;
  title?: string;
  role?: string;
  prompt: string;
  tools: string[];
  model?: {
    provider: string;
    modelKey: string;
    providerModelId: string;
    accessMode: AgentBuilderModelOption['accessMode'];
  };
  cbmProject?: string;
};

export type AgentBuilderProposal = {
  mode: AgentBuilderMode;
  expectedDeckRevision: string;
  targetCardId?: string;
  targetCardRevisionId?: string;
  configuration?: {
    templateId: string;
    title: string;
    role: string;
    prompt: string;
    tools: string[];
    model: AgentBuilderOperation['model'];
  };
  changes?: {
    prompt: { from: string; to: string };
    tools: { from: string[]; to: string[] };
  };
};

const SYSTEM_TEMPLATE_IDS = new Set([
  'template_main_chat',
  'template_local_coder',
  'template_agent_builder',
  'template_hermes_steward',
  'template_magentic',
]);

function accessMode(provider: string): AgentBuilderModelOption['accessMode'] {
  if (provider === 'openrouter') return 'openrouter-api';
  if (provider === 'openai') return 'chatgpt-account';
  return 'openai-api';
}

export function parseAgentBuilderPalette(payload: unknown): {
  templates: AgentBuilderTemplateOption[];
  models: AgentBuilderModelOption[];
} {
  if (!payload || typeof payload !== 'object') throw new Error('agent_builder_palette_invalid');
  const value = payload as Record<string, unknown>;
  const rawTemplates = value.templates && typeof value.templates === 'object'
    ? value.templates as Record<string, unknown>
    : {};
  const templates = Object.entries(rawTemplates)
    .filter(([id]) => !SYSTEM_TEMPLATE_IDS.has(id))
    .map(([id, definition]) => ({
      id,
      label: definition && typeof definition === 'object'
        ? String((definition as Record<string, unknown>).label || id)
        : id,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
  const catalogs = value.catalogs && typeof value.catalogs === 'object'
    ? value.catalogs as Record<string, unknown>
    : {};
  const rawModels = Array.isArray(catalogs['configured-models'])
    ? catalogs['configured-models']
    : [];
  const models = rawModels.flatMap((entry): AgentBuilderModelOption[] => {
    if (!entry || typeof entry !== 'object') return [];
    const model = entry as Record<string, unknown>;
    const provider = String(model.provider || '').trim();
    const modelKey = String(model.key || '').trim();
    const providerModelId = String(model.providerModelId || '').trim();
    if (!provider || !modelKey || !providerModelId) return [];
    return [{
      provider,
      modelKey,
      providerModelId,
      accessMode: accessMode(provider),
      label: String(model.label || modelKey),
    }];
  });
  if (!templates.length || !models.length) throw new Error('agent_builder_palette_empty');
  return { templates, models };
}

export function parseAgentBuilderTools(payload: unknown): AgentBuilderToolOption[] {
  if (!payload || typeof payload !== 'object') throw new Error('agent_builder_tools_invalid');
  const references = (payload as Record<string, unknown>).references;
  if (!Array.isArray(references)) throw new Error('agent_builder_tools_invalid');
  return references.flatMap((entry): AgentBuilderToolOption[] => {
    if (!entry || typeof entry !== 'object') return [];
    const reference = entry as Record<string, unknown>;
    if (reference.availability !== 'available') return [];
    const id = String(reference.canonicalId || '').trim();
    const access = reference.access === 'write' ? 'write' : 'read';
    if (!id) return [];
    return [{
      id,
      access,
      label: String(reference.displayName || id),
      category: String(reference.namespace || '').trim()
        || (id.includes('.') ? id.split('.')[0] : 'runtime'),
    }];
  }).sort((left, right) => (
    left.category.localeCompare(right.category) || left.label.localeCompare(right.label)
  ));
}

export function buildAgentBuilderOperation(args: {
  mode: AgentBuilderMode;
  target: AgentCardInstance | null;
  templateId: string;
  title: string;
  role: string;
  prompt: string;
  tools: string[];
  model: AgentBuilderModelOption | null;
  deckRevision: string | null;
  cbmProject?: string;
}): AgentBuilderOperation {
  const prompt = args.prompt.trim();
  if (!prompt) throw new Error('Agent prompt is required.');
  const tools = [...new Set(args.tools.map((tool) => tool.trim()).filter(Boolean))];
  const cbmProject = String(args.cbmProject || '').trim() || undefined;
  const expectedDeckRevision = String(args.deckRevision || '').trim();
  if (!expectedDeckRevision) throw new Error('Current deck revision is required.');
  if (args.mode === 'edit') {
    if (!args.target) throw new Error('Select one non-system Canvas Card to edit.');
    const targetCardRevisionId = String(args.target._cardRevisionId || '').trim();
    if (!targetCardRevisionId) throw new Error('Selected Card revision is unavailable.');
    return {
      mode: 'edit',
      expectedDeckRevision,
      targetCardId: args.target.id,
      targetCardRevisionId,
      prompt,
      tools,
      ...(cbmProject ? { cbmProject } : {}),
    };
  }
  const templateId = args.templateId.trim();
  const title = args.title.trim();
  const role = args.role.trim();
  if (!templateId || SYSTEM_TEMPLATE_IDS.has(templateId)) {
    throw new Error('Choose one buildable IDD template.');
  }
  if (!title) throw new Error('Agent title is required.');
  if (!role) throw new Error('Agent role is required.');
  if (!args.model) throw new Error('Choose one configured model.');
  return {
    mode: 'create',
    expectedDeckRevision,
    templateId,
    title,
    role,
    prompt,
    tools,
    model: {
      provider: args.model.provider,
      modelKey: args.model.modelKey,
      providerModelId: args.model.providerModelId,
      accessMode: args.model.accessMode,
    },
    ...(cbmProject ? { cbmProject } : {}),
  };
}

export function buildAgentBuilderProposal(
  operation: AgentBuilderOperation,
  target: AgentCardInstance | null,
): AgentBuilderProposal {
  if (operation.mode === 'edit') {
    if (!target || target.id !== operation.targetCardId) {
      throw new Error('Agent Builder edit target does not match the operation.');
    }
    const previousTools = Array.isArray(target.runtimeOptions?.tools)
      ? target.runtimeOptions.tools.filter((tool): tool is string => typeof tool === 'string')
      : [];
    return {
      mode: 'edit',
      expectedDeckRevision: operation.expectedDeckRevision,
      targetCardId: target.id,
      targetCardRevisionId: operation.targetCardRevisionId,
      changes: {
        prompt: { from: String(target.prompt || ''), to: operation.prompt },
        tools: { from: previousTools, to: operation.tools },
      },
    };
  }
  return {
    mode: 'create',
    expectedDeckRevision: operation.expectedDeckRevision,
    configuration: {
      templateId: String(operation.templateId || ''),
      title: String(operation.title || ''),
      role: String(operation.role || ''),
      prompt: operation.prompt,
      tools: operation.tools,
      model: operation.model,
    },
  };
}
