/**
 * Optional display-only redaction for terminal transcripts.
 *
 * Product chrome now names the real OpenClaude and Hermes terminal owners
 * directly. This helper remains only for explicitly redacted transcript views.
 */

export const CODER_DISPLAY_NAMES = {
  /** Canvas card / agent role. */
  card: 'Coder',
  /** Runtime/engine label. "Harness" was briefly used here but collides with
   * the chat front door's product name — the coder runtime is "Coder Engine". */
  runtime: 'Coder Engine',
  /** Task/session label. */
  session: 'Coder Session',
} as const;

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
