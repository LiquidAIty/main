import type { RepoGraphPersistenceEnvelope } from './types';
import type { RepoGraphIngestRecord } from './types';

export function createRepoGraphPersistenceEnvelope(
  record: RepoGraphIngestRecord,
): RepoGraphPersistenceEnvelope {
  return {
    knowGraph: record.knowGraph,
    thinkGraph: record.thinkGraph,
    blackboardWrite: {
      store: {
        repo_graph_last_generated_at: record.generatedAt,
        repo_graph_repo_path: record.repoPath,
      },
      current_goal: record.blackboard.currentGoal,
      findings: [...record.blackboard.findings],
      open_questions: [...record.blackboard.openQuestions],
      suggestions: [],
      what_matters_now: ['Use repo graph queries before broad whole-repo guessing.'],
      next_options: [...record.blackboard.nextOptions],
      next_move: record.blackboard.nextOptions[0] || 'Inspect the most relevant files for the current task.',
      updated_at: record.generatedAt,
    },
    summary: [
      `Repo graph prepared for ${record.parsedFiles.length} parsed files.`,
      `KnowGraph nodes: ${record.knowGraph.nodes.length}.`,
      `KnowGraph edges: ${record.knowGraph.edges.length}.`,
      `ThinkGraph notes: ${record.thinkGraph.notes.length}.`,
    ].join(' '),
  };
}
