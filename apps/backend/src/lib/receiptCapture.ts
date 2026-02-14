// ============================================================================
// receiptCapture.ts
// Capture and store LLM probability receipts
// ============================================================================

import { pool } from '../db/pool';
import { parseProbabilityReceipt, type ProbabilityReceipt } from './receiptParser';
import { v4 as uuidv4 } from 'uuid';

export interface CaptureReceiptParams {
  projectId: string;
  outputText: string;
}

/**
 * Capture probability from LLM output and store in database
 * Non-blocking: logs errors but doesn't throw
 */
export async function captureProbability(params: CaptureReceiptParams): Promise<{ runId: string; receipt: ProbabilityReceipt }> {
  const { projectId, outputText } = params;
  
  // Parse probability from output
  const receipt = parseProbabilityReceipt(outputText);
  
  // Generate run_id
  const runId = uuidv4();
  
  try {
    // Insert probability row
    await pool.query(
      `INSERT INTO ag_catalog.llm_probability 
       (run_id, project_id, predicted_probability, raw_line)
       VALUES ($1, $2, $3, $4)`,
      [
        runId,
        projectId,
        receipt.predicted_probability,
        receipt.raw_line
      ]
    );
    
    console.log('[probabilityCapture] Stored:', {
      runId,
      projectId,
      predicted_probability: receipt.predicted_probability
    });
    
    return { runId, receipt };
  } catch (err: any) {
    console.error('[probabilityCapture] Failed to store:', err);
    // Don't throw - fail soft so chat continues
    return { runId, receipt };
  }
}

