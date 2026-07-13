import assert from 'node:assert/strict'
import test from 'node:test'

import {
  agentTextDeltaProgress,
  inputSchema,
  resolveAgentPrompt,
} from './AgentTool.js'
import { normalizeMessage } from '../../utils/queryHelpers.js'

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

test('Agent exposes child prose text deltas in order through opaque progress data', () => {
  const events = ['First ', 'second ', 'third.'].map(text => ({
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      delta: { type: 'text_delta', text },
    },
  }))

  const progress = events.map(event =>
    agentTextDeltaProgress(event as any, 'agent-42', 'card_hermes_steward'),
  )

  assert.equal(progress.map(item => item?.text).join(''), 'First second third.')
  assert.deepEqual(progress[0], {
    type: 'agent_text_delta',
    agentId: 'agent-42',
    agentType: 'card_hermes_steward',
    text: 'First ',
  })
})

test('the QueryEngine normalization boundary preserves only Agent text delta progress', () => {
  const progress = {
    type: 'progress',
    toolUseID: 'child-delta',
    parentToolUseID: 'hermes-agent-call',
    uuid: 'progress-1',
    data: {
      type: 'agent_text_delta',
      agentId: 'agent-42',
      agentType: 'card_hermes_steward',
      text: 'live prose',
    },
  }

  assert.deepEqual([...normalizeMessage(progress as any)], [progress])
})

test('Agent text progress ignores tool and non-text protocol events', () => {
  const toolUse = {
    type: 'stream_event',
    event: {
      type: 'content_block_start',
      content_block: { type: 'tool_use', name: 'read_graph' },
    },
  }
  const toolDelta = {
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      delta: { type: 'input_json_delta', partial_json: '{' },
    },
  }

  assert.equal(agentTextDeltaProgress(toolUse as any, 'agent-42', 'card_hermes_steward'), null)
  assert.equal(agentTextDeltaProgress(toolDelta as any, 'agent-42', 'card_hermes_steward'), null)
})
