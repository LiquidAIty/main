import { Router } from 'express';
import {
  createProject,
  getAgentConfig,
  getProjectState,
  listAgentCards,
  saveAgentConfig,
  saveProjectState,
} from '../services/agentBuilderStore';
import { runCypherOnGraph } from '../services/graphService';
import { runLLM } from '../llm/client';

const router = Router();
const GRAPH_NAME = 'graph_liq';

router.get('/', async (_req, res) => {
  try {
    const projects = await listAgentCards();
    return res.json(projects);
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || 'failed to list projects' });
  }
});

router.post('/', async (req, res) => {
  const { name, code } = req.body || {};
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ ok: false, error: 'name is required' });
  }
  try {
    const project = await createProject(name, typeof code === 'string' ? code : null);
    return res.json(project);
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || 'failed to create project' });
  }
});

router.get('/:projectId/state', async (req, res) => {
  try {
    const state = await getProjectState(req.params.projectId);
    return res.json(state);
  } catch (err: any) {
    const status = (err?.message || '').includes('not found') ? 404 : 500;
    return res.status(status).json({ ok: false, error: err?.message || 'failed to load state' });
  }
});

router.put('/:projectId/state', async (req, res) => {
  try {
    const state = await saveProjectState(req.params.projectId, req.body || {});
    return res.json(state);
  } catch (err: any) {
    const status = (err?.message || '').includes('not found') ? 404 : 500;
    return res.status(status).json({ ok: false, error: err?.message || 'failed to save state' });
  }
});

router.post('/:projectId/kg/query', async (req, res) => {
  const { cypher, params } = req.body || {};
  if (!cypher || typeof cypher !== 'string') {
    return res.status(400).json({ ok: false, error: 'cypher is required' });
  }
  if (!/project_id/i.test(cypher)) {
    return res.status(400).json({ ok: false, error: 'cypher must filter by project_id' });
  }
  try {
    const rows = await runCypherOnGraph(GRAPH_NAME, cypher, params);
    return res.json({ ok: true, rows });
  } catch (err: any) {
    const status = (err?.message || '').toLowerCase().includes('age') ? 503 : 500;
    return res.status(status).json({ ok: false, error: err?.message || 'graph query failed' });
  }
});

router.post('/:projectId/kg/extract', async (req, res) => {
  const { text, source } = req.body || {};
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ ok: false, error: 'text is required' });
  }
  const system = 'Extract entities and relations from the text. Return JSON with entities and relations. entities: [{tempId,type,name,attrs,confidence}], relations: [{fromTempId,toTempId,type,attrs,confidence}], provenance: {method:"llm_extract"}';
  try {
    const { text: llmText, model } = await runLLM(
      `${text}\n\nReturn STRICT JSON ONLY with shape {"entities":[{"type":"", "name":"", "confidence":0.0}],"relations":[{"from":{"type":"","name":""},"to":{"type":"","name":""},"type":"","confidence":0.0}],"provenance":{"method":"llm_extract"}}`,
      { modelKey: 'gpt-5-mini', system }
    );
    let parsed: any = null;
    try {
      parsed = JSON.parse(llmText);
    } catch {
      // fallback: try to extract JSON substring
      const match = llmText.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          parsed = JSON.parse(match[0]);
        } catch {
          parsed = null;
        }
      }
    }
    if (!parsed || typeof parsed !== 'object') {
      return res.status(502).json({ ok: false, error: 'LLM parse failed', raw: llmText ?? '' });
    }
    const now = new Date().toISOString();
    return res.json({
      ok: true,
      preview: {
        entities: Array.isArray((parsed as any).entities) ? (parsed as any).entities : [],
        relations: Array.isArray((parsed as any).relations) ? (parsed as any).relations : [],
        provenance: {
          ...(typeof (parsed as any).provenance === 'object' ? (parsed as any).provenance : {}),
          method: 'llm_extract',
          model,
          createdAt: now,
          source: source && typeof source === 'object' ? source : undefined,
        },
      },
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || 'extract failed' });
  }
});

router.post('/:projectId/kg/commit', async (req, res) => {
  const { entities, relations, provenance } = req.body || {};
  if (!Array.isArray(entities) || !Array.isArray(relations)) {
    return res.status(400).json({ ok: false, error: 'entities and relations arrays required' });
  }
  const projectId = req.params.projectId;
  let entitiesUpserted = 0;
  let relationsUpserted = 0;
  try {
    await runCypherOnGraph(GRAPH_NAME, 'MATCH (n) RETURN 1 LIMIT 1'); // ensure graph exists
    for (const e of entities) {
      if (!e || typeof e !== 'object') continue;
      const type = (e as any).type || 'Unknown';
      const name = (e as any).name || '';
      if (!name) continue;
      const attrs = (e as any).attrs || {};
      const confidence = Number((e as any).confidence ?? 0.5);
      await runCypherOnGraph(
        GRAPH_NAME,
        `
          MERGE (n:Entity { project_id: $projectId, etype: $etype, name: $name })
          ON CREATE SET n.attrs = $attrs, n.confidence = $confidence, n.created_at = datetime(), n.source = $source
          ON MATCH SET n.attrs = coalesce(n.attrs, {}) + $attrs
          RETURN n
        `,
        {
          projectId,
          etype: type,
          name,
          attrs,
          confidence,
          source: provenance || null,
        },
      );
      entitiesUpserted += 1;
    }
    for (const r of relations) {
      if (!r || typeof r !== 'object') continue;
      const from = (r as any).from || (r as any).fromName || {};
      const to = (r as any).to || (r as any).toName || {};
      const fromName = (from as any).name || '';
      const toName = (to as any).name || '';
      const fromType = (from as any).type || 'Unknown';
      const toType = (to as any).type || 'Unknown';
      const relTypeProp = (r as any).type || 'REL';
      if (!fromName || !toName) continue;
      const attrs = (r as any).attrs || {};
      const confidence = Number((r as any).confidence ?? 0.5);
      const cypher = `
        MATCH (a:Entity { project_id: $projectId, etype: $fromType, name: $fromName })
        MATCH (b:Entity { project_id: $projectId, etype: $toType, name: $toName })
        MERGE (a)-[r:REL { project_id: $projectId, rtype: $rtype }]->(b)
        ON CREATE SET r.attrs = $attrs, r.confidence = $confidence, r.created_at = datetime(), r.source = $source
        ON MATCH SET r.attrs = coalesce(r.attrs, {}) + $attrs
        RETURN r
      `;
      await runCypherOnGraph(GRAPH_NAME, cypher, {
        projectId,
        fromType,
        fromName,
        toType,
        toName,
        attrs,
        confidence,
        rtype: relTypeProp,
        source: provenance || null,
      });
      relationsUpserted += 1;
    }
    return res.json({ ok: true, entities_upserted: entitiesUpserted, relations_upserted: relationsUpserted });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || 'commit failed' });
  }
});

router.get('/:projectId/agent', async (req, res) => {
  try {
    const cfg = await getAgentConfig(req.params.projectId);
    return res.json(cfg);
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || 'failed to load agent config' });
  }
});

router.put('/:projectId/agent', async (req, res) => {
  try {
    const saved = await saveAgentConfig({ ...(req.body || {}), id: req.params.projectId });
    return res.json(saved);
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || 'failed to save agent config' });
  }
});

export default router;
