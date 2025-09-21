/**
 * SOL API Controller
 * Handles API endpoints for LangGraph agent orchestration
 */

import express from 'express';
import { z } from 'zod';
import { plannerNode } from '../../orchestrator/planner.node.js';
import { runnerNode } from '../../orchestrator/runner.node.js';

// Create router
const router = express.Router();

// Request schema
const RunRequestSchema = z.object({
  goal: z.string().min(1),
  context: z.object({
    background: z.string().optional(),
    urls: z.array(z.string()).optional()
  }).optional()
});

// Last run trace for /why endpoint
let lastRunTrace: any = null;

/**
 * Run the agent
 * POST /api/sol/run
 */
router.post('/run', async (req, res) => {
  try {
    // Validate request body
    const { goal, context } = RunRequestSchema.parse(req.body);
    
    console.log(`Running agent with goal: ${goal}`);
    
    // Generate plan using planner node
    const { plan } = await plannerNode({ goal });
    
    // Execute plan using runner node
    const { results } = await runnerNode({ plan });
    
    // Store trace for /why endpoint
    lastRunTrace = {
      goal,
      context,
      plan,
      results,
      timestamp: new Date().toISOString()
    };
    
    // Format response
    let responseText = '';
    
    if (plan.steps.length > 0 && results) {
      // Get the last step's result as the final response
      const lastStepId = plan.steps[plan.steps.length - 1].id;
      const lastResult = results[lastStepId];
      
      if (lastResult && lastResult.text) {
        responseText = lastResult.text;
      } else {
        responseText = `I've completed the task "${goal}" but don't have a specific response to show.`;
      }
    } else {
      responseText = `I've analyzed your goal "${goal}" but couldn't generate a specific plan.`;
    }
    
    res.json({ text: responseText });
  } catch (error) {
    console.error('Error running agent:', error);
    
    if (error instanceof z.ZodError) {
      res.status(400).json({ 
        error: 'Invalid request parameters',
        details: error.errors
      });
    } else {
      res.status(500).json({ 
        error: 'Failed to run agent',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
});

/**
 * Get the last run trace
 * GET /api/sol/why
 */
router.get('/why', (req, res) => {
  if (lastRunTrace) {
    res.json(lastRunTrace);
  } else {
    res.status(404).json({ error: 'No agent runs found' });
  }
});

export default router;
