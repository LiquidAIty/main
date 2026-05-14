const fs = require('fs');
const path = 'client/src/runtime/uaAgentDefinitions.ts';
let content = fs.readFileSync(path, 'utf8');

// 1. Add ua_dashboard to UaAgentSurfaceId
content = content.replace(
  /'ua_knowledge_graph_guide';/g,
  "'ua_knowledge_graph_guide'\n  | 'ua_dashboard';"
);

// 2. Replace types
const typesOld = 	ype UaAgentDefinitionBase = {
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

export type UaUiAgentDefinition = UaAgentDefinition;;

const typesNew = 	ype UaAgentDefinitionBase = {
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
  defaultConnected: false;
  requiresPlanApproval: boolean;
  prompt: {
    role: string;
    goal: string;
    proposalTarget: UaGraphProposalTarget;
    proposalGuidance: string;
  };
};

export type UaHeadlessAgentDefinition = UaAgentDefinitionBase & {
  hasUi: false;
  addable: false;
};

export type UaUiAgentDefinition = UaAgentDefinitionBase & {
  hasUi: true;
  addable: true;
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

export type UaAgentDefinition = UaHeadlessAgentDefinition | UaUiAgentDefinition;;

content = content.replace(typesOld, typesNew);

// 3. Make 9 agents headless
const match = content.match(/export const UA_AGENT_DEFINITIONS: readonly UaAgentDefinition\[\] = \[([\s\S]*?)\] as const;/);
if (match) {
  let agentsBlock = match[1];
  
  agentsBlock = agentsBlock.replace(/  \{[\s\S]*?^\s*\}(?=,)/gm, (block) => {
    let newBlock = block.replace(/addable: true,/, 'addable: false,');
    newBlock = newBlock.replace(/hasUi: true,/, 'hasUi: false,');
    
    const lines = newBlock.split('\n');
    const filteredLines = [];
    let skipPanel = false;
    for (const line of lines) {
      if (line.includes('hasCanvas:') || line.includes('uiEngine:') || line.includes('uiLens:') || line.includes('surfaceId:') || line.includes('panelKind:') || line.includes('canvasKind:') || line.includes('icon:') || line.includes('cardIcon:') || line.includes('railIcon:') || line.includes('controlRailIcon:')) {
        continue;
      }
      if (line.includes('panel: {')) {
        skipPanel = true;
        continue;
      }
      if (skipPanel) {
        if (/^\s*\},/.test(line) || line.trim() === '}') {
          skipPanel = false;
        }
        continue;
      }
      filteredLines.push(line);
    }
    return filteredLines.join('\n');
  });

  const understandAnything = 
  {
    id: 'understand-anything',
    name: 'Understand Anything',
    description: 'Understand-Anything workbench with multiple internal skills.',
    subtitle: 'Knowledge and Code Analysis Workbench',
    templateId: 'template_project_scanner',
    promptTemplateId: 'prompt_project_scanner',
    skillType: 'project_scanner',
    sourceAgentFile: 'understand-anything.md',
    skillId: 'ua.workbench',
    skills: [
      'ua.project_scanner',
      'ua.file_analyzer',
      'ua.architecture_analyzer',
      'ua.domain_analyzer',
      'ua.tour_builder',
      'ua.graph_reviewer',
      'ua.article_analyzer',
      'ua.assemble_reviewer',
      'ua.knowledge_graph_guide'
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
    icon: 'M12 4a4 4 0 0 1 4 4c0 4-4 8-4 8s-4-4-4-8a4 4 0 0 1 4-4z M6 20h12',
    cardIcon: 'M12 4a4 4 0 0 1 4 4c0 4-4 8-4 8s-4-4-4-8a4 4 0 0 1 4-4z M6 20h12',
    railIcon: 'M12 4a4 4 0 0 1 4 4c0 4-4 8-4 8s-4-4-4-8a4 4 0 0 1 4-4z M6 20h12',
    controlRailIcon: 'M12 4a4 4 0 0 1 4 4c0 4-4 8-4 8s-4-4-4-8a4 4 0 0 1 4-4z M6 20h12',
    requiresPlanApproval: false,
    prompt: {
      role: 'You are the Understand Anything Workbench Agent.',
      goal: 'Orchestrate deep codebase and domain analysis using your internal specialized skills.',
      proposalTarget: 'CodeGraph',
      proposalGuidance: 'Delegate to internal skills when analyzing the codebase.'
    },
    panel: {
      status: 'Workbench',
      summary: 'Understand Anything integrated workbench',
      chips: ['analysis', 'graph', 'domain', 'code'],
      drawerCopy: 'The Understand Anything workbench provides a unified view of code and knowledge graphs.',
      sections: []
    }
  },;

  content = content.replace(match[1], agentsBlock + understandAnything + '\n');
}

fs.writeFileSync(path, content, 'utf8');
