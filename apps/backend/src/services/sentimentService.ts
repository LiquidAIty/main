/**
 * Sentiment Analysis Service
 * Integrates with Hugging Face's sentiment analysis models
 */

import axios from 'axios';
import { z } from 'zod';

// Environment variables
const HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY;
const SENTIMENT_MODEL = process.env.SENTIMENT_MODEL || 'AventIQ-AI/sentiment-analysis-for-stock-market-sentiment';

// Sentiment result schema
export const SentimentResultSchema = z.object({
  label: z.string(),
  score: z.number(),
  text: z.string()
});

export type SentimentResult = z.infer<typeof SentimentResultSchema>;

/**
 * Fetch sentiment analysis from Hugging Face model
 * @param texts Array of texts to analyze
 * @returns Array of sentiment analysis results
 */
export async function fetchSentimentAnalysis(texts: string[]): Promise<SentimentResult[]> {
  if (!HUGGINGFACE_API_KEY) {
    console.warn('HUGGINGFACE_API_KEY not set. Using mock sentiment analysis.');
    return mockSentimentAnalysis(texts);
  }
  
  try {
    // Process texts in batches to avoid API limits
    const batchSize = 10;
    const results: SentimentResult[] = [];
    
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchResults = await processBatch(batch);
      results.push(...batchResults);
    }
    
    return results;
  } catch (error) {
    console.error('Error fetching sentiment analysis:', error);
    return mockSentimentAnalysis(texts);
  }
}

/**
 * Process a batch of texts for sentiment analysis
 */
async function processBatch(texts: string[]): Promise<SentimentResult[]> {
  const results: SentimentResult[] = [];
  
  for (const text of texts) {
    // Skip empty texts
    if (!text.trim()) {
      continue;
    }
    
    try {
      const response = await axios.post(
        `https://api-inference.huggingface.co/models/${SENTIMENT_MODEL}`,
        { inputs: text },
        {
          headers: {
            'Authorization': `Bearer ${HUGGINGFACE_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      // Process response based on model output format
      // This specific model returns an array of objects with label and score
      const data = response.data;
      
      if (Array.isArray(data) && data.length > 0) {
        // Find the highest scoring sentiment
        const highestSentiment = data.reduce((prev, current) => 
          (current.score > prev.score) ? current : prev
        );
        
        results.push({
          label: highestSentiment.label,
          score: normalizeScore(highestSentiment.label, highestSentiment.score),
          text
        });
      } else {
        throw new Error('Unexpected response format from sentiment model');
      }
    } catch (error) {
      console.error(`Error analyzing text: "${text.substring(0, 50)}..."`, error);
      
      // Add a neutral sentiment as fallback
      results.push({
        label: 'NEUTRAL',
        score: 0.5,
        text
      });
    }
    
    // Add a small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  
  return results;
}

/**
 * Normalize sentiment score to a -1 to 1 range
 * Where -1 is extremely negative, 0 is neutral, and 1 is extremely positive
 */
function normalizeScore(label: string, score: number): number {
  // This specific model uses labels like POSITIVE, NEGATIVE, NEUTRAL
  if (label === 'POSITIVE') {
    return score; // Already between 0 and 1
  } else if (label === 'NEGATIVE') {
    return -score; // Convert to negative range
  } else if (label === 'NEUTRAL') {
    return 0; // Neutral is 0
  } else if (label === 'BULLISH') {
    return score; // Bullish is positive
  } else if (label === 'BEARISH') {
    return -score; // Bearish is negative
  }
  
  // Default case
  return (score - 0.5) * 2; // Convert 0-1 range to -1 to 1 range
}

/**
 * Generate mock sentiment analysis for testing
 */
function mockSentimentAnalysis(texts: string[]): SentimentResult[] {
  return texts.map(text => {
    // Simple keyword-based mock sentiment
    const lowerText = text.toLowerCase();
    let score = 0.5; // Default neutral
    let label = 'NEUTRAL';
    
    // Positive keywords
    const positiveKeywords = ['increase', 'profit', 'growth', 'success', 'up', 'gain', 'bullish', 'positive'];
    const negativeKeywords = ['decrease', 'loss', 'decline', 'fail', 'down', 'bearish', 'negative'];
    
    // Count keyword matches
    const positiveCount = positiveKeywords.filter(keyword => lowerText.includes(keyword)).length;
    const negativeCount = negativeKeywords.filter(keyword => lowerText.includes(keyword)).length;
    
    if (positiveCount > negativeCount) {
      score = 0.5 + (positiveCount * 0.1);
      label = 'POSITIVE';
    } else if (negativeCount > positiveCount) {
      score = 0.5 - (negativeCount * 0.1);
      label = 'NEGATIVE';
    }
    
    // Ensure score is between 0 and 1
    score = Math.max(0, Math.min(1, score));
    
    return {
      label,
      score: normalizeScore(label, score),
      text
    };
  });
}

/**
 * Analyze sentiment of a single text
 */
export async function analyzeSentiment(text: string): Promise<SentimentResult> {
  const results = await fetchSentimentAnalysis([text]);
  return results[0];
}

/**
 * Calculate aggregate sentiment from multiple results
 */
export function calculateAggregateSentiment(results: SentimentResult[]): {
  average: number;
  positive: number;
  negative: number;
  neutral: number;
} {
  if (results.length === 0) {
    return {
      average: 0,
      positive: 0,
      negative: 0,
      neutral: 0
    };
  }
  
  let positiveCount = 0;
  let negativeCount = 0;
  let neutralCount = 0;
  
  const average = results.reduce((sum, result) => {
    if (result.score > 0.2) positiveCount++;
    else if (result.score < -0.2) negativeCount++;
    else neutralCount++;
    
    return sum + result.score;
  }, 0) / results.length;
  
  return {
    average,
    positive: positiveCount / results.length,
    negative: negativeCount / results.length,
    neutral: neutralCount / results.length
  };
}
