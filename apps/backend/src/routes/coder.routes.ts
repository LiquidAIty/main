import { Router } from 'express';
import type { OpenClaudeRunRequest } from '../coder/openclaude/contracts';
import { openClaudeRuntimeService } from '../coder/openclaude/runtime/service';

const router = Router();

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

router.post('/openclaude/run', async (req, res) => {
  const body = (req.body || {}) as Partial<OpenClaudeRunRequest>;
  const request: OpenClaudeRunRequest = {
    task: String(body.task || ''),
    mode: body.mode,
    access: body.access,
    systemPrompt: typeof body.systemPrompt === 'string' ? body.systemPrompt : undefined,
    modelKey: typeof body.modelKey === 'string' ? body.modelKey : undefined,
    provider: body.provider,
    providerModelId: typeof body.providerModelId === 'string' ? body.providerModelId : undefined,
    temperature: typeof body.temperature === 'number' ? body.temperature : undefined,
    maxTokens: typeof body.maxTokens === 'number' ? body.maxTokens : undefined,
    terminalSteering:
      typeof body.terminalSteering === 'boolean' ? body.terminalSteering : undefined,
  };

  const result = await openClaudeRuntimeService.run(request);
  const statusCode = result.ok ? 200 : 400;
  return res.status(statusCode).json({ ok: result.ok, result });
});

export default router;
