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

export function hermesReportReferences(report: HermesReportView): HermesReportReference[] {
  return [
    ...report.linkedThinkGraphNodeIds.map((id) => ({ authority: 'thinkgraph' as const, id })),
    ...report.linkedKnowGraphRefs.map((id) => ({ authority: 'knowgraph' as const, id })),
    ...report.linkedCodeGraphRefs.map((id) => ({ authority: 'codegraph' as const, id })),
  ];
}
