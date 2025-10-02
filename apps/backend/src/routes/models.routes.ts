/**
 * Models API Routes
 * Proxy routes to the Python model training service
 */

import express, { Request } from 'express';
import fetch from 'node-fetch';
import { z } from 'zod';

// Extend Express Request type to include userId
interface AuthenticatedRequest extends Request {
  userId?: string;
}

const router = express.Router();

// Validation schema for train request
const TrainRequestSchema = z.object({
  code: z.string(),
  contextPath: z.string().optional(),
  language: z.enum(['javascript', 'typescript', 'python']).optional().default('javascript'),
  dataset: z.record(z.any()).optional(),
  knowledgeGraph: z.object({
    triples: z.array(z.any())
  }).optional()
});

/**
 * Start a model training job
 * POST /api/models/train
 */
router.post('/train', async (req: AuthenticatedRequest, res) => {
  try {
    // Validate request body
    const validatedBody = TrainRequestSchema.parse(req.body);
    
    // Add metadata
    const enrichedBody = {
      ...validatedBody,
      userId: req.userId || 'anonymous',
      timestamp: new Date().toISOString()
    };
    
    // Forward to Python service
    const response = await fetch('http://python-models:8001/train', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(enrichedBody)
    });
    
    if (!response.ok) {
      throw new Error(`Python service returned ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Error in /models/train:', error);
    res.status(500).json({
      error: 'Failed to start training job',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Get training job status
 * GET /api/models/status/:jobId
 */
router.get('/status/:jobId', async (req, res) => {
  try {
    const jobId = req.params.jobId;
    
    // Forward to Python service
    const response = await fetch(`http://python-models:8001/status/${jobId}`);
    
    if (!response.ok) {
      throw new Error(`Python service returned ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error(`Error in /models/status/${req.params.jobId}:`, error);
    res.status(500).json({
      error: 'Failed to get job status',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
