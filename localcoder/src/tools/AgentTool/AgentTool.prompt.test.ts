import assert from 'node:assert/strict'
import test from 'node:test'

import { inputSchema, resolveAgentPrompt } from './AgentTool.js'

test('Agent input permits a promptless named inherit-parent invocation', () => {
  const parsed = inputSchema().parse({
    description: 'Review live context',
    subagent_type: 'card_hermes_steward',
  })

  assert.equal(parsed.prompt, undefined)
  assert.equal(resolveAgentPrompt(parsed.prompt, true), '')
})

test('Agent still fails closed when a normal agent omits its prompt', () => {
  assert.throws(
    () => resolveAgentPrompt(undefined, false),
    /prompt is required unless.*inherit_parent/,
  )
})

test('Agent preserves supplied prompt bytes for every agent mode', () => {
  const prompt = 'line one\r\nline two  \n'
  assert.equal(resolveAgentPrompt(prompt, false), prompt)
  assert.equal(resolveAgentPrompt(prompt, true), prompt)
})
