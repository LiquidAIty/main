import { afterEach, describe, expect, test } from 'bun:test'
import model from './index.js'

const originalManagedByHost = process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST
const originalLockedProvider = process.env.OPENCLAUDE_LOCKED_PROVIDER

afterEach(() => {
  if (originalManagedByHost === undefined) {
    delete process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST
  } else {
    process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST = originalManagedByHost
  }

  if (originalLockedProvider === undefined) {
    delete process.env.OPENCLAUDE_LOCKED_PROVIDER
  } else {
    process.env.OPENCLAUDE_LOCKED_PROVIDER = originalLockedProvider
  }
})

describe('/model command availability', () => {
  test('is disabled when host-managed mode is enabled', () => {
    process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST = '1'
    expect(model.isEnabled?.()).toBe(false)
  })
})
