import { Router } from 'express';
import { createProject } from '../services/agentBuilderStore';
import { requireDevTestMode } from '../services/devTest';
import { ensureSystemAgentConfigs } from '../services/agentConfigStore';
import { getRecentModelCallPackets } from '../debug/modelCallPackets';

const router = Router();

// Debug-only: return the recent Mag One model-call packets (what was actually sent to
// the model rails + a response summary). No secrets are captured. Disabled in prod.
router.get('/model-call-packets', (req, res) => {
  if ((process.env.NODE_ENV || 'development') === 'production') {
    return res.status(404).json({ ok: false, error: 'not_found' });
  }
  const projectId = req.query.projectId ? String(req.query.projectId) : null;
  const rawLimit = Number(req.query.limit);
  const limit = Number.isFinite(rawLimit) ? rawLimit : 10;
  const packets = getRecentModelCallPackets({ projectId, limit });
  return res.json({ ok: true, count: packets.length, packets });
});

router.post('/create_clean_test_project', async (req, res) => {
  try {
    requireDevTestMode();
    const rawName = String(req.body?.name || '').trim();
    const rawCode = String(req.body?.code || '').trim();
    const suffix = Date.now().toString(36);
    const name = rawName || `dual-graph-book-lab-${suffix}`;
    const code = rawCode || `dual-graph-book-lab-${suffix}`;

    const project = await createProject(name, code, 'assist');
    const configs = await ensureSystemAgentConfigs(project.id);

    console.log(
      '[DEV] created clean test project projectId=%s code=%s name=%s',
      project.id,
      project.code,
      project.name,
    );

    return res.status(201).json({
      ok: true,
      project,
      system_agents: {
        llm_chat: configs.llm_chat?.agent_id || null,
        kg_ingest: configs.kg_ingest?.agent_id || null,
        knowgraph: configs.knowgraph?.agent_id || null,
        neo4j: configs.neo4j?.agent_id || null,
        research_agent: configs.research_agent?.agent_id || null,
      },
    });
  } catch (err: any) {
    const message = err?.message || 'failed_to_create_clean_test_project';
    const status = message === 'dev_test_route_disabled' ? 403 : 500;
    return res.status(status).json({ ok: false, error: message });
  }
});

export default router;
