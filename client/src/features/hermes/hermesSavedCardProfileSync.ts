/**
 * Entity: Card Profiles
 * Relationship: Projects every enabled saved Hermes Card into its stable profile from saved Card authority before Bot roster publication.
 */

import type { AgentCardInstance, DeckDocument } from '../../types/agentgraph';
import { applicationFetch } from '../../lib/applicationApi';
import {
  configureHermesProfile,
  createHermesProfile,
  createHermesSkill,
  loadHermesProfile,
  loadHermesSkill,
} from './hermesProfileClient';
import { buildBasicHermesCardSkill } from './hermesCardSkill';

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim()).filter(Boolean))]
    : [];
}

function profileProvider(
  provider: string | null | undefined,
  accessMode: string | null | undefined,
): string {
  if (provider === 'openai' && accessMode === 'chatgpt-account') return 'openai-codex';
  if (provider === 'openrouter') return 'openrouter';
  if (provider === 'openai') return 'openai';
  return String(provider || '').trim();
}

function orchestratorSkill(prompt: string): string {
  const match = String(prompt || '').match(
    /^(?:\[ORCHESTRATOR SKILL\]|#{1,6}\s+ORCHESTRATOR SKILL)\s*\r?\n([\s\S]*?)(?=^\s*(?:\[[^\]\r\n]+\]|#{1,6}\s+[^\r\n]+)\s*$|\z)/im,
  );
  return String(match?.[1] || '').trim();
}

function profileDescription(card: AgentCardInstance): string {
  const profile = card.runtime.profile;
  const category = card.runtime.mode === 'main'
    ? 'Category: system. User-facing Project orchestrator.'
    : card.runtime.mode === 'magentic_one'
      ? 'Category: team. Fixed saved blue-wire specialist roster.'
      : profile === 'team'
        ? 'Category: fallback-team. Automatic decomposition when no specialist matches.'
        : profile === 'builder'
          ? 'Category: builder. Prompts, saved Cards, UI, and supporting code.'
          : profile === 'thinkgraph'
            ? 'Category: memory. Engraphis reasoning and operational knowledge.'
            : profile === 'knowgraph'
              ? 'Category: research. Firecrawl evidence and Graphiti sourced knowledge.'
              : `Category: specialist. ${String(card.title || profile).trim()}.`;
  const guidance = orchestratorSkill(String(card.prompt || ''));
  return guidance ? `${category}\n${guidance}` : category;
}

async function ensureCardSkill(card: AgentCardInstance): Promise<void> {
  const profile = card.runtime.profile.trim().toLowerCase();
  try {
    await loadHermesSkill(profile, profile);
  } catch {
    await createHermesSkill(profile, profile, buildBasicHermesCardSkill({
      profile,
      title: card.title,
      mode: card.runtime.mode,
    }));
  }
}

async function cardScriptRuntime(
  projectId: string,
  deckId: string,
  card: AgentCardInstance,
): Promise<Record<string, unknown> | null> {
  if (!card.runtimeOptions?.script?.enabled) return null;
  const params = new URLSearchParams({ projectId, deckId, cardId: card.id });
  const response = await applicationFetch(`/api/idd/card-script-runtime?${params}`, {
    credentials: 'include',
  });
  const payload = await response.json().catch(() => null) as {
    ok?: boolean;
    error?: string;
    script?: unknown;
  } | null;
  if (!response.ok || payload?.ok !== true) {
    throw new Error(payload?.error || `Card Script unavailable for ${card.title}.`);
  }
  if (payload.script === null || payload.script === undefined) return null;
  if (!payload.script || typeof payload.script !== 'object' || Array.isArray(payload.script)) {
    throw new Error(`Card Script invalid for ${card.title}.`);
  }
  return payload.script as Record<string, unknown>;
}

export async function synchronizeHermesSavedCardProfiles(
  deck: DeckDocument,
  projectId: string,
): Promise<string[]> {
  const profiles: string[] = [];
  for (const card of deck.nodes) {
    if (card.enabled === false || card.runtime.kind !== 'hermes') continue;
    const profile = card.runtime.profile.trim().toLowerCase();
    const options = card.runtimeOptions || {};
    const model = String(options.providerModelId || options.modelKey || '').trim();
    const provider = profileProvider(options.provider, options.accessMode);
    if (!profile || !model || !provider) {
      throw new Error(`Saved Hermes profile configuration is incomplete for ${card.title}.`);
    }
    const description = profileDescription(card);
    await loadHermesProfile(profile).catch(() => createHermesProfile({
      profile,
      description,
      soul: String(card.prompt || ''),
      model,
      provider,
    }));
    await ensureCardSkill(card);
    const librarySkills = strings(options.skills).filter((name) => name !== profile);
    const effectiveSkills = [profile, ...librarySkills];
    const applicationTools = strings(options.tools);
    const script = await cardScriptRuntime(projectId, deck.id, card);
    const taskMode = card.runtime.mode === 'magentic_one'
      ? 'magnetic' as const
      : profile === 'team'
        ? 'team' as const
        : '' as const;
    const toolsets = new Set(strings(options.toolsets));
    if (script || taskMode) toolsets.add('liquidaity');
    const mcpServers = new Set(strings(options.mcpConnectionIds));
    if (applicationTools.length || script) mcpServers.add('liquidaity');
    const savedSubagent = options.subagentModel;
    await configureHermesProfile({
      profile,
      soul: String(card.prompt || ''),
      description,
      model,
      provider,
      enabledSkills: effectiveSkills,
      autoLoadSkills: effectiveSkills,
      enabledToolsets: [...toolsets],
      enabledMcpServers: [...mcpServers],
      applicationTools,
      cardScript: script,
      taskMode,
      subagentModel: savedSubagent ? {
        provider: profileProvider(savedSubagent.provider, savedSubagent.accessMode),
        model: savedSubagent.providerModelId || savedSubagent.modelKey,
        reasoningEffort: '',
      } : null,
    });
    profiles.push(profile);
  }
  return profiles;
}
