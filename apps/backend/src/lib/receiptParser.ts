// ============================================================================
// receiptParser.ts
// Parse and validate LLM probability lines (@p format)
// ============================================================================

export interface ProbabilityReceipt {
  predicted_probability: number;
  raw_line: string;
}

const DEFAULT_RECEIPT: ProbabilityReceipt = {
  predicted_probability: 0.50,
  raw_line: '@p=0.50'
};

/**
 * Parse probability from LLM output
 * Format: @p=0.72
 * Returns default if missing or invalid
 */
export function parseProbabilityReceipt(text: string): ProbabilityReceipt {
  if (!text || typeof text !== 'string') {
    return { ...DEFAULT_RECEIPT };
  }

  const lines = text.trim().split('\n');
  const lastLine = lines[lines.length - 1]?.trim();

  if (!lastLine || !lastLine.startsWith('@p=')) {
    return { ...DEFAULT_RECEIPT };
  }

  try {
    const match = lastLine.match(/@p=([-\d.]+)/);

    if (!match) {
      console.warn('[probabilityParser] Invalid @p format, using default');
      return { ...DEFAULT_RECEIPT, raw_line: lastLine };
    }

    let p = parseFloat(match[1]);

    // Clamp to valid range
    if (isNaN(p)) {
      p = 0.50;
    } else if (p < -0.10) {
      p = -0.10;
    } else if (p > 1.00) {
      p = 1.00;
    }

    return {
      predicted_probability: p,
      raw_line: lastLine
    };
  } catch (err) {
    console.error('[probabilityParser] Parse error:', err);
    return { ...DEFAULT_RECEIPT, raw_line: lastLine || '@p=0.50' };
  }
}

/**
 * Strip probability line from text (optional - for user-visible output)
 */
export function stripProbabilityReceipt(text: string): string {
  if (!text || typeof text !== 'string') return text;
  
  const lines = text.trim().split('\n');
  const lastLine = lines[lines.length - 1]?.trim();
  
  if (lastLine && lastLine.startsWith('@p=')) {
    return lines.slice(0, -1).join('\n').trim();
  }
  
  return text;
}

