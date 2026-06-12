# Skill: CoderReport Protocol

@skill id=coder-report-protocol
@type Skill
@status active
@related_to spec-as-prompt
@requires fresh_cbm_index

## Vector Summary

Return a structured CoderReport that PlanFlow can compare against the active CoderPacket; never
return vague done or hidden success.

## Required Shape

* verdict
* comparison against CoderPacket
* completed requirements
* incomplete requirements
* changed requirements
* files changed
* proof commands
* proof results
* blockers
* assumptions
* chosen approach
* rejected alternatives
* reusable skill updates
* next recommended task

## Guardrails

@guardrail id=coder-report-protocol.no-vague-done
@guardrail id=coder-report-protocol.compare-every-requirement
@guardrail id=coder-report-protocol.no-hidden-success

## Query Patterns

@query id=coder-report-protocol.compare "compare the actual files and proof results against every active CoderPacket requirement before returning verdict"
