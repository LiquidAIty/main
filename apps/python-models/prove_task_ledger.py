import asyncio
import json
import logging
from app.python_models.orchestration_contracts import ContextPack, ProjectSession, CardRuntimeConfig, CardRuntimeParticipant, CardRuntimeGraph, GraphNodeInput, PlanContext, GraphEdgeInput
from app.python_models.autogen_orchestrator import orchestrate_context_pack

logging.basicConfig(level=logging.ERROR)

async def test_run():
    # We mock the model client internally or rely on a fast mock model if set.
    # For proof, we will run the orchestrator with a dummy graph.
    context = ContextPack(
        session=ProjectSession(sessionId='s1', projectId='test_project', turnId='t1', route='chat', modelProvider='openai', modelKey='k', providerModelId='gpt-5.1-chat', startedAt='2026'),
        cardRuntime=CardRuntimeConfig(
            cardId='test_card',
            title='Test Orchestrator',
            runtimeType='magentic_one',
            participants=[
                CardRuntimeParticipant(cardId='local_coder', title='Local Coder', runtimeType='assistant_agent', provider='openai', providerModelId='gpt-5.1-chat', tools=['coder_console_task']),
                CardRuntimeParticipant(cardId='plan_agent', title='Plan Agent', runtimeType='assistant_agent', provider='openai', providerModelId='gpt-5.1-chat', tools=[])
            ],
            graph=CardRuntimeGraph(
                nodes=[
                    GraphNodeInput(cardId='test_card', title='Orchestrator', role='orchestrator', provider='openai', providerModelId='gpt-5.1-chat'),
                    GraphNodeInput(cardId='local_coder', title='Local Coder', role='local_coder', tools=['coder_console_task'], provider='openai', providerModelId='gpt-5.1-chat'),
                    GraphNodeInput(cardId='plan_agent', title='Plan Agent', role='planner', tools=[], provider='openai', providerModelId='gpt-5.1-chat')
                ],
                edges=[
                    GraphEdgeInput(source='test_card', target='local_coder', edgeType='magentic_option'),
                    GraphEdgeInput(source='test_card', target='plan_agent', edgeType='magentic_option')
                ]
            )
        ),
        plan=PlanContext(),
        userText='Refactor the backend to use the repository pattern.',
        systemPrompt='You are a test system.'
    )
    
    # We will patch the model client in magentic_runtime to return mocked responses for the 3 steps.
    import app.python_models.magentic_runtime as magentic_runtime
    
    class MockClient:
        def __init__(self, *args, **kwargs):
            self.call_count = 0
            self.model_info = {"vision": False}
        async def create(self, messages, **kwargs):
            self.call_count += 1
            if self.call_count == 1:
                return type('Response', (), {'content': '1. GIVEN FACTS: Refactoring to repository pattern.'})()
            elif self.call_count == 2:
                return type('Response', (), {'content': '- Plan Agent will design the pattern.\n- Local Coder will write the code.'})()
            else:
                return type('Response', (), {'content': json.dumps({
                    "task_ledger": {
                        "user_goal": "Refactor the backend to use the repository pattern.",
                        "facts": ["Refactoring to repository pattern."],
                        "assumptions": [],
                        "plan": "Plan Agent will design the pattern. Local Coder will write the code.",
                        "current_spec": "no edits, no commit, no push.",
                        "required_agents_tools": ["Plan Agent", "Local Coder"],
                        "approval_state": "waiting_for_approval",
                        "target_root": "",
                        "cbm_context_summary": "",
                        "skillgraph_context_summary": ""
                    }
                })})()
                
    magentic_runtime._build_model_client = lambda config: MockClient()
    
    result = await orchestrate_context_pack(context)
    
    print('\n=== PROOF OF EXECUTION ===')
    print('1. Stop reason matches planning completion:', result.stopReason == 'startup_planning_complete')
    print('2. Task ledger found in JSON block:', result.taskLedgerTrace.taskLedgerFound)
    print('3. Task ledger parse status:', result.taskLedgerTrace.taskLedgerParseStatus)
    
    task_ledger = context.plan.task_ledger
    print('4. Backend preserved task_ledger?', task_ledger is not None)
    if task_ledger:
        print('   -> User goal:', task_ledger.user_goal)
        print('   -> Plan content mapped correctly?', 'Plan Agent will design' in task_ledger.plan)
        print('   -> Connected agents/tools included?', 'Local Coder' in task_ledger.required_agents_tools)
        print('   -> Current spec honors read-only?', 'no edits' in task_ledger.current_spec)
        print('   -> Approval state waiting?', task_ledger.approval_state == 'waiting_for_approval')
        
    print('\n=== TRANSCRIPT VERIFICATION ===')
    has_facts = any('(facts)' in line for line in result.transcript)
    has_plan = any('(plan)' in line for line in result.transcript)
    has_json = any('(json)' in line for line in result.transcript)
    has_orchestrate_step = any('orchestrate_step' in line for line in result.transcript)
    print('1. Transcript contains facts generation:', has_facts)
    print('2. Transcript contains plan generation:', has_plan)
    print('3. Transcript contains JSON projection:', has_json)
    print('4. Transcript proves NO execution/progress ledger happened:', not has_orchestrate_step)

asyncio.run(test_run())
