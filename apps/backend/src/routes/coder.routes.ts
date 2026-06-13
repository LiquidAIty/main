import { Router } from 'express';
import { ZodError } from 'zod';
import type { OpenClaudeRunRequest } from '../coder/openclaude/contracts';
import { openClaudeRuntimeService } from '../coder/openclaude/runtime/service';
import { localCoderService } from '../coder/localcoder/service';
import {
  persistCoderRunOutcome,
  prepareActiveCoderPacket,
} from '../services/coderPlanning/coderPlanningService';

const router = Router();
export const OPENCLAUDE_HARNESS_ROUTE_PREFIX = '/coder/openclaude';

router.get('/openclaude/status', (req, res) => {
  const status = openClaudeRuntimeService.getStatus({
    mode: typeof req.query.mode === 'string' ? (req.query.mode as OpenClaudeRunRequest['mode']) : undefined,
    access: typeof req.query.access === 'string' ? (req.query.access as OpenClaudeRunRequest['access']) : undefined,
    modelKey: typeof req.query.modelKey === 'string' ? req.query.modelKey : undefined,
    provider: typeof req.query.provider === 'string' ? (req.query.provider as OpenClaudeRunRequest['provider']) : undefined,
    providerModelId:
      typeof req.query.providerModelId === 'string' ? req.query.providerModelId : undefined,
  });
  return res.json({ ok: true, status });
});

router.get('/openclaude/terminal/launch', (req, res) => {
  const launch = openClaudeRuntimeService.getTerminalLaunch({
    mode: 'terminal',
    modelKey: typeof req.query.modelKey === 'string' ? req.query.modelKey : undefined,
    provider: typeof req.query.provider === 'string' ? (req.query.provider as OpenClaudeRunRequest['provider']) : undefined,
    providerModelId:
      typeof req.query.providerModelId === 'string' ? req.query.providerModelId : undefined,
  });
  const statusCode = launch.ok ? 200 : 400;
  return res.status(statusCode).json({ ok: launch.ok, launch });
});

router.post('/openclaude/run', async (req, res) => {
  return res.status(410).json({
    ok: false,
    error: 'openclaude_plain_task_run_removed_use_localcoder_run',
  });
});

router.get('/localcoder/status', async (req, res) => {
  const repoPath = typeof req.query.repoPath === 'string' ? req.query.repoPath : undefined;
  const inspection = await localCoderService.inspect(repoPath);
  return res.status(inspection.ready ? 200 : 424).json({
    ok: inspection.ready,
    inspection,
  });
});

router.post('/planflow/prepare', async (req, res) => {
  try {
    const result = await prepareActiveCoderPacket({
      projectId: String(req.body?.projectId || ''),
      userInput: String(req.body?.userInput || ''),
      repoPath: typeof req.body?.repoPath === 'string' ? req.body.repoPath : null,
      planFlowState:
        req.body?.planFlowState && typeof req.body.planFlowState === 'object'
          ? req.body.planFlowState
          : {},
      selectedContext:
        req.body?.selectedContext && typeof req.body.selectedContext === 'object'
          ? req.body.selectedContext
          : {},
    });
    return res.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(400).json({
        ok: false,
        error: 'invalid_context_or_coder_packet',
        issues: error.issues,
      });
    }
    const message = error instanceof Error ? error.message : 'active_coder_packet_prepare_failed';
    const blocked =
      message.startsWith('coder_planner_') ||
      message.startsWith('context_packet_') ||
      message.startsWith('thinkgraph_');
    return res.status(blocked ? 424 : 500).json({ ok: false, error: message });
  }
});

router.post('/localcoder/run', async (req, res) => {
  try {
    const result = await localCoderService.run(req.body?.coderPacket ?? req.body);
    let thinkGraphPersistence: { ok: boolean; error?: string } = { ok: true };
    try {
      await persistCoderRunOutcome(result);
    } catch (error) {
      thinkGraphPersistence = {
        ok: false,
        error: error instanceof Error ? error.message : 'thinkgraph_coder_report_write_failed',
      };
    }
    const reportOk = result.report.status === 'succeeded' || result.report.status === 'partial';
    const statusCode = !thinkGraphPersistence.ok
      ? 500
      :
      result.report.status === 'blocked'
        ? 424
        : result.report.status === 'failed'
          ? 502
          : 200;
    return res.status(statusCode).json({
      ok: reportOk && thinkGraphPersistence.ok,
      ...result,
      thinkGraphPersistence,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(400).json({
        ok: false,
        error: 'invalid_coder_packet',
        issues: error.issues,
      });
    }
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'localcoder_run_failed',
    });
  }
});

export default router;
