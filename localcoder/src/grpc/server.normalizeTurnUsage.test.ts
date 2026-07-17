import { describe, expect, it } from 'bun:test'

import { normalizeTurnUsage } from './server.js'

// M-2: streamed provider usage must be HONEST — real numbers when present,
// null/unavailable when absent, and NEVER a fabricated zero. The engine
// zero-initializes its stream-accumulated usage, so all-zero is
// indistinguishable from "never populated".
describe('normalizeTurnUsage — honest provider usage, never fake zero', () => {
  it('reports real result_usage when tokens are present', () => {
    const u = normalizeTurnUsage({ input_tokens: 1200, output_tokens: 340 }, null, 0.0042)
    expect(u.usageAvailable).toBe(true)
    expect(u.usageSource).toBe('result_usage')
    expect(u.inputTokens).toBe(1200)
    expect(u.outputTokens).toBe(340)
    expect(u.totalCostUsd).toBe(0.0042)
  })

  it('treats all-zero result usage as UNAVAILABLE, not a real zero', () => {
    const u = normalizeTurnUsage({ input_tokens: 0, output_tokens: 0 }, null, 0)
    expect(u.usageAvailable).toBe(false)
    expect(u.usageSource).toBe('unavailable')
    expect(u.inputTokens).toBeNull()
    expect(u.outputTokens).toBeNull()
    expect(u.totalCostUsd).toBeNull()
  })

  it('falls back to the per-model usage store when result usage is empty', () => {
    const u = normalizeTurnUsage(
      { input_tokens: 0, output_tokens: 0 },
      { 'openai/gpt-5.1-chat': { inputTokens: 800, outputTokens: 120 } },
      0,
    )
    expect(u.usageAvailable).toBe(true)
    expect(u.usageSource).toBe('model_usage')
    expect(u.inputTokens).toBe(800)
    expect(u.outputTokens).toBe(120)
  })

  it('sums multiple model-usage entries', () => {
    const u = normalizeTurnUsage(null, {
      a: { inputTokens: 100, outputTokens: 10 },
      b: { inputTokens: 50, outputTokens: 5 },
    })
    expect(u.inputTokens).toBe(150)
    expect(u.outputTokens).toBe(15)
    expect(u.usageSource).toBe('model_usage')
  })

  it('reports unavailable with null tokens when neither source carries numbers', () => {
    const u = normalizeTurnUsage(null, null)
    expect(u.usageAvailable).toBe(false)
    expect(u.inputTokens).toBeNull()
    expect(u.outputTokens).toBeNull()
    expect(u.usageSource).toBe('unavailable')
  })

  it('surfaces a positive cost even when token counts are unavailable', () => {
    // A provider may bill without returning token counts on the streamed path.
    const u = normalizeTurnUsage(null, null, 0.0011)
    expect(u.usageAvailable).toBe(false)
    expect(u.inputTokens).toBeNull()
    expect(u.totalCostUsd).toBe(0.0011)
  })

  it('never treats a zero cost as a real cost', () => {
    const u = normalizeTurnUsage({ input_tokens: 10, output_tokens: 2 }, null, 0)
    expect(u.totalCostUsd).toBeNull()
  })
})
