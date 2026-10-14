import type { DeckCard } from '../types';
import type { HermesProfileState } from './profileMaterialization';
import { objectRecord } from '../services/savedCardAuthority';

export type HermesProfileRequest = (
  method: string,
  params?: Record<string, unknown>,
) => Promise<unknown>;

function gatewayErrorCode(error: unknown): number | null {
  const value = error && typeof error === 'object'
    ? (error as { code?: unknown }).code
    : null;
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

export async function ensureSavedCardProfile(
  request: HermesProfileRequest,
  card: DeckCard,
  botModeRoster?: string[],
): Promise<HermesProfileState> {
  const describeParams: Record<string, unknown> = { name: card.runtime.profile };
  if (botModeRoster !== undefined) describeParams.bot_mode_roster = botModeRoster;
  const describe = async (): Promise<HermesProfileState> => {
    const profile = objectRecord(await request('profiles.describe', describeParams));
    if (String(profile.name || '').toLowerCase() !== card.runtime.profile.toLowerCase()) {
      throw new Error(`hermes_profile_readback_mismatch:${card.runtime.profile}`);
    }
    return profile as HermesProfileState;
  };
  try {
    return await describe();
  } catch (error) {
    if (gatewayErrorCode(error) !== 4064) throw error;
  }
  try {
    const created = objectRecord(await request('profiles.create', {
      name: card.runtime.profile,
      description: String(card.title || ''),
      soul: String(card.prompt || ''),
      mirror_credentials: false,
    }));
    if (
      created.ok !== true
      || String(created.name || '').toLowerCase() !== card.runtime.profile.toLowerCase()
    ) {
      throw new Error(`hermes_profile_creation_failed:${card.runtime.profile}`);
    }
  } catch (error) {
    if (gatewayErrorCode(error) !== 4062) throw error;
  }
  return describe();
}
