import { buildPythonAutoGenCardRuntimePayload } from '../apps/backend/src/v3/cards/runtime';

const mockCard = { id: 'test_card', title: 'Test Magentic Card', kind: 'agent', runtimeType: 'magentic_one' };
const mockAgent = { id: 'test_agent', name: 'Test Agent', promptTemplate: 'System Prompt' };
const mockContext = {
  missionSpec: {
    runState: 'approved',
    task_ledger: { task_plan: 'Do steps 1 and 2.' },
    progress_ledger: { next_instruction: 'Step 1' }
  }
};
const mockModelConfig = { provider: 'openai', modelKey: 'gpt-4o', providerModelId: 'gpt-4o' };

const payload = buildPythonAutoGenCardRuntimePayload(
  mockCard as any,
  mockAgent as any,
  "Test Input",
  mockContext as any,
  mockModelConfig as any,
  "System Prompt",
  [],
  new Date().toISOString(),
  null
);

if (!payload.plan.task_ledger && !payload.plan.progress_ledger) {
  console.error("BLOCKER: task_ledger and progress_ledger are missing from payload.plan!");
  process.exit(1);
}

console.log("SUCCESS: Payload contains approved context.");
