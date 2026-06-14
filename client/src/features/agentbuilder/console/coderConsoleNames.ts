/**
 * User-facing naming firewall for the coder console.
 *
 * Product UI chrome must never show `Claude`, `OpenClaude`, or `LocalCoder`.
 * Internal ids, file names, routes, and the vendored runtime keep their names
 * for now (a broad internal rename is a later SPEC). This module is the single
 * source of the clean display names plus an optional redaction helper for raw
 * terminal output shown to non-developer users.
 */

export const CODER_DISPLAY_NAMES = {
  /** Canvas card / agent role. */
  card: 'Coder',
  /** Left rail item + terminal panel title + feature name. */
  console: 'Code Console',
  /** Runtime/engine label. */
  runtime: 'Coder Engine',
  /** Task/session label. */
  session: 'Coder Session',
} as const;

const INTERNAL_ID_TO_DISPLAY: Record<string, string> = {
  localcoder: CODER_DISPLAY_NAMES.card,
  local_coder: CODER_DISPLAY_NAMES.card,
  openclaude: CODER_DISPLAY_NAMES.card,
  openclaudeconsole: CODER_DISPLAY_NAMES.console,
  openclaude_console: CODER_DISPLAY_NAMES.console,
};

/** Map an internal id to a clean user-facing display name (falls back to id). */
export function coderDisplayName(internalId: string): string {
  return INTERNAL_ID_TO_DISPLAY[String(internalId).trim().toLowerCase()] ?? internalId;
}

// Order matters: multi-word brands first so "Claude Code" / "OpenClaude" are
// handled before the bare "Claude" rule.
const BRANDING_RULES: Array<[RegExp, string]> = [
  [/Claude Code/gi, CODER_DISPLAY_NAMES.runtime],
  [/OpenClaude/gi, CODER_DISPLAY_NAMES.runtime],
  [/LocalCoder/gi, CODER_DISPLAY_NAMES.runtime],
  [/Local Coder/gi, CODER_DISPLAY_NAMES.card],
  [/\bClaude\b/gi, CODER_DISPLAY_NAMES.card],
];

/**
 * Replace known underlying-CLI branding terms with clean product names. This is
 * a DISPLAY-only transform for raw terminal output shown to non-developer
 * users; it must not be used to mutate stored transcripts or proof logs.
 */
export function redactCoderBranding(text: string): string {
  let out = String(text);
  for (const [pattern, replacement] of BRANDING_RULES) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/** True if the string contains any forbidden public-UI branding term. */
export function containsCoderBranding(text: string): boolean {
  return /(OpenClaude|LocalCoder|Local Coder|Claude)/i.test(String(text));
}
