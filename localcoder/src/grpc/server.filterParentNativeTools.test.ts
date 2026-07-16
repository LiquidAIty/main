import { describe, expect, it } from 'bun:test'

import { filterParentNativeTools, normalizeTurnUsage } from './server.js'

const pool = [
  { name: 'Agent' },
  { name: 'Bash' },
  { name: 'Read' },
  { name: 'Edit' },
  { name: 'Write' },
  { name: 'WebSearch' },
]

describe('filterParentNativeTools', () => {
  it('empty grant keeps the full pool (legacy callers with no card native list)', () => {
    expect(filterParentNativeTools(pool, [], true).map(t => t.name)).toEqual(pool.map(t => t.name))
  })

  it('a granted list narrows the parent schemas to exactly the grant', () => {
    expect(filterParentNativeTools(pool, ['Agent'], false).map(t => t.name)).toEqual(['Agent'])
    // Coder-class schemas never ride along merely because they are installed.
    expect(filterParentNativeTools(pool, ['WebSearch'], false).map(t => t.name)).toEqual(['WebSearch'])
  })

  it('agent definitions on the turn canvas-grant the Agent doorway tool', () => {
    expect(filterParentNativeTools(pool, ['WebSearch'], true).map(t => t.name)).toEqual(['Agent', 'WebSearch'])
  })

  it('grant names missing from the installed pool are dropped loudly, not silently honored', () => {
    expect(filterParentNativeTools(pool, ['NotInstalled'], false)).toEqual([])
  })
})

describe('normalizeTurnUsage', () => {
  it('provider-reported result usage wins and carries positive cost', () => {
    expect(normalizeTurnUsage({ input_tokens: 1200, output_tokens: 88 }, {}, 0.0123)).toEqual({
      inputTokens: 1200, outputTokens: 88, totalCostUsd: 0.0123, usageAvailable: true, usageSource: 'result_usage',
    })
  })

  it('zero-initialized result usage falls back to the per-model usage store', () => {
    expect(normalizeTurnUsage(
      { input_tokens: 0, output_tokens: 0 },
      { 'openrouter/some-model': { inputTokens: 950, outputTokens: 41 } },
      0,
    )).toEqual({ inputTokens: 950, outputTokens: 41, totalCostUsd: null, usageAvailable: true, usageSource: 'model_usage' })
  })

  it('missing usage everywhere is UNAVAILABLE with null tokens, never a fake zero', () => {
    expect(normalizeTurnUsage(undefined, {}, undefined)).toEqual({
      inputTokens: null, outputTokens: null, totalCostUsd: null, usageAvailable: false, usageSource: 'unavailable',
    })
    expect(normalizeTurnUsage({ input_tokens: 0, output_tokens: 0 }, {}, 0)).toEqual({
      inputTokens: null, outputTokens: null, totalCostUsd: null, usageAvailable: false, usageSource: 'unavailable',
    })
  })

  it('malformed usage values are ignored honestly', () => {
    expect(normalizeTurnUsage(
      { input_tokens: 'NaNish' as unknown as number, output_tokens: Number.NaN },
      { model: { inputTokens: 'bad' as unknown as number, outputTokens: undefined } },
      'free' as unknown as number,
    ).usageAvailable).toBe(false)
  })

  it('a genuinely reported one-sided usage stays available (output-only completions)', () => {
    expect(normalizeTurnUsage({ input_tokens: 0, output_tokens: 17 }, {}, 0)).toEqual({
      inputTokens: 0, outputTokens: 17, totalCostUsd: null, usageAvailable: true, usageSource: 'result_usage',
    })
  })
})
