import assert from 'node:assert/strict'
import test from 'node:test'

import type { AssistantMessage } from '../../types/message.js'
import {
  buildForkedMessages,
  buildNamedInheritedPromptMessages,
  computeShouldRunAsync,
  forkForcesAsync,
} from './forkSubagent.js'
import { FORK_BOILERPLATE_TAG } from '../../constants/xml.js'

const FORK_STARTED = 'Fork started — processing in background'

/** A parent assistant message whose only pending tool_use is the Agent call
 * that spawned this child (mirrors the real spawn shape). */
function parentAssistantWithAgentCall(): AssistantMessage {
  return {
    type: 'assistant',
    uuid: 'parent-uuid',
    timestamp: '2026-07-11T00:00:00.000Z',
    message: {
      id: 'msg_parent',
      role: 'assistant',
      content: [
        { type: 'text', text: 'Delegating to Hermes.' },
        { type: 'tool_use', id: 'toolu_agent_1', name: 'Agent', input: { subagent_type: 'card_hermes_steward' } },
      ],
    },
  } as unknown as AssistantMessage
}

function textOf(messages: ReturnType<typeof buildForkedMessages>): string {
  return JSON.stringify(messages)
}

// ── Generic fork behavior is UNCHANGED ──────────────────────────────────────

test('generic fork still injects the fork-worker boilerplate and the "Fork started" placeholder', () => {
  const messages = buildForkedMessages('audit the auth module', parentAssistantWithAgentCall())
  const serialized = textOf(messages)
  assert.match(serialized, new RegExp(`<${FORK_BOILERPLATE_TAG}>`))
  assert.match(serialized, /You are a forked worker process/)
  assert.match(serialized, /Do NOT converse/)
  assert.match(serialized, /commit your changes/)
  assert.ok(serialized.includes(FORK_STARTED), 'fork resolves pending tool_use with the placeholder result')
  // Structure: [clonedAssistant, user(tool_results + directive)]
  assert.equal(messages.length, 2)
  assert.equal(messages[0].type, 'assistant')
  assert.equal(messages[1].type, 'user')
})

// ── Named inherit_parent NEVER receives fork contamination ───────────────────

test('named inherited agent never receives fork boilerplate, placeholder, or a cloned assistant tool_use', () => {
  const messages = buildNamedInheritedPromptMessages('Prepare a bounded context summary for job X.')
  const serialized = JSON.stringify(messages)
  assert.doesNotMatch(serialized, new RegExp(`<${FORK_BOILERPLATE_TAG}>`))
  assert.doesNotMatch(serialized, /forked worker process/)
  assert.doesNotMatch(serialized, /Do NOT converse/)
  assert.doesNotMatch(serialized, /commit your changes/)
  assert.ok(!serialized.includes(FORK_STARTED), 'no synthetic background lifecycle string')
  // No cloned parent assistant message / tool_result placeholder — parent
  // context arrives separately via forkContextMessages (already filtered).
  assert.ok(messages.every(m => m.type === 'user'), 'only ordinary user directive messages, never a cloned assistant')
})

test('omitted prompt yields NO child directive message (pure inheritance)', () => {
  assert.deepEqual(buildNamedInheritedPromptMessages(undefined), [])
})

test('explicit prompt yields exactly one ordinary user message carrying that prompt', () => {
  const messages = buildNamedInheritedPromptMessages('do exactly this')
  assert.equal(messages.length, 1)
  assert.equal(messages[0].type, 'user')
  assert.equal(messages[0].message.content, 'do exactly this')
})

test('explicitly-empty prompt is distinct from omitted — one message (createUserMessage guards empty content)', () => {
  const messages = buildNamedInheritedPromptMessages('')
  // The distinction that matters: explicit '' produces ONE message; omitted
  // produces ZERO. createUserMessage itself substitutes its empty-content guard
  // ('(no content)') so the wire is never a literally empty user turn.
  assert.equal(messages.length, 1, 'explicit empty string is NOT the same as omitted')
  assert.equal(messages[0].type, 'user')
  assert.equal(messages[0].message.content, '(no content)')
})

// ── Fork experiment must not force NAMED agents async ────────────────────────

test('fork experiment forces the genuine fork path async', () => {
  assert.equal(forkForcesAsync(true, true), true)
})

test('fork experiment does NOT force a named inherited agent async', () => {
  assert.equal(forkForcesAsync(false, true), false, 'a build-time fork flag must not detach named Hermes')
})

test('fork-forced async is off when the experiment is disabled, for both paths', () => {
  assert.equal(forkForcesAsync(true, false), false)
  assert.equal(forkForcesAsync(false, false), false)
})

// ── Explicit run_in_background / saved background:true remain intact ──────────

const asyncBase = {
  runInBackground: false,
  agentBackground: false,
  isCoordinator: false,
  forceAsync: false,
  assistantForceAsync: false,
  proactiveActive: false,
  backgroundTasksDisabled: false,
}

test('explicit run_in_background still runs async', () => {
  assert.equal(computeShouldRunAsync({ ...asyncBase, runInBackground: true }), true)
})

test('a saved background:true card still runs async', () => {
  assert.equal(computeShouldRunAsync({ ...asyncBase, agentBackground: true }), true)
})

test('a foreground named agent (no async source) stays foreground even with the fork experiment on', () => {
  // forceAsync already gated by forkForcesAsync(false, true) === false above.
  assert.equal(computeShouldRunAsync({ ...asyncBase, forceAsync: false }), false)
})

test('the hard disable wins over every async source', () => {
  assert.equal(
    computeShouldRunAsync({
      ...asyncBase,
      runInBackground: true,
      agentBackground: true,
      forceAsync: true,
      backgroundTasksDisabled: true,
    }),
    false,
  )
})
