export type ChainCondition =
  | 'always'
  | 'after_chat_pair'
  | 'research_pack_ready'
  | 'plan_approved'
  | 'evidence_received'
  | 'swarm_complete'
  | 'dual_graph_answer_ready';

export type ChainRunMode = 'sequential' | 'parallel' | 'merge' | 'approval_gate';

export type ChainRuntimeRole =
  | 'chat_router'
  | 'thinkgraph'
  | 'planflow'
  | 'research'
  | 'knowgraph'
  | 'answer'
  | 'code'
  | 'worldsignals';

export interface ChainStep {
  id: string;
  order: number;
  label: string;
  cardId: string;
  role: ChainRuntimeRole;
  condition: ChainCondition;
  runMode: ChainRunMode;
  requiresApproval: boolean;
  promptPart: string;
  inputFrom: string;
  outputKey: string;
  parallelGroup?: string;
}

export interface PromptChain {
  id: string;
  name: string;
  mode: 'locked' | 'discovery_proposal';
  steps: ChainStep[];
}

export interface ChainRunState {
  currentStepId: string | null;
  completedStepIds: string[];
  failedStepIds: string[];
  approved: boolean;
  researchPackReady: boolean;
  planApproved: boolean;
  evidenceCount: number;
  swarmCount: number;
  outputsByStepId: Record<string, any>;
  lastChatPairId?: string;
}

export interface ChainStepResult {
  stepId: string;
  status: 'skipped' | 'blocked' | 'running' | 'completed' | 'failed';
  outputKey: string;
  output: any;
  error?: string;
}

export function sortChainSteps(steps: ChainStep[]): ChainStep[] {
  return [...steps].sort((a, b) => a.order - b.order);
}

export function evaluateChainCondition(condition: ChainCondition, state: ChainRunState): boolean {
  switch (condition) {
    case 'always':
      return true;
    case 'after_chat_pair':
      return !!state.lastChatPairId;
    case 'research_pack_ready':
      return state.researchPackReady === true;
    case 'plan_approved':
      return state.planApproved === true;
    case 'evidence_received':
      return state.evidenceCount > 0;
    case 'swarm_complete':
      return false; // Can be false for now unless clear state exists
    case 'dual_graph_answer_ready':
      return false; // Can be false for now unless clear state exists
    default:
      throw new Error(`Unknown condition: ${condition}`);
  }
}

export function canRunChainStep(step: ChainStep, state: ChainRunState): boolean {
  // If the step itself requires approval or is an approval_gate, and we are not approved, block it.
  if ((step.requiresApproval || step.runMode === 'approval_gate') && !state.approved) {
    return false;
  }

  // If we already completed or failed this step, it shouldn't run again in a simple forward pass
  if (state.completedStepIds.includes(step.id) || state.failedStepIds.includes(step.id)) {
    return false;
  }

  try {
    return evaluateChainCondition(step.condition, state);
  } catch (error) {
    return false;
  }
}

export function resolveRunnableSteps(chain: PromptChain, state: ChainRunState): ChainStep[] {
  const sorted = sortChainSteps(chain.steps);
  return sorted.filter((step) => canRunChainStep(step, state));
}
