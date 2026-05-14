import type {
  AgentCardRuntimeType,
  RuntimeBinding,
} from '../types/agentgraph';

export type UaGraphProposalTarget =
  | 'CodeGraph'
  | 'ThinkGraph'
  | 'KnowGraph'
  | 'PlanSurface';

export type UaAgentSurfaceId =
  | 'ua_dashboard';

export type UaAgentSkillType =
  | 'project_scanner'
  | 'file_analyzer'
  | 'architecture_analyzer'
  | 'domain_analyzer'
  | 'tour_builder'
  | 'graph_reviewer'
  | 'article_analyzer'
  | 'assemble_reviewer'
  | 'knowledge_graph_guide';

export type UaDashboardLens = UaAgentSkillType;
export type UaUiEngine = 'ua_dashboard';

type UaPanelModel = {
  status: string;
  summary: string;
  chips: string[];
  drawerCopy: string;
  sections: Array<{
    title: string;
    items: string[];
  }>;
};

type UaPromptModel = {
  role: string;
  goal: string;
  proposalTarget: UaGraphProposalTarget;
  proposalGuidance: string;
};

type UaAgentDefinitionBase = {
  id: string;
  name: string;
  description: string;
  subtitle: string;
  templateId: string;
  promptTemplateId: string;
  skillType: UaAgentSkillType;
  sourceAgentFile: string;
  skillId: string;
  skills: string[];
  runtimeBinding: RuntimeBinding;
  runtimeType: AgentCardRuntimeType;
  addable: boolean;
  defaultConnected: false;
  requiresPlanApproval: boolean;
  prompt: UaPromptModel;
};

export type UaInternalAgentDefinition = UaAgentDefinitionBase & {
  hasUi: false;
  hasCanvas: false;
  addable: false;
};

export type UaUiAgentDefinition = UaAgentDefinitionBase & {
  hasUi: true;
  hasCanvas: true;
  addable: true;
  uiEngine: UaUiEngine;
  uiLens: UaDashboardLens;
  surfaceId: UaAgentSurfaceId;
  panelKind: UaAgentSurfaceId;
  canvasKind: UaAgentSurfaceId;
  cardIcon: string;
  railIcon: string;
  icon: string;
  controlRailIcon: string;
  panel: UaPanelModel;
};

export type UaAgentDefinition =
  | UaUiAgentDefinition
  | UaInternalAgentDefinition;

type UaInternalSeed = Omit<
  UaInternalAgentDefinition,
  'hasUi' | 'hasCanvas' | 'addable'
>;

const INTERNAL_UA_AGENT_SEEDS: readonly UaInternalSeed[] = [
  {
    id: 'project_scanner',
    name: 'Project Scanner',
    description: 'Inventories files, frameworks, entry points, and subsystem boundaries.',
    subtitle: 'Repo inventory and boundaries',
    templateId: 'template_project_scanner',
    promptTemplateId: 'prompt_project_scanner',
    skillType: 'project_scanner',
    sourceAgentFile: 'project-scanner.md',
    skillId: 'ua.project_scanner',
    skills: ['ua.project_scanner', 'repo_inventory', 'codegraph_proposal'],
    runtimeBinding: 'assist',
    runtimeType: 'assistant_agent',
    defaultConnected: false,
    requiresPlanApproval: false,
    prompt: {
      role: 'You are Project Scanner, a codebase inventory specialist for Agent Canvas.',
      goal: 'Identify relevant files, languages, frameworks, entry points, and subsystem boundaries from provided repo context.',
      proposalTarget: 'CodeGraph',
      proposalGuidance:
        'Prefer source-grounded file, module, service, endpoint, and config proposals. Do not write graph data directly.',
    },
  },
  {
    id: 'file_analyzer',
    name: 'File Analyzer',
    description: 'Analyzes files, symbols, imports, exports, and local responsibilities.',
    subtitle: 'File, function, class, entity analysis',
    templateId: 'template_file_analyzer',
    promptTemplateId: 'prompt_file_analyzer',
    skillType: 'file_analyzer',
    sourceAgentFile: 'file-analyzer.md',
    skillId: 'ua.file_analyzer',
    skills: ['ua.file_analyzer', 'symbol_analysis', 'codegraph_proposal'],
    runtimeBinding: 'assist',
    runtimeType: 'assistant_agent',
    defaultConnected: false,
    requiresPlanApproval: false,
    prompt: {
      role: 'You are File Analyzer, a source-grounded file and symbol analysis specialist for Agent Canvas.',
      goal: 'Extract symbols, imports, exports, responsibilities, risks, and source-grounded relationships from one file or focused file set.',
      proposalTarget: 'CodeGraph',
      proposalGuidance:
        'Prefer source-grounded file, function, class, interface, route, and schema proposals. Do not write graph data directly.',
    },
  },
  {
    id: 'architecture_analyzer',
    name: 'Architecture Analyzer',
    description: 'Maps layers, services, runtime boundaries, and dependency direction.',
    subtitle: 'Layers, services, dependencies',
    templateId: 'template_architecture_analyzer',
    promptTemplateId: 'prompt_architecture_analyzer',
    skillType: 'architecture_analyzer',
    sourceAgentFile: 'architecture-analyzer.md',
    skillId: 'ua.architecture_analyzer',
    skills: ['ua.architecture_analyzer', 'architecture_review', 'codegraph_proposal'],
    runtimeBinding: 'assist',
    runtimeType: 'assistant_agent',
    defaultConnected: false,
    requiresPlanApproval: false,
    prompt: {
      role: 'You are Architecture Analyzer, a subsystem and dependency analysis specialist for Agent Canvas.',
      goal: 'Identify packages, services, layers, runtime boundaries, dependency direction, and cross-cutting risks.',
      proposalTarget: 'CodeGraph',
      proposalGuidance:
        'Prefer source-grounded subsystem, dependency, import, call, config, and route proposals. Do not write graph data directly.',
    },
  },
  {
    id: 'domain_analyzer',
    name: 'Domain Analyzer',
    description: 'Extracts domain concepts, flows, business rules, and uncertainties.',
    subtitle: 'Domain, flow, step analysis',
    templateId: 'template_domain_analyzer',
    promptTemplateId: 'prompt_domain_analyzer',
    skillType: 'domain_analyzer',
    sourceAgentFile: 'domain-analyzer.md',
    skillId: 'ua.domain_analyzer',
    skills: ['ua.domain_analyzer', 'domain_graph', 'thinkgraph_proposal'],
    runtimeBinding: 'assist',
    runtimeType: 'assistant_agent',
    defaultConnected: false,
    requiresPlanApproval: false,
    prompt: {
      role: 'You are Domain Analyzer, a domain concept and business vocabulary specialist for Agent Canvas.',
      goal: 'Extract domain concepts, entities, flows, business rules, uncertainty, and cross-domain interactions from code and docs.',
      proposalTarget: 'ThinkGraph',
      proposalGuidance:
        'Prefer provisional domain concept and uncertainty proposals. Do not write graph data directly.',
    },
  },
  {
    id: 'tour_builder',
    name: 'Tour Builder',
    description: 'Builds guided project tours through entry points, data flows, and workflows.',
    subtitle: 'Guided tour and onboarding',
    templateId: 'template_tour_builder',
    promptTemplateId: 'prompt_tour_builder',
    skillType: 'tour_builder',
    sourceAgentFile: 'tour-builder.md',
    skillId: 'ua.tour_builder',
    skills: ['ua.tour_builder', 'onboarding_tour', 'plan_surface_proposal'],
    runtimeBinding: 'assist',
    runtimeType: 'assistant_agent',
    defaultConnected: false,
    requiresPlanApproval: false,
    prompt: {
      role: 'You are Tour Builder, a guided codebase tour specialist for Agent Canvas.',
      goal: 'Create onboarding paths through entry points, data flows, layers, and key maintenance workflows.',
      proposalTarget: 'PlanSurface',
      proposalGuidance:
        'Prefer reviewable tour step proposals with titles, descriptions, file paths, symbols, graph node ids, and smoke checks. Do not write plan data directly.',
    },
  },
  {
    id: 'graph_reviewer',
    name: 'Graph Reviewer',
    description: 'Reviews graph snapshots for gaps, stale nodes, contradictions, and provenance.',
    subtitle: 'Graph gaps and confidence review',
    templateId: 'template_graph_reviewer',
    promptTemplateId: 'prompt_graph_reviewer',
    skillType: 'graph_reviewer',
    sourceAgentFile: 'graph-reviewer.md',
    skillId: 'ua.graph_reviewer',
    skills: ['ua.graph_reviewer', 'graph_validation', 'thinkgraph_proposal'],
    runtimeBinding: 'assist',
    runtimeType: 'assistant_agent',
    defaultConnected: false,
    requiresPlanApproval: false,
    prompt: {
      role: 'You are Graph Reviewer, a graph QA and consistency specialist for Agent Canvas.',
      goal: 'Review CodeGraph, ThinkGraph, or KnowGraph snapshots for stale nodes, dangling relationships, gaps, contradictions, and missing provenance.',
      proposalTarget: 'ThinkGraph',
      proposalGuidance:
        'Prefer review finding and uncertainty proposals. Do not write graph data directly.',
    },
  },
  {
    id: 'article_analyzer',
    name: 'Article Analyzer',
    description: 'Analyzes markdown articles for entities, claims, topics, and relationships.',
    subtitle: 'Article claims and relationships',
    templateId: 'template_article_analyzer',
    promptTemplateId: 'prompt_article_analyzer',
    skillType: 'article_analyzer',
    sourceAgentFile: 'article-analyzer.md',
    skillId: 'ua.article_analyzer',
    skills: ['ua.article_analyzer', 'knowledge_graph_extraction', 'article_relationships'],
    runtimeBinding: 'assist',
    runtimeType: 'assistant_agent',
    defaultConnected: false,
    requiresPlanApproval: false,
    prompt: {
      role: 'You are Article Analyzer, a markdown knowledge extraction specialist for Agent Canvas.',
      goal: 'Extract entities, claims, topics, and implicit relationships from article batches using source-grounded evidence.',
      proposalTarget: 'KnowGraph',
      proposalGuidance:
        'Prefer evidence-backed entity, claim, and relationship proposals. Do not write graph data directly.',
    },
  },
  {
    id: 'assemble_reviewer',
    name: 'Assemble Reviewer',
    description: 'Reviews assembled knowledge graph output for semantic merge issues and recoverable gaps.',
    subtitle: 'Assembly review and recovery',
    templateId: 'template_assemble_reviewer',
    promptTemplateId: 'prompt_assemble_reviewer',
    skillType: 'assemble_reviewer',
    sourceAgentFile: 'assemble-reviewer.md',
    skillId: 'ua.assemble_reviewer',
    skills: ['ua.assemble_reviewer', 'assembly_review', 'knowledge_graph_validation'],
    runtimeBinding: 'assist',
    runtimeType: 'assistant_agent',
    defaultConnected: false,
    requiresPlanApproval: false,
    prompt: {
      role: 'You are Assemble Reviewer, a semantic QA reviewer for assembled Understand-Anything graph output.',
      goal: 'Review merge reports, identify recoverable semantic gaps, and produce a concise assembly review.',
      proposalTarget: 'KnowGraph',
      proposalGuidance:
        'Return review findings only. Do not write graph data directly or mutate assembled files.',
    },
  },
  {
    id: 'knowledge_graph_guide',
    name: 'Knowledge Graph Guide',
    description: 'Guides users through Understand-Anything graph structure, relationships, layers, and tours.',
    subtitle: 'Graph guide and reference',
    templateId: 'template_knowledge_graph_guide',
    promptTemplateId: 'prompt_knowledge_graph_guide',
    skillType: 'knowledge_graph_guide',
    sourceAgentFile: 'knowledge-graph-guide.md',
    skillId: 'ua.knowledge_graph_guide',
    skills: ['ua.knowledge_graph_guide', 'graph_reference', 'graph_navigation'],
    runtimeBinding: 'assist',
    runtimeType: 'assistant_agent',
    defaultConnected: false,
    requiresPlanApproval: false,
    prompt: {
      role: 'You are Knowledge Graph Guide, a guide for Understand-Anything graph structure and usage.',
      goal: 'Explain graph files, node and edge types, layers, tours, and query patterns from provided graph context.',
      proposalTarget: 'KnowGraph',
      proposalGuidance:
        'Return guidance and references only. Do not write graph data directly.',
    },
  },
] as const;

export const UA_INTERNAL_AGENT_DEFINITIONS: readonly UaInternalAgentDefinition[] =
  INTERNAL_UA_AGENT_SEEDS.map((seed) => ({
    ...seed,
    hasUi: false,
    hasCanvas: false,
    addable: false,
  }));

export const UA_WORKBENCH_DEFINITION: UaUiAgentDefinition = {
  id: 'understand-anything',
  name: 'Understand Anything',
  description: 'Understand Anything workbench with internal lens routing.',
  subtitle: 'UA graph dashboard workbench',
  templateId: 'template_understand_anything_workbench',
  promptTemplateId: 'prompt_understand_anything_workbench',
  skillType: 'project_scanner',
  sourceAgentFile: 'project-scanner.md',
  skillId: 'ua.understand_anything_workbench',
  skills: [
    'ua.project_scanner',
    'ua.file_analyzer',
    'ua.architecture_analyzer',
    'ua.domain_analyzer',
    'ua.tour_builder',
    'ua.graph_reviewer',
    'ua.article_analyzer',
    'ua.assemble_reviewer',
    'ua.knowledge_graph_guide',
  ],
  runtimeBinding: 'assist',
  runtimeType: 'assistant_agent',
  addable: true,
  defaultConnected: false,
  hasUi: true,
  hasCanvas: true,
  uiEngine: 'ua_dashboard',
  uiLens: 'project_scanner',
  surfaceId: 'ua_dashboard',
  panelKind: 'ua_dashboard',
  canvasKind: 'ua_dashboard',
  icon: 'M4 5h16v14H4z M8 9h8 M8 13h8',
  cardIcon: 'M4 5h16v14H4z M8 9h8 M8 13h8',
  railIcon: 'M4 5h16v14H4z M8 9h8 M8 13h8',
  controlRailIcon: 'M4 5h16v14H4z M8 9h8 M8 13h8',
  requiresPlanApproval: false,
  prompt: {
    role: 'You are the Understand Anything Workbench for Agent Canvas.',
    goal: 'Route analysis requests through the correct internal UA lens and keep work in the shared real UA dashboard.',
    proposalTarget: 'CodeGraph',
    proposalGuidance:
      'Use internal UA lenses for analysis. Do not write graph data directly.',
  },
  panel: {
    status: '',
    summary: '',
    chips: [],
    drawerCopy: '',
    sections: [],
  },
};

export const UA_AGENT_DEFINITIONS: readonly UaAgentDefinition[] = [
  UA_WORKBENCH_DEFINITION,
  ...UA_INTERNAL_AGENT_DEFINITIONS,
];

export function getUaAgentDefinitionBySurface(
  surfaceId: string | null | undefined,
): UaUiAgentDefinition | null {
  return (
    UA_AGENT_DEFINITIONS.find(
      (agent): agent is UaUiAgentDefinition =>
        agent.hasUi && agent.surfaceId === surfaceId,
    ) ?? null
  );
}

export function getUiUaAgentDefinitions(): readonly UaUiAgentDefinition[] {
  return UA_AGENT_DEFINITIONS.filter(
    (agent): agent is UaUiAgentDefinition => agent.hasUi,
  );
}
