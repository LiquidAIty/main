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
  | 'ua_project_scanner'
  | 'ua_file_analyzer'
  | 'ua_architecture_analyzer'
  | 'ua_domain_analyzer'
  | 'ua_tour_builder'
  | 'ua_graph_reviewer'
  | 'ua_article_analyzer'
  | 'ua_assemble_reviewer'
  | 'ua_knowledge_graph_guide';

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
  addable: true;
  defaultConnected: false;
  requiresPlanApproval: boolean;
  prompt: {
    role: string;
    goal: string;
    proposalTarget: UaGraphProposalTarget;
    proposalGuidance: string;
  };
};

export type UaAgentDefinition = UaAgentDefinitionBase & {
  hasUi: true;
  hasCanvas: true;
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

export type UaUiAgentDefinition = UaAgentDefinition;

export const UA_AGENT_DEFINITIONS: readonly UaAgentDefinition[] = [
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
    addable: true,
    defaultConnected: false,
    hasUi: true,
    hasCanvas: true,
    uiEngine: 'ua_dashboard',
    uiLens: 'project_scanner',
    surfaceId: 'ua_project_scanner',
    panelKind: 'ua_project_scanner',
    canvasKind: 'ua_project_scanner',
    icon: 'M4 6h16M4 12h16M4 18h10',
    cardIcon: 'M4 6h16M4 12h16M4 18h10',
    railIcon: 'M4 6h16M4 12h16M4 18h10',
    controlRailIcon: 'M4 6h16M4 12h16M4 18h10',
    requiresPlanApproval: false,
    prompt: {
      role: 'You are Project Scanner, a codebase inventory specialist for Agent Canvas.',
      goal: 'Identify relevant files, languages, frameworks, entry points, and subsystem boundaries from provided repo context.',
      proposalTarget: 'CodeGraph',
      proposalGuidance:
        'Prefer source-grounded file, module, service, endpoint, and config proposals. Do not write graph data directly.',
    },
    panel: {
      status: 'Inventory',
      summary: 'ProjectOverview and FileExplorer style inventory panel.',
      chips: ['files', 'frameworks', 'entry points', 'subsystems'],
      drawerCopy:
        'Project Scanner is available as a panel only after its card is connected to Magentic-One.',
      sections: [
        {
          title: 'Inventory',
          items: ['Repository roots', 'Package and app boundaries', 'Entrypoints and config files'],
        },
        {
          title: 'Outputs',
          items: ['Candidate CodeGraph nodes', 'Subsystem groupings', 'Missing-context flags'],
        },
      ],
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
    addable: true,
    defaultConnected: false,
    hasUi: true,
    hasCanvas: true,
    uiEngine: 'ua_dashboard',
    uiLens: 'file_analyzer',
    surfaceId: 'ua_file_analyzer',
    panelKind: 'ua_file_analyzer',
    canvasKind: 'ua_file_analyzer',
    icon: 'M6 3h9l3 3v15H6z M14 3v4h4 M8 11h8 M8 15h8',
    cardIcon: 'M6 3h9l3 3v15H6z M14 3v4h4 M8 11h8 M8 15h8',
    railIcon: 'M6 3h9l3 3v15H6z M14 3v4h4 M8 11h8 M8 15h8',
    controlRailIcon: 'M6 3h9l3 3v15H6z M14 3v4h4 M8 11h8 M8 15h8',
    requiresPlanApproval: false,
    prompt: {
      role: 'You are File Analyzer, a source-grounded file and symbol analysis specialist for Agent Canvas.',
      goal: 'Extract symbols, imports, exports, responsibilities, risks, and source-grounded relationships from one file or focused file set.',
      proposalTarget: 'CodeGraph',
      proposalGuidance:
        'Prefer source-grounded file, function, class, interface, route, and schema proposals. Do not write graph data directly.',
    },
    panel: {
      status: 'Source',
      summary: 'NodeInfo, CodeViewer, and SearchBar style source review panel.',
      chips: ['symbols', 'imports', 'exports', 'risks'],
      drawerCopy:
        'File Analyzer is available as a panel only after its card is connected to Magentic-One.',
      sections: [
        {
          title: 'Entities',
          items: ['Functions and classes', 'Imports and exports', 'Local responsibilities'],
        },
        {
          title: 'Review',
          items: ['Risk notes', 'Line-grounded references', 'Candidate structural links'],
        },
      ],
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
    addable: true,
    defaultConnected: false,
    hasUi: true,
    hasCanvas: true,
    uiEngine: 'ua_dashboard',
    uiLens: 'architecture_analyzer',
    surfaceId: 'ua_architecture_analyzer',
    panelKind: 'ua_architecture_analyzer',
    canvasKind: 'ua_architecture_analyzer',
    icon: 'M4 18h16 M6 18V8h4v10 M14 18V4h4v14',
    cardIcon: 'M4 18h16 M6 18V8h4v10 M14 18V4h4v14',
    railIcon: 'M4 18h16 M6 18V8h4v10 M14 18V4h4v14',
    controlRailIcon: 'M4 18h16 M6 18V8h4v10 M14 18V4h4v14',
    requiresPlanApproval: false,
    prompt: {
      role: 'You are Architecture Analyzer, a subsystem and dependency analysis specialist for Agent Canvas.',
      goal: 'Identify packages, services, layers, runtime boundaries, dependency direction, and cross-cutting risks.',
      proposalTarget: 'CodeGraph',
      proposalGuidance:
        'Prefer source-grounded subsystem, dependency, import, call, config, and route proposals. Do not write graph data directly.',
    },
    panel: {
      status: 'Architecture',
      summary: 'GraphView, LayerLegend, and LayerCluster style architecture panel.',
      chips: ['layers', 'services', 'dependencies', 'runtime'],
      drawerCopy:
        'Architecture Analyzer is available as a panel only after its card is connected to Magentic-One.',
      sections: [
        {
          title: 'Structure',
          items: ['Layer boundaries', 'Service responsibilities', 'Runtime handoffs'],
        },
        {
          title: 'Signals',
          items: ['Dependency direction', 'Cross-cutting risks', 'Boundary violations'],
        },
      ],
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
    addable: true,
    defaultConnected: false,
    hasUi: true,
    hasCanvas: true,
    uiEngine: 'ua_dashboard',
    uiLens: 'domain_analyzer',
    surfaceId: 'ua_domain_analyzer',
    panelKind: 'ua_domain_analyzer',
    canvasKind: 'ua_domain_analyzer',
    icon: 'M12 4a4 4 0 0 1 4 4c0 4-4 8-4 8s-4-4-4-8a4 4 0 0 1 4-4z M6 20h12',
    cardIcon: 'M12 4a4 4 0 0 1 4 4c0 4-4 8-4 8s-4-4-4-8a4 4 0 0 1 4-4z M6 20h12',
    railIcon: 'M12 4a4 4 0 0 1 4 4c0 4-4 8-4 8s-4-4-4-8a4 4 0 0 1 4-4z M6 20h12',
    controlRailIcon: 'M12 4a4 4 0 0 1 4 4c0 4-4 8-4 8s-4-4-4-8a4 4 0 0 1 4-4z M6 20h12',
    requiresPlanApproval: false,
    prompt: {
      role: 'You are Domain Analyzer, a domain concept and business vocabulary specialist for Agent Canvas.',
      goal: 'Extract domain concepts, entities, flows, business rules, uncertainty, and cross-domain interactions from code and docs.',
      proposalTarget: 'ThinkGraph',
      proposalGuidance:
        'Prefer provisional domain concept and uncertainty proposals. Do not write graph data directly.',
    },
    panel: {
      status: 'Domain',
      summary: 'DomainGraphView, DomainCluster, Flow, and Step style domain panel.',
      chips: ['domain', 'flow', 'steps', 'uncertainty'],
      drawerCopy:
        'Domain Analyzer is available as a panel only after its card is connected to Magentic-One.',
      sections: [
        {
          title: 'Domain Map',
          items: ['Concept vocabulary', 'Business entities', 'Cross-domain interactions'],
        },
        {
          title: 'Flow Steps',
          items: ['User or system flows', 'Step responsibilities', 'Uncertain assumptions'],
        },
      ],
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
    addable: true,
    defaultConnected: false,
    hasUi: true,
    hasCanvas: true,
    uiEngine: 'ua_dashboard',
    uiLens: 'tour_builder',
    surfaceId: 'ua_tour_builder',
    panelKind: 'ua_tour_builder',
    canvasKind: 'ua_tour_builder',
    icon: 'M5 19V5l7-2 7 2v14l-7 2z M12 3v18',
    cardIcon: 'M5 19V5l7-2 7 2v14l-7 2z M12 3v18',
    railIcon: 'M5 19V5l7-2 7 2v14l-7 2z M12 3v18',
    controlRailIcon: 'M5 19V5l7-2 7 2v14l-7 2z M12 3v18',
    requiresPlanApproval: false,
    prompt: {
      role: 'You are Tour Builder, a guided codebase tour specialist for Agent Canvas.',
      goal: 'Create onboarding paths through entry points, data flows, layers, and key maintenance workflows.',
      proposalTarget: 'PlanSurface',
      proposalGuidance:
        'Prefer reviewable tour step proposals with titles, descriptions, file paths, symbols, graph node ids, and smoke checks. Do not write plan data directly.',
    },
    panel: {
      status: 'Tour',
      summary: 'LearnPanel style guided onboarding panel.',
      chips: ['tour', 'onboarding', 'entry points', 'workflow'],
      drawerCopy:
        'Tour Builder is available as a panel only after its card is connected to Magentic-One.',
      sections: [
        {
          title: 'Tour Path',
          items: ['Entry points', 'Data flow checkpoints', 'Maintenance workflows'],
        },
        {
          title: 'Step Model',
          items: ['Tour steps', 'Referenced files', 'Expected learning outcomes'],
        },
      ],
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
    addable: true,
    defaultConnected: false,
    hasUi: true,
    hasCanvas: true,
    uiEngine: 'ua_dashboard',
    uiLens: 'graph_reviewer',
    surfaceId: 'ua_graph_reviewer',
    panelKind: 'ua_graph_reviewer',
    canvasKind: 'ua_graph_reviewer',
    icon: 'M6 7a3 3 0 1 0 0.01 0 M18 7a3 3 0 1 0 0.01 0 M12 17a3 3 0 1 0 0.01 0 M8.5 8.5l7 0 M7.5 9.5l3 5 M16.5 9.5l-3 5',
    cardIcon: 'M6 7a3 3 0 1 0 0.01 0 M18 7a3 3 0 1 0 0.01 0 M12 17a3 3 0 1 0 0.01 0 M8.5 8.5l7 0 M7.5 9.5l3 5 M16.5 9.5l-3 5',
    railIcon: 'M6 7a3 3 0 1 0 0.01 0 M18 7a3 3 0 1 0 0.01 0 M12 17a3 3 0 1 0 0.01 0 M8.5 8.5l7 0 M7.5 9.5l3 5 M16.5 9.5l-3 5',
    controlRailIcon: 'M6 7a3 3 0 1 0 0.01 0 M18 7a3 3 0 1 0 0.01 0 M12 17a3 3 0 1 0 0.01 0 M8.5 8.5l7 0 M7.5 9.5l3 5 M16.5 9.5l-3 5',
    requiresPlanApproval: false,
    prompt: {
      role: 'You are Graph Reviewer, a graph QA and consistency specialist for Agent Canvas.',
      goal: 'Review CodeGraph, ThinkGraph, or KnowGraph snapshots for stale nodes, dangling relationships, gaps, contradictions, and missing provenance.',
      proposalTarget: 'ThinkGraph',
      proposalGuidance:
        'Prefer review finding and uncertainty proposals. Do not write graph data directly.',
    },
    panel: {
      status: 'Review',
      summary: 'WarningBanner and validation issue style graph QA panel.',
      chips: ['gaps', 'confidence', 'provenance', 'validation'],
      drawerCopy:
        'Graph Reviewer is available as a panel only after its card is connected to Magentic-One.',
      sections: [
        {
          title: 'Validation',
          items: ['Dangling relationships', 'Stale or weak nodes', 'Missing provenance'],
        },
        {
          title: 'Findings',
          items: ['Confidence notes', 'Contradictions', 'Follow-up proposals'],
        },
      ],
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
    addable: true,
    defaultConnected: false,
    hasUi: true,
    hasCanvas: true,
    uiEngine: 'ua_dashboard',
    uiLens: 'article_analyzer',
    surfaceId: 'ua_article_analyzer',
    panelKind: 'ua_article_analyzer',
    canvasKind: 'ua_article_analyzer',
    icon: 'M6 4h12v16H6z M9 8h6 M9 12h6 M9 16h4',
    cardIcon: 'M6 4h12v16H6z M9 8h6 M9 12h6 M9 16h4',
    railIcon: 'M6 4h12v16H6z M9 8h6 M9 12h6 M9 16h4',
    controlRailIcon: 'M6 4h12v16H6z M9 8h6 M9 12h6 M9 16h4',
    requiresPlanApproval: false,
    prompt: {
      role: 'You are Article Analyzer, a markdown knowledge extraction specialist for Agent Canvas.',
      goal: 'Extract entities, claims, topics, and implicit relationships from article batches using source-grounded evidence.',
      proposalTarget: 'KnowGraph',
      proposalGuidance:
        'Prefer evidence-backed entity, claim, and relationship proposals. Do not write graph data directly.',
    },
    panel: {
      status: 'Articles',
      summary: 'KnowledgeGraphView style article knowledge panel.',
      chips: ['entities', 'claims', 'topics', 'relationships'],
      drawerCopy:
        'Article Analyzer is available as a panel only after its card is connected to Magentic-One.',
      sections: [
        {
          title: 'Extraction',
          items: ['Named entities', 'Claims and decisions', 'Topic clusters'],
        },
        {
          title: 'Relationships',
          items: ['Builds-on links', 'Contradictions', 'Citations and examples'],
        },
      ],
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
    addable: true,
    defaultConnected: false,
    hasUi: true,
    hasCanvas: true,
    uiEngine: 'ua_dashboard',
    uiLens: 'assemble_reviewer',
    surfaceId: 'ua_assemble_reviewer',
    panelKind: 'ua_assemble_reviewer',
    canvasKind: 'ua_assemble_reviewer',
    icon: 'M5 5h14v4H5z M5 11h14v8H5z M8 15h3 M13 15h3',
    cardIcon: 'M5 5h14v4H5z M5 11h14v8H5z M8 15h3 M13 15h3',
    railIcon: 'M5 5h14v4H5z M5 11h14v8H5z M8 15h3 M13 15h3',
    controlRailIcon: 'M5 5h14v4H5z M5 11h14v8H5z M8 15h3 M13 15h3',
    requiresPlanApproval: false,
    prompt: {
      role: 'You are Assemble Reviewer, a semantic QA reviewer for assembled Understand-Anything graph output.',
      goal: 'Review merge reports, identify recoverable semantic gaps, and produce a concise assembly review.',
      proposalTarget: 'KnowGraph',
      proposalGuidance:
        'Return review findings only. Do not write graph data directly or mutate assembled files.',
    },
    panel: {
      status: 'Assembly',
      summary: 'Shared UA dashboard canvas opened in assemble_reviewer lens.',
      chips: ['merge report', 'recovery', 'cross-batch gaps', 'quality'],
      drawerCopy:
        'Assemble Reviewer uses the shared Understand-Anything dashboard canvas when connected to Magentic-One.',
      sections: [
        {
          title: 'Review Inputs',
          items: ['Merge script report', 'Assembled graph summary', 'Dropped node and edge notes'],
        },
        {
          title: 'Review Focus',
          items: ['Semantic merge issues', 'Recoverable gaps', 'Cross-batch relationship checks'],
        },
      ],
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
    addable: true,
    defaultConnected: false,
    hasUi: true,
    hasCanvas: true,
    uiEngine: 'ua_dashboard',
    uiLens: 'knowledge_graph_guide',
    surfaceId: 'ua_knowledge_graph_guide',
    panelKind: 'ua_knowledge_graph_guide',
    canvasKind: 'ua_knowledge_graph_guide',
    icon: 'M6 4h11a2 2 0 0 1 2 2v14H8a2 2 0 0 1-2-2z M9 8h6 M9 12h7 M9 16h5',
    cardIcon: 'M6 4h11a2 2 0 0 1 2 2v14H8a2 2 0 0 1-2-2z M9 8h6 M9 12h7 M9 16h5',
    railIcon: 'M6 4h11a2 2 0 0 1 2 2v14H8a2 2 0 0 1-2-2z M9 8h6 M9 12h7 M9 16h5',
    controlRailIcon: 'M6 4h11a2 2 0 0 1 2 2v14H8a2 2 0 0 1-2-2z M9 8h6 M9 12h7 M9 16h5',
    requiresPlanApproval: false,
    prompt: {
      role: 'You are Knowledge Graph Guide, a guide for Understand-Anything graph structure and usage.',
      goal: 'Explain graph files, node and edge types, layers, tours, and query patterns from provided graph context.',
      proposalTarget: 'KnowGraph',
      proposalGuidance:
        'Return guidance and references only. Do not write graph data directly.',
    },
    panel: {
      status: 'Guide',
      summary: 'Shared UA dashboard canvas opened in knowledge_graph_guide lens.',
      chips: ['node types', 'edge types', 'layers', 'tours'],
      drawerCopy:
        'Knowledge Graph Guide uses the shared Understand-Anything dashboard canvas when connected to Magentic-One.',
      sections: [
        {
          title: 'Reference',
          items: ['Graph file locations', 'Node and edge conventions', 'Layer and tour structure'],
        },
        {
          title: 'Navigation',
          items: ['Query patterns', 'Relationship tracing', 'Dashboard usage guidance'],
        },
      ],
    },
  },
] as const;

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
