import { Router } from 'express';
import {
  listProjectAgents,
  getProjectAgent,
  createProjectAgent,
  updateProjectAgent,
  deleteProjectAgent,
  ensureDefaultAgents,
  type CreateAgentInput,
  type UpdateAgentInput,
} from '../services/projectAgentsStore';
import { runIngestPipeline } from './projects.routes';
import { runCypherOnGraph } from '../services/graphService';

const router = Router();
const GRAPH_NAME = 'graph_liq';

// ============================================================================
// Phase 1: Multi-Agent CRUD APIs
// ============================================================================

/**
 * Ensure default agents exist for a project
 * POST /api/projects/:projectId/agents/ensure-defaults
 */
router.post('/:projectId/agents/ensure-defaults', async (req, res) => {
  try {
    const agents = await ensureDefaultAgents(req.params.projectId);
    return res.json({ ok: true, agents });
  } catch (err: any) {
    console.error('[AGENTS] ensure-defaults failed', err);
    return res.status(500).json({ ok: false, error: err?.message || 'Failed to ensure default agents' });
  }
});

/**
 * List all agents for a project
 * GET /api/projects/:projectId/agents
 */
router.get('/:projectId/agents', async (req, res) => {
  try {
    const agents = await listProjectAgents(req.params.projectId);
    return res.json({ ok: true, agents });
  } catch (err: any) {
    console.error('[AGENTS] list failed', err);
    return res.status(500).json({ ok: false, error: err?.message || 'Failed to list agents' });
  }
});

/**
 * Get a specific agent
 * GET /api/projects/:projectId/agents/:agentId
 */
router.get('/:projectId/agents/:agentId', async (req, res) => {
  try {
    const agent = await getProjectAgent(req.params.agentId);
    if (!agent) {
      return res.status(404).json({ ok: false, error: 'Agent not found' });
    }
    return res.json({ ok: true, agent });
  } catch (err: any) {
    console.error('[AGENTS] get failed', err);
    return res.status(500).json({ ok: false, error: err?.message || 'Failed to get agent' });
  }
});

/**
 * Create a new agent
 * POST /api/projects/:projectId/agents
 */
router.post('/:projectId/agents', async (req, res) => {
  try {
    console.log('[AGENTS] create request:', {
      projectId: req.params.projectId,
      body: req.body,
    });

    const input: CreateAgentInput = {
      project_id: req.params.projectId,
      name: req.body.name,
      agent_type: req.body.agent_type,
      model: req.body.model,
      prompt_template: req.body.prompt_template,
      tools: req.body.tools,
      io_schema: req.body.io_schema,
      permissions: req.body.permissions,
      temperature: req.body.temperature,
      max_tokens: req.body.max_tokens,
      role_text: req.body.role_text,
      goal_text: req.body.goal_text,
      constraints_text: req.body.constraints_text,
      io_schema_text: req.body.io_schema_text,
      memory_policy_text: req.body.memory_policy_text,
    };

    if (!input.name || !input.agent_type) {
      console.error('[AGENTS] validation failed:', { name: input.name, agent_type: input.agent_type });
      return res.status(400).json({ ok: false, error: 'name and agent_type are required' });
    }

    console.log('[AGENTS] calling createProjectAgent...');
    const agent = await createProjectAgent(input);
    console.log('[AGENTS] agent created:', agent.agent_id);
    return res.status(200).json({ ok: true, agent });
  } catch (err: any) {
    console.error('[AGENTS] create failed:', {
      message: err?.message,
      code: err?.code,
      detail: err?.detail,
      stack: err?.stack,
    });
    
    return res.status(500).json({ 
      ok: false, 
      error: err?.message || 'Failed to create agent',
      code: err?.code,
      detail: err?.detail,
    });
  }
});

/**
 * Update an existing agent
 * PUT /api/projects/:projectId/agents/:agentId
 */
router.put('/:projectId/agents/:agentId', async (req, res) => {
  try {
    const input: UpdateAgentInput = {
      agent_id: req.params.agentId,
      name: req.body.name,
      agent_type: req.body.agent_type,
      model: req.body.model,
      prompt_template: req.body.prompt_template,
      tools: req.body.tools,
      io_schema: req.body.io_schema,
      permissions: req.body.permissions,
      temperature: req.body.temperature,
      max_tokens: req.body.max_tokens,
      role_text: req.body.role_text,
      goal_text: req.body.goal_text,
      constraints_text: req.body.constraints_text,
      io_schema_text: req.body.io_schema_text,
      memory_policy_text: req.body.memory_policy_text,
    };

    const agent = await updateProjectAgent(input);
    return res.json({ ok: true, agent });
  } catch (err: any) {
    console.error('[AGENTS] update failed', err);
    return res.status(500).json({ ok: false, error: err?.message || 'Failed to update agent' });
  }
});

/**
 * Delete an agent
 * DELETE /api/projects/:projectId/agents/:agentId
 */
router.delete('/:projectId/agents/:agentId', async (req, res) => {
  try {
    await deleteProjectAgent(req.params.agentId);
    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[AGENTS] delete failed', err);
    return res.status(500).json({ ok: false, error: err?.message || 'Failed to delete agent' });
  }
});

// ============================================================================
// Phase 2: Agent Runner (Test Harness)
// ============================================================================

/**
 * Run an agent with test input
 * POST /api/projects/:projectId/agents/:agentId/run
 */
router.post('/:projectId/agents/:agentId/run', async (req, res) => {
  const { projectId, agentId } = req.params;
  const { input } = req.body;

  if (!input || typeof input !== 'string') {
    return res.status(400).json({ ok: false, error: 'input (string) is required' });
  }

  try {
    // Load agent config
    const agent = await getProjectAgent(agentId);
    if (!agent) {
      return res.status(404).json({ ok: false, error: 'Agent not found' });
    }

    console.log('[AGENT_RUNNER] Running agent:', {
      agentId,
      name: agent.name,
      type: agent.agent_type,
      inputLength: input.length,
    });

    // Execute based on agent type
    let output: any = null;
    let side_effects: any = {};
    const errors: string[] = [];

    switch (agent.agent_type) {
      case 'kg_ingest': {
        // Knowledge Builder Agent: ingest text into KG
        // Uses OpenRouter models only (DeepSeek/Kimi/Phi) - enforced in runIngestPipeline
        try {
          const ingestResult = await runIngestPipeline({
            projectId,
            doc_id: `agent_run:${agentId}:${Date.now()}`,
            src: `agent.${agent.name}`,
            text: input,
            llm_model: agent.model || undefined, // OpenRouter model from agent config
            embed_model: undefined,
            options: {
              temperature: agent.temperature,
              max_tokens: agent.max_tokens,
            },
          });

          output = {
            message: 'Knowledge ingestion completed',
            chunks_written: ingestResult.chunks_written,
            embeddings_written: ingestResult.embeddings_written,
            entities_upserted: ingestResult.entities_upserted,
            relations_upserted: ingestResult.relations_upserted,
          };

          side_effects = {
            kg_writes: {
              chunks: ingestResult.chunks_written,
              embeddings: ingestResult.embeddings_written,
              entities: ingestResult.entities_upserted,
              relations: ingestResult.relations_upserted,
            },
            errors: ingestResult.errors || [],
          };

          if (ingestResult.errors && ingestResult.errors.length > 0) {
            errors.push(...ingestResult.errors.map((e: any) => e.error || String(e)));
          }
        } catch (err: any) {
          errors.push(err?.message || 'KG ingest failed');
          output = { error: err?.message || 'KG ingest failed' };
        }
        break;
      }

      case 'kg_read': {
        // Knowledge Reader Agent: query KG and return context packet
        try {
          // Build query based on input
          // For MVP: simple entity search by name pattern
          const searchTerm = input.trim();
          const cypher = `
            MATCH (n:Entity { project_id: $projectId })
            WHERE n.name CONTAINS $searchTerm OR n.etype CONTAINS $searchTerm
            OPTIONAL MATCH (n)-[r:REL]-(m:Entity { project_id: $projectId })
            RETURN n, r, m
            LIMIT 50
          `;

          const rows = await runCypherOnGraph(GRAPH_NAME, cypher, {
            projectId,
            searchTerm,
          });

          // Transform to context packet
          const entities = new Map<string, any>();
          const relations: any[] = [];

          rows.forEach((row: any) => {
            if (row.n) {
              const nProps = row.n.properties || {};
              const nKey = `${nProps.etype}:${nProps.name}`;
              if (!entities.has(nKey)) {
                entities.set(nKey, {
                  type: nProps.etype,
                  name: nProps.name,
                  attrs: nProps.attrs || {},
                  confidence: nProps.confidence || 0.5,
                });
              }
            }

            if (row.m) {
              const mProps = row.m.properties || {};
              const mKey = `${mProps.etype}:${mProps.name}`;
              if (!entities.has(mKey)) {
                entities.set(mKey, {
                  type: mProps.etype,
                  name: mProps.name,
                  attrs: mProps.attrs || {},
                  confidence: mProps.confidence || 0.5,
                });
              }
            }

            if (row.r && row.n && row.m) {
              const rProps = row.r.properties || {};
              const nProps = row.n.properties || {};
              const mProps = row.m.properties || {};
              relations.push({
                type: rProps.rtype || 'REL',
                from: { type: nProps.etype, name: nProps.name },
                to: { type: mProps.etype, name: mProps.name },
                attrs: rProps.attrs || {},
                confidence: rProps.confidence || 0.5,
              });
            }
          });

          output = {
            context_packet: {
              query: searchTerm,
              entities: Array.from(entities.values()),
              relations,
              metadata: {
                entity_count: entities.size,
                relation_count: relations.length,
                source: 'kg_read_agent',
                timestamp: new Date().toISOString(),
              },
            },
          };

          side_effects = {
            kg_reads: {
              entities_found: entities.size,
              relations_found: relations.length,
            },
          };
        } catch (err: any) {
          errors.push(err?.message || 'KG read failed');
          output = { error: err?.message || 'KG read failed' };
        }
        break;
      }

      case 'llm_chat': {
        // LLM Chat Agent: placeholder for future implementation
        output = {
          message: 'LLM chat agent not yet implemented',
          note: 'This will call the LangGraph agent0 flow in Phase 3',
        };
        break;
      }

      default:
        return res.status(400).json({
          ok: false,
          error: `Unknown agent type: ${agent.agent_type}`,
        });
    }

    return res.json({
      ok: true,
      agent_id: agentId,
      agent_name: agent.name,
      agent_type: agent.agent_type,
      output,
      side_effects,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err: any) {
    console.error('[AGENT_RUNNER] execution failed', err);
    return res.status(500).json({
      ok: false,
      error: err?.message || 'Agent execution failed',
    });
  }
});

export default router;
