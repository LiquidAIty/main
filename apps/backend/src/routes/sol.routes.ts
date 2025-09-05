import { Router } from 'express';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { z } from 'zod';
import { solRun } from '../agents/orchestrator/sol';
import { createDeptAgent } from '../agents/lang/agentFactory';

const router = Router();

// Request schema validation
const RequestSchema = z.object({
  goal: z.string().min(1, "goal is required"),
  agentMode: z.enum(['orchestrator', 'specialized', 'simple']).default('orchestrator'),
  agentType: z.enum(['code', 'marketing', 'research']).optional(),
});

// POST /api/sol/run - Enhanced with agent orchestration
router.post('/run', async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
  try {
    // Validate request body
    const parsed = RequestSchema.parse(req.body);
    const { goal, agentMode, agentType } = parsed;
    
    // Normalize payload
    const normalized = {
      goal,
      agentMode,
      agentType: agentMode === 'orchestrator' ? 'code' : agentType
    };
    
    console.log('[SOL] payload', normalized);
    
    let text: string;
    let decision: string;

    if (agentMode === 'orchestrator') {
      // Use orchestrator agent
      const orchestrator = createDeptAgent({
        id: 'sol-orchestrator',
        name: 'SOL Orchestrator',
        defaultPersona: `You are the main AI orchestrator. Analyze the user's request and provide a helpful response.`,
        matchKeywords: ['orchestrate', 'manage', 'plan', 'coordinate']
      });

      const result = await orchestrator.run({
        prompt: goal,
        role: 'orchestrator',
        threadId: `orchestrator-${Date.now()}`
      });

      text = result.output || 'No response from orchestrator';
      decision = 'orchestrator';

    } else if (agentMode === 'specialized') {
      if (!agentType) {
        res.status(400).json({
          error: 'BadRequest',
          details: [{ message: 'agentType is required when agentMode is specialized' }]
        });
        return;
      }

      // Use specialized agent based on type
      let agent;
      switch (agentType) {
        case 'code':
          agent = createDeptAgent({
            id: 'code-agent',
            name: 'Code Agent',
            defaultPersona: 'You are a coding specialist. Provide precise, well-commented code solutions.',
            matchKeywords: ['code', 'programming', 'debug', 'function', 'typescript', 'javascript']
          });
          break;
        case 'marketing':
          agent = createDeptAgent({
            id: 'marketing-agent',
            name: 'Marketing Agent',
            defaultPersona: 'You are a marketing specialist. Create compelling, targeted marketing content.',
            matchKeywords: ['marketing', 'content', 'campaign', 'copy', 'brand']
          });
          break;
        case 'research':
          agent = createDeptAgent({
            id: 'research-agent',
            name: 'Research Agent',
            defaultPersona: 'You are a research specialist. Provide thorough, well-sourced analysis.',
            matchKeywords: ['research', 'analysis', 'investigate', 'data', 'study']
          });
          break;
        default:
          res.status(400).json({
            error: 'BadRequest',
            details: [{ message: 'Invalid agentType. Use: code, marketing, or research' }]
          });
          return;
      }

      const result = await agent.run({
        prompt: goal,
        role: 'worker',
        threadId: `${agentType}-${Date.now()}`
      });

      text = result.output || `No response from ${agentType} agent`;
      decision = `${agentType}-specialist`;

    } else {
      // Default simple mode
      const result = await solRun({ question: goal });
      text = result.text || 'No response';
      decision = result.decision || 'simple';
    }

    res.json({ ok: true, text, decision });

  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: 'BadRequest',
        details: error.errors.map(e => ({ message: e.message }))
      });
      return;
    }
    
    console.error('[SOL] error:', error);
    res.status(502).json({
      error: 'UpstreamError',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
