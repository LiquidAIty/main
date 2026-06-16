from app.python_models.orchestration_contracts import TaskLedger, ProgressLedger

def test_task_ledger_contract():
    ledger = TaskLedger(user_goal="Test", plan_steps=[], connected_agents=[])
    assert ledger.user_goal == "Test"

def test_progress_ledger_contract():
    ledger = ProgressLedger(current_step="1", progress_state="running")
    assert ledger.progress_state == "running"
