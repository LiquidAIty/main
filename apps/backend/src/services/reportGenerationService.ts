/**
 * Report Generation Service
 * Uses Gemini API to generate reports and infographics based on knowledge graph data
 */

import axios from 'axios';
import { z } from 'zod';
import { getStockData } from './marketDataService.js';
import { getNewsArticles, getSocialMediaMentions } from './mediaService.js';
import { calculateAggregateSentiment, fetchSentimentAnalysis } from './sentimentService.js';

// Environment variables
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-pro';
const GEMINI_VISION_MODEL = process.env.GEMINI_VISION_MODEL || 'gemini-2.5-pro-vision';

// Custom error class for report generation errors
export class ReportGenerationError extends Error {
  constructor(message: string, public override readonly cause?: unknown) {
    super(message);
    this.name = 'ReportGenerationError';
    
    // Capture stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ReportGenerationError);
    }
  }
}

// Report request schema - flexible for any topic, not just financial
export const ReportRequestSchema = z.object({
  // Core fields
  topic: z.string().describe('The main topic for the report'),
  title: z.string().describe('Title for the report'),
  data: z.record(z.any()).optional().describe('Data to include in the report'),
  
  // Financial-specific fields (optional)
  symbol: z.string().optional().describe('Stock symbol (for financial reports)'),
  timeframe: z.enum(['1d', '1w', '1m', '3m', '6m', '1y']).optional().default('1m')
    .describe('Timeframe for financial data'),
  
  // Infographic options
  includeInfographic: z.boolean().default(true).describe('Whether to generate an infographic'),
  infographicStyle: z.enum(['modern', 'corporate', 'minimalist', 'colorful']).default('modern')
    .describe('Visual style for the infographic'),
  
  // Content options
  sections: z.array(z.string()).optional().describe('Sections to include in the report'),
  
  // LangGraph integration
  agentContext: z.string().optional().describe('Additional context from the agent about what to emphasize'),
  knowledgeGraphData: z.record(z.any()).optional().describe('Data from the knowledge graph'),
  
  // Format options
  format: z.enum(['markdown', 'html', 'text']).default('markdown').describe('Output format')
});

export type ReportRequest = z.infer<typeof ReportRequestSchema>;

// Report response schema
export const ReportResponseSchema = z.object({
  reportId: z.string(),
  title: z.string(),
  topic: z.string(),
  generatedAt: z.string(),
  reportContent: z.string(),
  infographicUrl: z.string().optional(),
  sections: z.array(z.object({
    title: z.string(),
    content: z.string(),
    data: z.record(z.string(), z.any()).optional()
  }))
});

export type ReportResponse = z.infer<typeof ReportResponseSchema>;

/**
 * Generate a report using Gemini
 * Can be called directly or from LangGraph
 * @param request Report generation request
 * @returns Generated report
 * @throws {ReportGenerationError} If there's an error during report generation
 * @throws {z.ZodError} If the request validation fails
 */
export async function generateReport(request: ReportRequest): Promise<ReportResponse> {
  try {
    // Validate request
    const validatedRequest = ReportRequestSchema.parse(request);
    
    // Prepare data for the report
    let reportData: any = {
      topic: validatedRequest.topic,
      title: validatedRequest.title,
      format: validatedRequest.format
    };
    
    // Add any provided data
    if (validatedRequest.data) {
      reportData = { ...reportData, ...validatedRequest.data };
    }
    
    // Add knowledge graph data if provided
    if (validatedRequest.knowledgeGraphData) {
      reportData.knowledgeGraphData = validatedRequest.knowledgeGraphData;
    }
    
    // If this is a financial report, gather financial data
    if (validatedRequest.symbol) {
      try {
        const financialData = await gatherFinancialData(validatedRequest);
        reportData = { ...reportData, ...financialData };
      } catch (error) {
        console.error('Error gathering financial data:', error);
        throw new ReportGenerationError('Failed to gather financial data', error);
      }
    }
    
    // Generate report content using Gemini
    let reportContent: string;
    try {
      reportContent = await generateReportContent(reportData, validatedRequest.agentContext);
    } catch (error) {
      console.error('Error generating report content:', error);
      throw new ReportGenerationError('Failed to generate report content', error);
    }
    
    // Generate infographic if requested
    let infographicUrl: string | undefined;
    if (validatedRequest.includeInfographic) {
      try {
        infographicUrl = await generateInfographic(
          reportData, 
          reportContent, 
          validatedRequest.infographicStyle
        );
      } catch (error) {
        // Don't fail the whole report if infographic generation fails
        console.error('Error generating infographic:', error);
        // Continue without an infographic
      }
    }
    
    // Parse sections from the report content
    const sections = parseSections(reportContent);
    
    // Create the final report response
    const reportResponse: ReportResponse = {
      reportId: generateReportId(),
      title: validatedRequest.title,
      topic: validatedRequest.topic,
      generatedAt: new Date().toISOString(),
      reportContent,
      infographicUrl,
      sections
    };
    
    return reportResponse;
  } catch (error) {
    // Handle ZodError separately as it's a validation error
    if (error instanceof z.ZodError) {
      throw error;
    }
    
    // For other errors, wrap in our custom error class if not already
    if (!(error instanceof ReportGenerationError)) {
      console.error('Error generating report:', error);
      throw new ReportGenerationError('Failed to generate report', error);
    }
    
    // Re-throw ReportGenerationError
    throw error;
  }
}

/**
 * Gather financial data for a financial report
 * @throws {ReportGenerationError} If there's an error gathering financial data
 */
async function gatherFinancialData(request: ReportRequest): Promise<any> {
  const symbol = request.symbol!;
  
  // Calculate date range based on timeframe
  const endDate = new Date().toISOString();
  let startDate: string;
  
  switch (request.timeframe) {
    case '1d':
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);
      startDate = oneDayAgo.toISOString();
      break;
    case '1w':
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
      startDate = oneWeekAgo.toISOString();
      break;
    case '1m':
      const oneMonthAgo = new Date();
      oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
      startDate = oneMonthAgo.toISOString();
      break;
    case '3m':
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      startDate = threeMonthsAgo.toISOString();
      break;
    case '6m':
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      startDate = sixMonthsAgo.toISOString();
      break;
    case '1y':
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      startDate = oneYearAgo.toISOString();
      break;
    default:
      const defaultOneMonth = new Date();
      defaultOneMonth.setMonth(defaultOneMonth.getMonth() - 1);
      startDate = defaultOneMonth.toISOString();
  }
  
  try {
    // Gather data for the report
    const stockData = await getStockData(symbol, startDate, endDate);
    const newsArticles = await getNewsArticles(symbol, startDate, endDate, 10);
    const socialMediaMentions = await getSocialMediaMentions(symbol, startDate, endDate, 20);
    
    // Get sentiment analysis
    const sentimentTexts = [
      ...newsArticles.map(article => article.title + ' ' + article.summary),
      ...socialMediaMentions.map(mention => mention.content)
    ];
    
    const sentimentResults = await fetchSentimentAnalysis(sentimentTexts);
    const aggregateSentiment = calculateAggregateSentiment(sentimentResults);
    
    return {
      symbol,
      timeframe: request.timeframe,
      stockData: stockData.slice(0, 30), // Limit to avoid token limits
      newsArticles: newsArticles.slice(0, 5), // Limit to top 5 news articles
      socialMediaMentions: socialMediaMentions.slice(0, 5), // Limit to top 5 mentions
      sentiment: aggregateSentiment,
      companyName: getCompanyName(symbol, stockData)
    };
  } catch (error) {
    throw new ReportGenerationError(`Failed to gather financial data for symbol ${symbol}`, error);
  }
}

/**
 * Generate report content using Gemini API
 * @throws {ReportGenerationError} If there's an error calling the Gemini API
 */
async function generateReportContent(reportData: any, agentContext?: string): Promise<string> {
  if (!GEMINI_API_KEY) {
    console.warn('GEMINI_API_KEY not set. Using mock report content.');
    return generateMockReportContent(reportData);
  }
  
  try {
    const prompt = createReportPrompt(reportData, agentContext);
    
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1/models/${GEMINI_MODEL}:generateContent`,
      {
        contents: [
          {
            parts: [
              {
                text: prompt
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 8192
        }
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': GEMINI_API_KEY
        }
      }
    );
    
    // Check if the response has the expected structure
    if (!response.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
      throw new ReportGenerationError('Unexpected response format from Gemini API', response.data);
    }
    
    // Extract the generated text from the response
    const generatedText = response.data.candidates[0].content.parts[0].text;
    return generatedText;
  } catch (error) {
    // Handle Axios errors specifically
    if (axios.isAxiosError(error)) {
      const statusCode = error.response?.status;
      const responseData = error.response?.data;
      
      if (statusCode === 401 || statusCode === 403) {
        throw new ReportGenerationError('Authentication error with Gemini API. Check your API key.', error);
      } else if (statusCode === 429) {
        throw new ReportGenerationError('Rate limit exceeded for Gemini API.', error);
      } else {
        throw new ReportGenerationError(`Gemini API error (${statusCode}): ${JSON.stringify(responseData)}`, error);
      }
    }
    
    console.error('Error calling Gemini API:', error);
    // Fall back to mock content
    console.warn('Falling back to mock report content due to API error.');
    return generateMockReportContent(reportData);
  }
}

/**
 * Generate an infographic using Gemini Vision API
 * @throws {ReportGenerationError} If there's an error generating the infographic
 */
async function generateInfographic(
  reportData: any,
  reportContent: string,
  style: string
): Promise<string | undefined> {
  if (!GEMINI_API_KEY) {
    console.warn('GEMINI_API_KEY not set. Cannot generate infographic.');
    return undefined;
  }
  
  try {
    // Create a prompt for the infographic
    const infographicPrompt = createInfographicPrompt(reportData, reportContent, style);
    
    // Call Gemini Vision API to generate the infographic
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1/models/${GEMINI_VISION_MODEL}:generateContent`,
      {
        contents: [
          {
            parts: [
              {
                text: infographicPrompt
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.4,
          topK: 32,
          topP: 0.95
        }
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': GEMINI_API_KEY
        }
      }
    );
    
    // Check if the response has the expected structure
    if (!response.data?.candidates?.[0]?.content?.parts) {
      throw new ReportGenerationError('Unexpected response format from Gemini Vision API', response.data);
    }
    
    // In a real implementation, we would save the generated image
    // For now, we'll return a placeholder URL
    const topic = reportData.topic || reportData.symbol || 'report';
    const timestamp = Date.now();
    const uniqueId = Math.floor(Math.random() * 10000);
    return `https://storage.googleapis.com/reports/${encodeURIComponent(topic)}_${timestamp}_${uniqueId}.png`;
  } catch (error) {
    // Handle Axios errors specifically
    if (axios.isAxiosError(error)) {
      const statusCode = error.response?.status;
      const responseData = error.response?.data;
      
      if (statusCode === 401 || statusCode === 403) {
        throw new ReportGenerationError('Authentication error with Gemini Vision API. Check your API key.', error);
      } else if (statusCode === 429) {
        throw new ReportGenerationError('Rate limit exceeded for Gemini Vision API.', error);
      } else {
        throw new ReportGenerationError(`Gemini Vision API error (${statusCode}): ${JSON.stringify(responseData)}`, error);
      }
    }
    
    console.error('Error generating infographic:', error);
    return undefined;
  }
}

/**
 * Create a prompt for the report generation
 */
function createReportPrompt(reportData: any, agentContext?: string): string {
  // Start with a base prompt
  let prompt = `
Generate a comprehensive report about ${reportData.topic || reportData.symbol} with the title "${reportData.title}".
`;

  // Add agent context if provided
  if (agentContext) {
    prompt += `
AGENT CONTEXT:
${agentContext}
`;
  }

  // Add financial data if available
  if (reportData.symbol) {
    prompt += `
FINANCIAL DATA:
Symbol: ${reportData.symbol}
Timeframe: ${reportData.timeframe}
Stock Data: ${JSON.stringify(reportData.stockData)}
News Articles: ${JSON.stringify(reportData.newsArticles)}
Social Media Mentions: ${JSON.stringify(reportData.socialMediaMentions)}
Sentiment Analysis: ${JSON.stringify(reportData.sentiment)}
`;
  }

  // Add knowledge graph data if available
  if (reportData.knowledgeGraphData) {
    prompt += `
KNOWLEDGE GRAPH DATA:
${JSON.stringify(reportData.knowledgeGraphData)}
`;
  }

  // Add any custom data
  if (reportData.data) {
    prompt += `
ADDITIONAL DATA:
${JSON.stringify(reportData.data)}
`;
  }

  // Add formatting instructions
  prompt += `
Format the report in ${reportData.format || 'markdown'} with clear section headers. Include data-driven insights and analysis.
For each section, provide actionable insights based on the data.

IMPORTANT GUIDELINES:
1. Be objective and data-driven
2. Highlight key trends and patterns
3. Explain technical terms for a general audience
4. Include specific data points to support conclusions
5. Format each section with a clear heading (e.g., "## Analysis")
6. Conclude with a summary of key takeaways
`;

  return prompt;
}

/**
 * Create a prompt for infographic generation
 */
function createInfographicPrompt(reportData: any, reportContent: string, style: string): string {
  const topic = reportData.topic || reportData.symbol || 'the subject';
  const title = reportData.title || `Report on ${topic}`;
  
  return `
Create an infographic for "${title}" with the following style: ${style}.

The infographic should visualize key data from this report:

${reportContent.substring(0, 2000)}... (truncated)

${reportData.symbol ? `
FINANCIAL DATA:
${JSON.stringify(reportData.stockData?.slice(0, 5))}

SENTIMENT:
${JSON.stringify(reportData.sentiment)}
` : ''}

${reportData.knowledgeGraphData ? `
KNOWLEDGE GRAPH DATA:
${JSON.stringify(reportData.knowledgeGraphData)}
` : ''}

GUIDELINES:
1. Create a professional, visually appealing infographic
2. Include appropriate charts and visualizations for the data
3. Use the corporate color scheme if available
4. Include relevant icons and imagery
5. Add key metrics and insights
6. Style: ${style} (modern = clean lines and minimalist; corporate = professional blue tones; minimalist = simple black and white; colorful = vibrant and engaging)
7. Make the infographic self-contained and informative on its own
8. Ensure text is readable and not overcrowded
`;
}

/**
 * Parse sections from the report content
 */
function parseSections(reportContent: string): Array<{ title: string; content: string; data?: Record<string, any> }> {
  const sections = [];
  const sectionRegex = /## ([^\n]+)\n([\s\S]*?)(?=\n## |$)/g;
  
  let match;
  while ((match = sectionRegex.exec(reportContent)) !== null) {
    const title = match[1].trim();
    const content = match[2].trim();
    
    sections.push({
      title,
      content
    });
  }
  
  // If no sections were found, create a default one with the entire content
  if (sections.length === 0 && reportContent.trim()) {
    sections.push({
      title: 'Report',
      content: reportContent.trim()
    });
  }
  
  return sections;
}

/**
 * Generate a mock report content for testing
 */
function generateMockReportContent(reportData: any): string {
  const topic = reportData.topic || reportData.symbol || 'the subject';
  const title = reportData.title || `Report on ${topic}`;
  
  return `# ${title}

## Summary

This report provides an analysis of ${topic} based on available data.

## Key Findings

The analysis reveals several important insights about ${topic}:

1. First key finding
2. Second key finding
3. Third key finding

## Analysis

The data shows interesting patterns related to ${topic}. These patterns suggest...

## Recommendations

Based on our analysis, we recommend the following actions:

1. First recommendation
2. Second recommendation
3. Third recommendation

## Conclusion

In conclusion, ${topic} demonstrates significant potential for further exploration and development.
`;
}

/**
 * Generate a unique report ID
 */
function generateReportId(): string {
  const timestamp = Date.now();
  const randomPart = Math.floor(Math.random() * 10000);
  return `report-${timestamp}-${randomPart}`;
}

/**
 * Get company name from symbol
 */
function getCompanyName(symbol: string, stockData: any[]): string {
  // In a real implementation, we would look up the company name
  // For now, we'll use a simple mapping
  const companyNames: Record<string, string> = {
    'AAPL': 'Apple Inc.',
    'MSFT': 'Microsoft Corporation',
    'GOOGL': 'Alphabet Inc.',
    'AMZN': 'Amazon.com Inc.',
    'META': 'Meta Platforms Inc.',
    'TSLA': 'Tesla Inc.',
    'NVDA': 'NVIDIA Corporation',
    'JPM': 'JPMorgan Chase & Co.',
    'V': 'Visa Inc.',
    'JNJ': 'Johnson & Johnson'
  };
  
  return companyNames[symbol] || `${symbol} Inc.`;
}
