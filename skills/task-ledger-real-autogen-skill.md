# Skill: Real AutoGen Task Ledger To Canvas

@skill id=task-ledger-real-autogen
@type Skill
@status active
@related_to magentic-one-runtime
@related_to planflow-no-deterministic-projection
@related_to how-to-run-a-test
@related_to no-fake-surfaces

## Vector Summary

How the real AutoGen 0.7.5 Magentic-One Task Ledger is produced and rendered as one honest node on
the PlanFlow (Plan) canvas — read verbatim from the real orchestrator state, never parsed from prose,
never derived from finalResponseText/chat, and never allowed to suppress the chat answer. Proof is the
node appearing on the canvas in the UI, alongside the real chat answer.

## The Real Chain (source -> canvas)

1. Real team, real orchestrator handle — `apps/python-models/app/python_models/magentic_agentchat.py`
   `_CapturingMagenticOneGroupChat(MagenticOneGroupChat)` keeps a handle to the real
   `MagenticOneOrchestrator` instance. It does NOT change orchestration and does NOT recreate prompts.
2. Artifact read from genuine state — `_real_task_ledger_artifact(orchestrator)`:
   - `orchestrator._facts`  -> `factsResponse` (real facts model-call output)
   - `orchestrator._plan`   -> `planResponse` (real plan model-call output)
   - `orchestrator._team_description` -> `teamDescription`
   - `orchestrator._get_task_ledger_full_prompt(task, team, facts, plan)` -> `taskLedgerResponse`
   - Returns None if no facts/plan (no fabrication).
3. Transport contract — `apps/python-models/app/python_models/orchestration_contracts.py`
   `TaskLedgerArtifact{ source:"autogen_0_7_5_magentic_one", phase:"task_ledger", factsResponse,
   planResponse, taskLedgerResponse, teamDescription, modelCallProof }`. Returned on
   `OrchestratorRunResponse.taskLedgerArtifact`, SEPARATE from finalResponseText/autogenMessages.
4. Backend transport — `apps/backend/src/cards/runtime.ts` places it at
   `magenticTrace.plan.taskLedgerArtifact` on the run step (never authored/parsed by the backend).
5. Client render — `client/src/components/assist/planMissionModel.ts` `buildTaskLedgerArtifactGraph`
   reads the latest `latestDeckRun.steps[*].magenticTrace.plan.taskLedgerArtifact` (wired in
   `client/src/pages/agentbuilder.tsx` `planFlowMissionGraph`) and builds ONE node:
   `kind: TaskLedger`, label "Task Ledger Artifact", "Real Magentic-One Task Ledger artifact captured.",
   raw artifact preserved in `payloadJson`. No artifact -> empty graph.

## How To Verify It Works (UI proof)

1. All three services up (frontend 5173, backend 4000, Python rails 8003). Rails: `npm run dev:autogen`.
2. Send any real prompt in Agent Builder chat (a one-sentence joke is enough) and confirm the real
   answer renders in chat.
3. Open the Plan canvas. Confirm a single ReactFlow node reads
   "TASK LEDGER … Task Ledger Artifact … Real Magentic-One Task Ledger artifact captured."
4. PASS = that node is present AND the chat answer is still shown. The artifact and the answer coexist.

## Guardrails

@guardrail id=task-ledger-real-autogen.read-real-orchestrator-state
@guardrail id=task-ledger-real-autogen.separate-from-chat-answer
@guardrail id=task-ledger-real-autogen.no-prose-parsing
@guardrail id=task-ledger-real-autogen.none-not-fabrication
@guardrail id=task-ledger-real-autogen.ui-node-is-the-proof

* Build the artifact only from real orchestrator `_facts`/`_plan`/`_get_task_ledger_full_prompt`.
* The artifact is a separate surface; it must NEVER suppress or replace the real chat answer.
* Never parse markdown/prose/finalResponseText/autogenMessages/chat into task steps or node text.
* If the orchestrator produced no Task Ledger, return None / empty graph — do not invent a node.
* Proof is the real node on the canvas in the UI, not a compile and not a curl 200.

## Known Gap

@note id=task-ledger-real-autogen.modelcallproof-empty `_real_task_ledger_artifact` passes `modelCallProof=[]` — the facts/plan/full text is real but the per-call proof list (responseId/usage/excerpt) is not populated. Next narrow step if model-call proof is required.

## Query Patterns

@query id=task-ledger-real-autogen.trace "trace the real AutoGen Magentic-One Task Ledger from orchestrator _facts/_plan/_get_task_ledger_full_prompt through taskLedgerArtifact transport to the single TaskLedger node on the PlanFlow canvas; artifact must not suppress the chat answer"
