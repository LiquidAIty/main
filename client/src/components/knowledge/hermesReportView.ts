export type HermesGraphAuthority = 'thinkgraph' | 'knowgraph' | 'codegraph';

export type HermesReportView = {
  reportId: string;
  status: 'created' | 'updated';
  summary: string;
  reportMarkdown: string;
  parentRunId: string;
  artifactRunId: string;
  focusNodeIds: string[];
  requestedOutcome: string | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
  linkedThinkGraphNodeIds: string[];
  linkedKnowGraphRefs: string[];
  linkedCodeGraphRefs: string[];
};

export type HermesReportReference = {
  authority: HermesGraphAuthority;
  id: string;
};
