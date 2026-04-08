import { normalizeV3Blackboard, normalizeV3BlackboardFieldList } from '../v3/blackboard';

import type {
  PlanWikiAllowedTool,
  PlanWikiCompileInput,
  PlanWikiCompileResult,
  PlanWikiDocument,
  PlanWikiMachineSection,
  PlanWikiTaskPacket,
} from './types';

const DEFAULT_ALLOWED_TOOLS: PlanWikiAllowedTool[] = [
  'repo_graph',
  'blackboard',
  'thinkgraph',
  'knowgraph',
];

function uniqueStrings(value: unknown): string[] {
  const source = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const output: string[] = [];

  source.forEach((entry) => {
    const text = String(entry || '').trim();
    if (!text || seen.has(text)) return;
    seen.add(text);
    output.push(text);
  });

  return output;
}

function buildPlanExcerpt(document: PlanWikiDocument): string {
  const lines = [
    document.human.intent,
    document.human.why,
    ...document.human.steps.map((step, index) => `${index + 1}. ${step}`),
    ...document.human.risks.map((risk) => `Risk: ${risk}`),
    ...document.human.notes.map((note) => `Note: ${note}`),
  ]
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);

  return lines.join('\n');
}

function normalizeAllowedTools(value: unknown): PlanWikiAllowedTool[] {
  const allowed = new Set<PlanWikiAllowedTool>([
    'repo_graph',
    'claude',
    'openclaw',
    'blackboard',
    'thinkgraph',
    'knowgraph',
  ]);

  const parsed = uniqueStrings(value).filter((entry): entry is PlanWikiAllowedTool =>
    allowed.has(entry as PlanWikiAllowedTool),
  );

  return parsed.length > 0 ? parsed : [...DEFAULT_ALLOWED_TOOLS];
}

function normalizeMachineSection(
  machine: PlanWikiMachineSection,
  compileInput: PlanWikiCompileInput,
): PlanWikiMachineSection {
  const mergeStrategy = machine.mergeStrategy || 'manual_review';
  const swarmEnabled = Boolean(machine.swarm?.enabled);
  const workerCount = swarmEnabled ? Math.max(2, Number(machine.swarm?.workerCount) || 3) : 0;

  return {
    currentObjective: String(machine.currentObjective || '').trim(),
    repoPath: String(machine.repoPath || compileInput.repoPath || '').trim(),
    repoScope: uniqueStrings(machine.repoScope),
    selectedFiles: uniqueStrings(machine.selectedFiles),
    constraints: uniqueStrings(machine.constraints),
    allowedTools: normalizeAllowedTools(machine.allowedTools),
    outputFormat: machine.outputFormat || 'text',
    outputSchema: machine.outputSchema || null,
    blackboardReads: normalizeV3BlackboardFieldList(machine.blackboardReads),
    blackboardWrites: normalizeV3BlackboardFieldList(machine.blackboardWrites),
    repoGraphQueries: uniqueStrings(machine.repoGraphQueries),
    thinkGraphQueries: uniqueStrings(machine.thinkGraphQueries),
    knowGraphQueries: uniqueStrings(machine.knowGraphQueries),
    mergeStrategy,
    swarm: {
      enabled: swarmEnabled,
      workerCount,
      mode: machine.swarm?.mode || null,
    },
  };
}

export function createEmptyPlanWikiDocument(repoPath = ''): PlanWikiDocument {
  return {
    projectId: null,
    human: {
      intent: '',
      why: '',
      steps: [],
      risks: [],
      notes: [],
    },
    machine: {
      currentObjective: '',
      repoPath,
      repoScope: [],
      selectedFiles: [],
      constraints: [],
      allowedTools: [...DEFAULT_ALLOWED_TOOLS],
      outputFormat: 'text',
      outputSchema: null,
      blackboardReads: [],
      blackboardWrites: [],
      repoGraphQueries: [],
      thinkGraphQueries: [],
      knowGraphQueries: [],
      mergeStrategy: 'manual_review',
      swarm: {
        enabled: false,
        workerCount: 0,
        mode: null,
      },
    },
  };
}

function buildDownstreamPrompt(packet: PlanWikiTaskPacket): string {
  const lines = [
    `Objective: ${packet.objective}`,
    `Repo path: ${packet.repoPath}`,
    packet.repoScope.length ? `Repo scope: ${packet.repoScope.join(', ')}` : '',
    packet.selectedFiles.length ? `Selected files: ${packet.selectedFiles.join(', ')}` : '',
    packet.constraints.length ? `Constraints: ${packet.constraints.join(' | ')}` : '',
    packet.graphContext.repoGraphQueries.length
      ? `Repo graph queries: ${packet.graphContext.repoGraphQueries.join(' | ')}`
      : '',
    packet.graphContext.thinkGraphQueries.length
      ? `ThinkGraph queries: ${packet.graphContext.thinkGraphQueries.join(' | ')}`
      : '',
    packet.graphContext.knowGraphQueries.length
      ? `KnowGraph queries: ${packet.graphContext.knowGraphQueries.join(' | ')}`
      : '',
    `Allowed tools: ${packet.allowedTools.join(', ')}`,
    `Output format: ${packet.outputFormat}`,
    `Merge strategy: ${packet.review.mergeStrategy}`,
    packet.swarm.enabled ? `Swarm: enabled (${packet.swarm.workerCount} workers)` : 'Swarm: disabled',
  ].filter(Boolean);

  return lines.join('\n');
}

export function compilePlanWikiTaskPacket(
  document: PlanWikiDocument,
  compileInput: PlanWikiCompileInput = {},
): PlanWikiCompileResult {
  const normalizedMachine = normalizeMachineSection(document.machine, compileInput);
  const blackboard = normalizeV3Blackboard(compileInput.blackboard || null);
  const objective =
    normalizedMachine.currentObjective || String(document.human.intent || '').trim() || 'Complete the next scoped repo task.';

  const mergeStrategy = normalizedMachine.swarm.enabled && normalizedMachine.mergeStrategy === 'none'
    ? 'manual_review'
    : normalizedMachine.mergeStrategy;

  const packet: PlanWikiTaskPacket = {
    packetVersion: 'planwiki.task.v1',
    projectId: compileInput.projectId || document.projectId || null,
    objective,
    repoPath: normalizedMachine.repoPath,
    repoScope: normalizedMachine.repoScope,
    selectedFiles: normalizedMachine.selectedFiles,
    constraints: normalizedMachine.constraints,
    allowedTools: normalizedMachine.allowedTools,
    outputFormat: normalizedMachine.outputFormat,
    outputSchema: normalizedMachine.outputSchema || null,
    planExcerpt: buildPlanExcerpt(document),
    blackboardContext: {
      currentGoal: blackboard.current_goal,
      nextMove: blackboard.next_move,
      findings: [...blackboard.findings],
      openQuestions: [...blackboard.open_questions],
    },
    graphContext: {
      repoGraphQueries: normalizedMachine.repoGraphQueries,
      thinkGraphQueries: normalizedMachine.thinkGraphQueries,
      knowGraphQueries: normalizedMachine.knowGraphQueries,
    },
    review: {
      required: mergeStrategy !== 'none' || normalizedMachine.swarm.enabled,
      mergeStrategy,
    },
    swarm: {
      enabled: normalizedMachine.swarm.enabled,
      workerCount: normalizedMachine.swarm.workerCount || 0,
      mode: normalizedMachine.swarm.mode || null,
    },
  };

  return {
    packet,
    downstreamPrompt: buildDownstreamPrompt(packet),
  };
}
