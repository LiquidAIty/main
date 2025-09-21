/**
 * Report Controller
 * Handles API endpoints for report generation
 */

import express from 'express';
import { z } from 'zod';
import { generateReport, ReportRequestSchema } from '../../services/reportGenerationService.js';

// Create router
const router = express.Router();

/**
 * Generate a report
 * POST /api/reports/generate
 */
router.post('/generate', async (req, res) => {
  try {
    // Validate request body
    const validatedRequest = ReportRequestSchema.parse(req.body);
    
    // Generate report
    const report = await generateReport(validatedRequest);
    
    res.json(report);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ 
        error: 'Invalid request parameters',
        details: error.errors
      });
    } else {
      console.error('Error generating report:', error);
      res.status(500).json({ error: 'Failed to generate report' });
    }
  }
});

/**
 * Get report by ID
 * GET /api/reports/:reportId
 * Note: In a real implementation, this would fetch from a database
 */
router.get('/:reportId', (req, res) => {
  // This is a placeholder - in a real implementation, we would fetch from a database
  res.status(404).json({ error: 'Report not found' });
});

/**
 * Get infographic for a report
 * GET /api/reports/:reportId/infographic
 */
router.get('/:reportId/infographic', (req, res) => {
  // This is a placeholder - in a real implementation, we would fetch from a database
  res.status(404).json({ error: 'Infographic not found' });
});

export default router;
