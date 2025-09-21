/**
 * Media Service
 * Fetches news articles and social media mentions
 */

import axios from 'axios';
import { z } from 'zod';
import { MCPClient } from '../connectors/mcpClient';

// Environment variables
const NEWS_API_KEY = process.env.NEWS_API_KEY;
const REDDIT_CLIENT_ID = process.env.REDDIT_CLIENT_ID;
const REDDIT_CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET;
const TWITTER_BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN;
const USE_MCP = process.env.USE_MCP === 'true';

// MCP client instance
const mcpClient = new MCPClient();

// News article schema
export const NewsArticleSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string().url(),
  source: z.string(),
  author: z.string().optional(),
  publishedAt: z.string(),
  summary: z.string(),
  content: z.string().optional(),
  imageUrl: z.string().url().optional()
});

export type NewsArticle = z.infer<typeof NewsArticleSchema>;

// Social media mention schema
export const SocialMediaMentionSchema = z.object({
  id: z.string(),
  platform: z.string(),
  author: z.string(),
  content: z.string(),
  url: z.string().url().optional(),
  publishedAt: z.string(),
  likes: z.number().optional(),
  shares: z.number().optional(),
  comments: z.number().optional()
});

export type SocialMediaMention = z.infer<typeof SocialMediaMentionSchema>;

/**
 * Get news articles related to a query
 * @param query Search query
 * @param startDate Start date in ISO format
 * @param endDate End date in ISO format
 * @param limit Maximum number of articles to return
 * @returns Array of news articles
 */
export async function getNewsArticles(
  query: string,
  startDate?: string,
  endDate?: string,
  limit: number = 10
): Promise<NewsArticle[]> {
  try {
    if (USE_MCP) {
      return await getNewsArticlesFromMCP(query, startDate, endDate, limit);
    } else if (NEWS_API_KEY) {
      return await getNewsArticlesFromNewsAPI(query, startDate, endDate, limit);
    } else {
      console.warn('No news API key configured. Using mock data.');
      return generateMockNewsArticles(query, startDate, endDate, limit);
    }
  } catch (error) {
    console.error(`Error fetching news articles for "${query}":`, error);
    return generateMockNewsArticles(query, startDate, endDate, limit);
  }
}

/**
 * Get social media mentions related to a query
 * @param query Search query
 * @param startDate Start date in ISO format
 * @param endDate End date in ISO format
 * @param limit Maximum number of mentions to return
 * @returns Array of social media mentions
 */
export async function getSocialMediaMentions(
  query: string,
  startDate?: string,
  endDate?: string,
  limit: number = 20
): Promise<SocialMediaMention[]> {
  try {
    if (USE_MCP) {
      return await getSocialMediaMentionsFromMCP(query, startDate, endDate, limit);
    } else if (REDDIT_CLIENT_ID && REDDIT_CLIENT_SECRET) {
      const redditMentions = await getRedditMentions(query, startDate, endDate, Math.floor(limit / 2));
      return redditMentions;
    } else if (TWITTER_BEARER_TOKEN) {
      const twitterMentions = await getTwitterMentions(query, startDate, endDate, limit);
      return twitterMentions;
    } else {
      console.warn('No social media API keys configured. Using mock data.');
      return generateMockSocialMediaMentions(query, startDate, endDate, limit);
    }
  } catch (error) {
    console.error(`Error fetching social media mentions for "${query}":`, error);
    return generateMockSocialMediaMentions(query, startDate, endDate, limit);
  }
}

/**
 * Get news articles from News API
 */
async function getNewsArticlesFromNewsAPI(
  query: string,
  startDate?: string,
  endDate?: string,
  limit: number = 10
): Promise<NewsArticle[]> {
  // Format dates for News API
  const from = startDate ? new Date(startDate).toISOString().split('T')[0] : undefined;
  const to = endDate ? new Date(endDate).toISOString().split('T')[0] : undefined;
  
  const response = await axios.get('https://newsapi.org/v2/everything', {
    params: {
      q: query,
      from,
      to,
      language: 'en',
      sortBy: 'publishedAt',
      pageSize: limit,
      apiKey: NEWS_API_KEY
    }
  });
  
  const data = response.data;
  
  if (data.status !== 'ok') {
    throw new Error(`News API error: ${data.message || 'Unknown error'}`);
  }
  
  return data.articles.map((article: any, index: number) => ({
    id: article.url || `news-${index}`,
    title: article.title || 'Untitled',
    url: article.url,
    source: article.source?.name || 'Unknown',
    author: article.author,
    publishedAt: article.publishedAt,
    summary: article.description || 'No description available',
    content: article.content,
    imageUrl: article.urlToImage
  }));
}

/**
 * Get news articles from MCP
 */
async function getNewsArticlesFromMCP(
  query: string,
  startDate?: string,
  endDate?: string,
  limit: number = 10
): Promise<NewsArticle[]> {
  const response = await mcpClient.execute('news-api', 'search', {
    query,
    startDate,
    endDate,
    limit
  });
  
  if (!response.ok) {
    throw new Error(`MCP error: ${response.error}`);
  }
  
  return response.data.map((article: any) => ({
    id: article.id || article.url,
    title: article.title,
    url: article.url,
    source: article.source,
    author: article.author,
    publishedAt: article.publishedAt,
    summary: article.summary || article.description,
    content: article.content,
    imageUrl: article.imageUrl
  }));
}

/**
 * Get Reddit mentions
 */
async function getRedditMentions(
  query: string,
  startDate?: string,
  endDate?: string,
  limit: number = 10
): Promise<SocialMediaMention[]> {
  // First, get access token
  const tokenResponse = await axios.post(
    'https://www.reddit.com/api/v1/access_token',
    `grant_type=client_credentials`,
    {
      auth: {
        username: REDDIT_CLIENT_ID!,
        password: REDDIT_CLIENT_SECRET!
      },
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }
  );
  
  const accessToken = tokenResponse.data.access_token;
  
  // Then, search for posts
  const response = await axios.get('https://oauth.reddit.com/search', {
    params: {
      q: query,
      sort: 'new',
      limit,
      t: 'all'
    },
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'User-Agent': 'LiquidAIty/1.0'
    }
  });
  
  return response.data.data.children.map((post: any) => {
    const data = post.data;
    
    return {
      id: data.id,
      platform: 'reddit',
      author: data.author,
      content: data.selftext || data.title,
      url: `https://reddit.com${data.permalink}`,
      publishedAt: new Date(data.created_utc * 1000).toISOString(),
      likes: data.ups,
      comments: data.num_comments
    };
  });
}

/**
 * Get Twitter mentions
 * Note: This uses Twitter API v2
 */
async function getTwitterMentions(
  query: string,
  startDate?: string,
  endDate?: string,
  limit: number = 10
): Promise<SocialMediaMention[]> {
  // Format dates for Twitter API
  const start_time = startDate ? new Date(startDate).toISOString() : undefined;
  const end_time = endDate ? new Date(endDate).toISOString() : undefined;
  
  const response = await axios.get('https://api.twitter.com/2/tweets/search/recent', {
    params: {
      query,
      max_results: limit,
      start_time,
      end_time,
      'tweet.fields': 'created_at,public_metrics,author_id',
      'user.fields': 'username',
      expansions: 'author_id'
    },
    headers: {
      'Authorization': `Bearer ${TWITTER_BEARER_TOKEN}`
    }
  });
  
  const data = response.data;
  
  // Create a map of user IDs to usernames
  const userMap = new Map();
  if (data.includes?.users) {
    data.includes.users.forEach((user: any) => {
      userMap.set(user.id, user.username);
    });
  }
  
  return data.data.map((tweet: any) => ({
    id: tweet.id,
    platform: 'twitter',
    author: userMap.get(tweet.author_id) || tweet.author_id,
    content: tweet.text,
    url: `https://twitter.com/i/web/status/${tweet.id}`,
    publishedAt: tweet.created_at,
    likes: tweet.public_metrics?.like_count || 0,
    shares: tweet.public_metrics?.retweet_count || 0,
    comments: tweet.public_metrics?.reply_count || 0
  }));
}

/**
 * Get social media mentions from MCP
 */
async function getSocialMediaMentionsFromMCP(
  query: string,
  startDate?: string,
  endDate?: string,
  limit: number = 20
): Promise<SocialMediaMention[]> {
  const response = await mcpClient.execute('social-media', 'search', {
    query,
    startDate,
    endDate,
    limit
  });
  
  if (!response.ok) {
    throw new Error(`MCP error: ${response.error}`);
  }
  
  return response.data.map((mention: any) => ({
    id: mention.id,
    platform: mention.platform,
    author: mention.author,
    content: mention.content,
    url: mention.url,
    publishedAt: mention.publishedAt,
    likes: mention.likes,
    shares: mention.shares,
    comments: mention.comments
  }));
}

/**
 * Generate mock news articles for testing
 */
function generateMockNewsArticles(
  query: string,
  startDate?: string,
  endDate?: string,
  limit: number = 10
): NewsArticle[] {
  const result: NewsArticle[] = [];
  
  // Use provided dates or defaults
  const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const end = endDate ? new Date(endDate) : new Date();
  
  // News sources
  const sources = ['Bloomberg', 'Reuters', 'CNBC', 'Financial Times', 'Wall Street Journal', 'MarketWatch'];
  
  // Generate articles
  for (let i = 0; i < limit; i++) {
    // Random date between start and end
    const date = new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
    
    // Random source
    const source = sources[Math.floor(Math.random() * sources.length)];
    
    // Generate title based on query
    let title = '';
    const rand = Math.random();
    
    if (rand < 0.33) {
      title = `${query} shows strong performance in quarterly report`;
    } else if (rand < 0.66) {
      title = `Analysts predict growth for ${query} in coming months`;
    } else {
      title = `${query} announces new strategic partnership`;
    }
    
    // Generate summary
    const summary = `This is a mock news article about ${query}. It was generated for testing purposes.`;
    
    result.push({
      id: `mock-news-${i}`,
      title,
      url: `https://example.com/news/${i}`,
      source,
      author: `${source} Staff`,
      publishedAt: date.toISOString(),
      summary,
      content: `${summary} Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.`,
      imageUrl: `https://picsum.photos/seed/${query}-${i}/600/400`
    });
  }
  
  return result;
}

/**
 * Generate mock social media mentions for testing
 */
function generateMockSocialMediaMentions(
  query: string,
  startDate?: string,
  endDate?: string,
  limit: number = 20
): SocialMediaMention[] {
  const result: SocialMediaMention[] = [];
  
  // Use provided dates or defaults
  const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const end = endDate ? new Date(endDate) : new Date();
  
  // Platforms
  const platforms = ['twitter', 'reddit', 'facebook', 'linkedin'];
  
  // Generate mentions
  for (let i = 0; i < limit; i++) {
    // Random date between start and end
    const date = new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
    
    // Random platform
    const platform = platforms[Math.floor(Math.random() * platforms.length)];
    
    // Generate content based on query
    let content = '';
    const rand = Math.random();
    
    if (rand < 0.25) {
      content = `Just heard about ${query}. Looks promising! #investing`;
    } else if (rand < 0.5) {
      content = `Anyone else following ${query}? What do you think about their recent news?`;
    } else if (rand < 0.75) {
      content = `${query} is definitely one to watch in this market. #stocks`;
    } else {
      content = `Not sure about ${query}. Need more information before making a decision.`;
    }
    
    result.push({
      id: `mock-social-${i}`,
      platform,
      author: `user${Math.floor(Math.random() * 1000)}`,
      content,
      url: `https://example.com/${platform}/${i}`,
      publishedAt: date.toISOString(),
      likes: Math.floor(Math.random() * 100),
      shares: Math.floor(Math.random() * 20),
      comments: Math.floor(Math.random() * 10)
    });
  }
  
  return result;
}
