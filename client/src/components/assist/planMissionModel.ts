import type { Edge, Node } from '@xyflow/react';

import type { StructuredAssistPlanSurface } from '../builder/assistPlanSurface';
import { GRAPH_THEME } from '../graph/graphVisualTokens';

export type PlanMissionNodeKind =
  | 'Goal'
  | 'Task'
  | 'Research'
  | 'Synthesize'
  | 'Approval'
  | 'Output'
  | 'Note'
  | 'AgentAssignment';

export type PlanMissionNodeStatus =
  | 'seeded'
  | 'ready'
  | 'running'
  | 'blocked'
  | 'awaiting_review'
  | 'complete'
  | 'error'
  // legacy support for any previously persisted plan states
  | 'review'
  | 'done';

export type PlanMissionNodeData = {
  label: string;
  kind: PlanMissionNodeKind;
  description?: string;
  status?: PlanMissionNodeStatus;
  updateKey?: string;
  outputKey?: string;
  assignedAgentId?: string;
  starterPrompt?: string;
  editable?: boolean;
};

export type PlanMissionFlowNode = Node<PlanMissionNodeData>;
export type PlanMissionEdgeMotion = 'idle' | 'active' | 'running';
export type PlanMissionNodeOverrideMap = Record<
  string,
  Partial<PlanMissionNodeData>
>;

export type PlanMissionFlowEdgeData = {
  motion: PlanMissionEdgeMotion;
};

export type PlanMissionFlowEdge = Edge<PlanMissionFlowEdgeData>;

export type PlanMissionGraph = {
  nodes: PlanMissionFlowNode[];
  edges: PlanMissionFlowEdge[];
};

function cleanList(input: string[] | null | undefined): string[] {
  return (Array.isArray(input) ? input : [])
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
}

function makeNode(
  id: string,
  label: string,
  kind: PlanMissionNodeKind,
  x: number,
  y: number,
  description?: string,
  status: PlanMissionNodeStatus = 'seeded',
  updateKey?: string,
  outputKey?: string,
  assignedAgentId?: string,
  starterPrompt?: string,
  editable = true,
): PlanMissionFlowNode {
  return {
    id,
    type: 'mission',
    position: { x, y },
    data: {
      label,
      kind,
      description,
      status,
      updateKey,
      outputKey,
      assignedAgentId,
      starterPrompt,
      editable,
    },
    draggable: true,
    selectable: true,
  };
}

function makeEdge(
  id: string,
  source: string,
  target: string,
  motion: PlanMissionEdgeMotion = 'idle',
): PlanMissionFlowEdge {
  return {
    id,
    source,
    target,
    type: 'turboFlow',
    data: {
      motion,
    },
    className: 'edge-secondary',
    animated: false,
    style: {
      stroke: GRAPH_THEME.edge.neutral,
      strokeWidth: 1.45,
      opacity: 0.58,
    },
    markerEnd: 'agent-edge-circle',
  };
}

function pickFirst(
  items: string[] | null | undefined,
  fallback: string,
): string {
  const first = cleanList(items)[0];
  return first || fallback;
}

export function buildPlanMissionGraph(
  structuredPlan: StructuredAssistPlanSurface,
  nodeOverrides?: PlanMissionNodeOverrideMap,
): PlanMissionGraph {
  const requestText =
    String(structuredPlan.goal || '').trim() ||
    'Research documentation for our current code stack, understand the main frameworks and architecture, gather useful sources, and organize the findings so the system can use them later.';
  const targetText = pickFirst(
    structuredPlan.nextMove,
    'Clarify what parts of the stack and architecture should be researched first.',
  );
  const libraryResearchText = pickFirst(
    structuredPlan.research,
    'Collect documentation for the main frameworks and libraries in the stack.',
  );
  const projectResearchText = pickFirst(
    structuredPlan.whatMattersNow,
    'Pull project-specific architecture understanding from code and internal structure.',
  );
  const agentAssignmentText = pickFirst(
    structuredPlan.agentTasks,
    'Use available research tooling to gather external documentation and supporting context.',
  );
  const synthesisText = pickFirst(
    structuredPlan.pathOptions,
    'Combine framework docs, project context, and web research into one usable summary.',
  );
  const memoryWriteText = pickFirst(
    structuredPlan.humanTasks,
    'Write useful structure into ThinkGraph now so later runs can promote and ground the same plan outputs.',
  );
  const approvalText =
    cleanList(structuredPlan.humanTasks).find((item) =>
      /approve|review|sign[- ]?off/i.test(item),
    ) ||
    'Pause for human review before accepting the current research plan output.';
  const outputText = pickFirst(
    structuredPlan.whatChanged,
    'Return a usable final summary, next steps, and stored graph/memory results.',
  );
  const noteSource = pickFirst(structuredPlan.sources, '');
  const noteText =
    noteSource ||
    'Seed plan graph for this workspace. This data is editable and designed to be updated in place by runtime status/output writes on stable node IDs.';

  const nodes: PlanMissionFlowNode[] = [
    makeNode(
      'mission_user_request',
      'Research Request: Map Stack Documentation',
      'Goal',
      80,
      132,
      'Understand the current LiquidAIty code stack and gather practical documentation the team can use immediately.',
      'complete',
      'user_request',
      'user_request_text',
      undefined,
      requestText,
    ),
    makeNode(
      'mission_define_scope',
      'Scope Documentation Targets',
      'Task',
      430,
      132,
      `Define framework targets, architecture surfaces, and knowledge writeback boundaries. ${targetText}`,
      'ready',
      'documentation_scope',
      'documentation_scope_summary',
      undefined,
      'Define the documentation target for this plan. Focus on the current code stack, core frameworks, graph/memory architecture, orchestration path, and major UI/runtime surfaces.',
    ),
    makeNode(
      'mission_framework_docs',
      'Gather Framework Documentation',
      'Research',
      790,
      30,
      `Collect official docs for core libraries/frameworks in use and map each to runtime responsibilities. ${libraryResearchText}`,
      'ready',
      'framework_docs',
      'framework_docs_findings',
      'card_research_agent',
      'Gather documentation for the key frameworks and libraries used in this project. Return structured sources and why each matters.',
    ),
    makeNode(
      'mission_project_context',
      'Gather Project Architecture Context',
      'Research',
      790,
      240,
      `Extract structure from repository implementation, plan surfaces, runtime flow, and memory graph seams. ${projectResearchText}`,
      'ready',
      'project_architecture_context',
      'project_architecture_findings',
      'card_codegraph_agent',
      'Analyze the current codebase structure and summarize major architecture surfaces, runtime paths, graph systems, and dependencies.',
    ),
    makeNode(
      'mission_web_research',
      'Run Web Documentation Research',
      'AgentAssignment',
      1170,
      132,
      `Use available research tooling to gather external sources, cross-check claims, and capture concise summaries. ${agentAssignmentText}`,
      'ready',
      'web_research_run',
      'web_research_output',
      'card_research_agent',
      'Run documentation-focused research with available web/documentation tools. Prioritize official docs and useful architecture references for this stack.',
    ),
    makeNode(
      'mission_synthesize',
      'Synthesize Findings Into Plan Brief',
      'Synthesize',
      1540,
      132,
      `Merge framework docs, project context, and web findings into one operationally useful documentation brief. ${synthesisText}`,
      'seeded',
      'synthesized_findings',
      'synthesized_documentation_summary',
      undefined,
      'Synthesize gathered findings into a concise architecture-and-documentation summary for downstream graph and agent use.',
    ),
    makeNode(
      'mission_write_graph',
      'Write Provisional Knowledge To ThinkGraph',
      'Task',
      1910,
      132,
      `Store provisional architecture understanding for planning use, preserving traceability and update safety. ${memoryWriteText}`,
      'seeded',
      'write_to_graph_memory',
      'graph_memory_write_result',
      'card_thinkgraph_agent',
      'Write provisional architecture and documentation understanding into ThinkGraph in structured form, ready for later refinement.',
    ),
    makeNode(
      'mission_human_review',
      'Await Human Review',
      'Approval',
      2270,
      132,
      `Pause before accepting or promoting outputs. Review for correctness, relevance, and confidence. ${approvalText}`,
      'awaiting_review',
      'human_review_gate',
      'human_review_decision',
    ),
    makeNode(
      'mission_deliver_output',
      'Deliver Documentation Research Output',
      'Output',
      2580,
      132,
      `Return findings, linked sources, known gaps, and concrete next actions for implementation teams. ${outputText}`,
      'seeded',
      'deliver_documentation_output',
      'final_documentation_output',
    ),
    makeNode(
      'mission_note',
      'Plan Note: Workspace Seed',
      'Note',
      1540,
      352,
      noteText,
      'seeded',
      'mission_note',
      'mission_note_text',
    ),
  ];

  const edges: PlanMissionFlowEdge[] = [
    makeEdge(
      'edge_request_to_scope',
      'mission_user_request',
      'mission_define_scope',
      'active',
    ),
    makeEdge(
      'edge_scope_to_framework_docs',
      'mission_define_scope',
      'mission_framework_docs',
      'active',
    ),
    makeEdge(
      'edge_scope_to_project_context',
      'mission_define_scope',
      'mission_project_context',
      'active',
    ),
    makeEdge(
      'edge_framework_docs_to_web_research',
      'mission_framework_docs',
      'mission_web_research',
      'running',
    ),
    makeEdge(
      'edge_project_context_to_web_research',
      'mission_project_context',
      'mission_web_research',
      'running',
    ),
    makeEdge(
      'edge_web_research_to_synthesize',
      'mission_web_research',
      'mission_synthesize',
      'running',
    ),
    makeEdge(
      'edge_synthesize_to_write_graph',
      'mission_synthesize',
      'mission_write_graph',
      'idle',
    ),
    makeEdge(
      'edge_write_graph_to_human_review',
      'mission_write_graph',
      'mission_human_review',
      'active',
    ),
    makeEdge(
      'edge_human_review_to_deliver_output',
      'mission_human_review',
      'mission_deliver_output',
      'idle',
    ),
    makeEdge('edge_synthesize_to_note', 'mission_synthesize', 'mission_note'),
  ];

  const mergedNodes =
    nodeOverrides && Object.keys(nodeOverrides).length > 0
      ? nodes.map((node) => {
          const override = nodeOverrides[node.id];
          if (!override) return node;
          return {
            ...node,
            data: {
              ...node.data,
              ...override,
            },
          };
        })
      : nodes;

  return { nodes: mergedNodes, edges };
}
