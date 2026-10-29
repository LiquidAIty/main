// Type-only binding for the unchanged Hermes Desktop renderer's internal alias.
declare module '@/types/hermes' {
  export type StarmapGraph = import('../features/agentbuilder/cardProfileClient').CardLearningGraph;
  export type StarmapNode = StarmapGraph['nodes'][number];
}
