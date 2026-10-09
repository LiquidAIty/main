import { Router, type Request } from 'express';
import { getOwnedProjectByReference } from '../services/projectStore';
import { requestPythonRailsJson } from '../services/pythonRailsClient';
import { objectRecord } from '../services/savedCardAuthority';

const cardRunReadRoutes = Router();
function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function elapsedMilliseconds(run: Record<string, any>): number | null {
  const start = Date.parse(String(run.startedAt || ''));
  const end = Date.parse(String(run.finishedAt || ''));
  if (!Number.isFinite(start)) return null;
  return Math.max(0, (Number.isFinite(end) ? end : Date.now()) - start);
}
function runMetricsProjection(run: Record<string, any> | undefined) {
  if (!run) return null;
  const costUsd = finiteNumber(run.costUsd);
  const providerCostStatus = String(run.costStatus || '').trim();
  const costStatus = ['actual', 'estimated', 'included'].includes(providerCostStatus)
    ? providerCostStatus
    : 'unavailable';
  return {
    state: String(run.state || ''),
    startedAt: typeof run.startedAt === 'string' ? run.startedAt : null,
    model: typeof run.model === 'string' ? run.model : null,
    elapsedMs: elapsedMilliseconds(run),
    inputTokens: finiteNumber(run.inputTokens),
    outputTokens: finiteNumber(run.outputTokens),
    cachedTokens: finiteNumber(run.cachedTokens),
    reasoningTokens: finiteNumber(run.reasoningTokens),
    totalTokens: finiteNumber(run.providerTotalTokens),
    costUsd,
    costStatus,
    toolCallCount: finiteNumber(run.toolCallCount),
    autoToolsDecision: objectRecord(run.autoToolsDecision),
    autoModelDecision: objectRecord(run.autoModelDecision),
  };
}
function magneticTaskMetrics(value: Record<string, any>): {
  tasksCompleted: number | null;
  tasksTotal: number | null;
  activeWorkers: number | null;
} {
  if (!Array.isArray(value.hermesTasks)) {
    return { tasksCompleted: null, tasksTotal: null, activeWorkers: null };
  }
  const rootId = String(value.hermesRootId || '').trim();
  const tasks = value.hermesTasks.map(objectRecord);
  return {
    tasksCompleted: tasks.filter((task) => String(task.status || '').trim() === 'done').length,
    tasksTotal: tasks.length,
    activeWorkers: tasks.filter((task) => (
      String(task.taskId || '').trim() !== rootId
      && String(task.status || '').trim() === 'running'
    )).length,
  };
}
export async function authorizeCardProject(req: Request, projectId: string): Promise<boolean> {
  const userId = String((req as Request & { userId?: string }).userId || '').trim();
  if (!userId) return false;
  const project = await getOwnedProjectByReference(projectId, userId);
  return Boolean(project && project.ownerUserId === userId);
}

cardRunReadRoutes.post('/runs/read', async (req, res) => {
  const action = String(req.body?.action || '').trim();
  const projectId = String(req.body?.projectId || '').trim();
  const deckId = String(req.body?.deckId || '').trim();
  const cardId = String(req.body?.cardId || '').trim();
  if (!projectId || !deckId || !cardId) {
    return res.status(400).json({ ok: false, error: 'card_run_identity_incomplete' });
  }
  if (!['history', 'status'].includes(action)) {
    return res.status(400).json({ ok: false, error: 'card_run_read_action_required' });
  }
  if (action === 'status' && req.body?.inspectOnly !== true) {
    return res.status(400).json({ ok: false, error: 'card_run_status_must_be_inspect_only' });
  }
  try {
    if (!(await authorizeCardProject(req, projectId))) {
      return res.status(403).json({ ok: false, error: 'card_run_project_access_denied' });
    }
    const rawLimit = action === 'history' ? Number(req.body?.limit || 1) : 1;
    const limit = Number.isSafeInteger(rawLimit) ? Math.max(1, Math.min(20, rawLimit)) : 1;
    const history = objectRecord(await requestPythonRailsJson('/domain/runs/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, deckId, cardId, limit }),
    }));
    const runs = Array.isArray(history.runs) ? history.runs.map(objectRecord) : [];
    const latest = runs[0];
    if (action === 'history') {
      return res.json({
        ok: true,
        result: { cardId, latest: runMetricsProjection(latest) },
      });
    }
    if (!latest) return res.json({ ok: true, result: null });
    const hermesRootId = String(latest.hermesRootId || '').trim();
    if (String(latest.runtimeMode || '') === 'magentic_one' && hermesRootId) {
      const magnetic = objectRecord(await requestPythonRailsJson('/magnetic/taskgraph/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hermesRootId }),
      }));
      const metrics = magneticTaskMetrics(magnetic);
      return res.json({
        ok: true,
        result: {
          ...magnetic,
          runId: String(latest.runId || ''),
          cardId,
          state: String(latest.state || ''),
          hermesExecutionState: String(magnetic.state || ''),
          activeWorkers: metrics.activeWorkers,
        },
      });
    }
    return res.json({
      ok: true,
      result: {
        cardId,
        runId: String(latest.runId || ''),
        state: String(latest.state || ''),
        activeWorkers: finiteNumber(latest.activeWorkers),
      },
    });
  } catch (error) {
    return res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : 'card_run_read_failed',
    });
  }
});

export default cardRunReadRoutes;
