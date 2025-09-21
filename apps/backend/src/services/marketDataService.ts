/**
 * Market Data Service
 * Fetches stock and forex data from various sources
 */

import axios from 'axios';
import { z } from 'zod';
import { MCPClient } from '../connectors/mcpClient';

// Environment variables
const ALPHA_VANTAGE_API_KEY = process.env.ALPHA_VANTAGE_API_KEY;
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
const USE_MCP = process.env.USE_MCP === 'true';

// MCP client instance
const mcpClient = new MCPClient();

// Stock data schema
export const StockDataPointSchema = z.object({
  timestamp: z.string(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number(),
  adjustedClose: z.number().optional()
});

export type StockDataPoint = z.infer<typeof StockDataPointSchema>;

// Forex data schema
export const ForexDataPointSchema = z.object({
  timestamp: z.string(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number()
});

export type ForexDataPoint = z.infer<typeof ForexDataPointSchema>;

/**
 * Get stock data for a symbol
 * @param symbol Stock symbol (e.g., AAPL, MSFT)
 * @param startDate Start date in ISO format
 * @param endDate End date in ISO format
 * @returns Array of stock data points
 */
export async function getStockData(
  symbol: string,
  startDate?: string,
  endDate?: string
): Promise<StockDataPoint[]> {
  try {
    if (USE_MCP) {
      return await getStockDataFromMCP(symbol, startDate, endDate);
    } else if (ALPHA_VANTAGE_API_KEY) {
      return await getStockDataFromAlphaVantage(symbol, startDate, endDate);
    } else if (FINNHUB_API_KEY) {
      return await getStockDataFromFinnhub(symbol, startDate, endDate);
    } else {
      console.warn('No market data API keys configured. Using mock data.');
      return generateMockStockData(symbol, startDate, endDate);
    }
  } catch (error) {
    console.error(`Error fetching stock data for ${symbol}:`, error);
    return generateMockStockData(symbol, startDate, endDate);
  }
}

/**
 * Get forex data for a currency pair
 * @param pair Currency pair (e.g., EUR/USD, GBP/JPY)
 * @param startDate Start date in ISO format
 * @param endDate End date in ISO format
 * @returns Array of forex data points
 */
export async function getForexData(
  pair: string,
  startDate?: string,
  endDate?: string
): Promise<ForexDataPoint[]> {
  try {
    if (USE_MCP) {
      return await getForexDataFromMCP(pair, startDate, endDate);
    } else if (ALPHA_VANTAGE_API_KEY) {
      return await getForexDataFromAlphaVantage(pair, startDate, endDate);
    } else {
      console.warn('No forex data API keys configured. Using mock data.');
      return generateMockForexData(pair, startDate, endDate);
    }
  } catch (error) {
    console.error(`Error fetching forex data for ${pair}:`, error);
    return generateMockForexData(pair, startDate, endDate);
  }
}

/**
 * Get stock data from Alpha Vantage
 */
async function getStockDataFromAlphaVantage(
  symbol: string,
  startDate?: string,
  endDate?: string
): Promise<StockDataPoint[]> {
  const response = await axios.get('https://www.alphavantage.co/query', {
    params: {
      function: 'TIME_SERIES_DAILY_ADJUSTED',
      symbol,
      outputsize: 'full',
      apikey: ALPHA_VANTAGE_API_KEY
    }
  });
  
  const data = response.data;
  
  if (!data['Time Series (Daily)']) {
    throw new Error(`No data returned for symbol ${symbol}`);
  }
  
  const timeSeriesData = data['Time Series (Daily)'];
  const result: StockDataPoint[] = [];
  
  // Convert to array of data points
  for (const [date, values] of Object.entries(timeSeriesData)) {
    const timestamp = new Date(date).toISOString();
    
    // Skip if outside date range
    if (startDate && timestamp < startDate) continue;
    if (endDate && timestamp > endDate) continue;
    
    // Type assertion for values
    const typedValues = values as Record<string, string>;
    
    result.push({
      timestamp,
      open: parseFloat(typedValues['1. open']),
      high: parseFloat(typedValues['2. high']),
      low: parseFloat(typedValues['3. low']),
      close: parseFloat(typedValues['4. close']),
      volume: parseInt(typedValues['6. volume']),
      adjustedClose: parseFloat(typedValues['5. adjusted close'])
    });
  }
  
  // Sort by timestamp
  return result.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

/**
 * Get stock data from Finnhub
 */
async function getStockDataFromFinnhub(
  symbol: string,
  startDate?: string,
  endDate?: string
): Promise<StockDataPoint[]> {
  // Convert dates to Unix timestamps
  const from = startDate ? Math.floor(new Date(startDate).getTime() / 1000) : 
    Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60; // Default to 30 days ago
  
  const to = endDate ? Math.floor(new Date(endDate).getTime() / 1000) : 
    Math.floor(Date.now() / 1000);
  
  const response = await axios.get('https://finnhub.io/api/v1/stock/candle', {
    params: {
      symbol,
      resolution: 'D', // Daily
      from,
      to,
      token: FINNHUB_API_KEY
    }
  });
  
  const data = response.data;
  
  if (data.s !== 'ok') {
    throw new Error(`Error fetching data for ${symbol}: ${data.s}`);
  }
  
  const result: StockDataPoint[] = [];
  
  // Convert to array of data points
  for (let i = 0; i < data.t.length; i++) {
    const timestamp = new Date(data.t[i] * 1000).toISOString();
    
    result.push({
      timestamp,
      open: data.o[i],
      high: data.h[i],
      low: data.l[i],
      close: data.c[i],
      volume: data.v[i]
    });
  }
  
  return result;
}

/**
 * Get forex data from Alpha Vantage
 */
async function getForexDataFromAlphaVantage(
  pair: string,
  startDate?: string,
  endDate?: string
): Promise<ForexDataPoint[]> {
  // Split pair into from and to currencies
  const [fromCurrency, toCurrency] = pair.split('/');
  
  const response = await axios.get('https://www.alphavantage.co/query', {
    params: {
      function: 'FX_DAILY',
      from_symbol: fromCurrency,
      to_symbol: toCurrency,
      outputsize: 'full',
      apikey: ALPHA_VANTAGE_API_KEY
    }
  });
  
  const data = response.data;
  
  if (!data['Time Series FX (Daily)']) {
    throw new Error(`No data returned for pair ${pair}`);
  }
  
  const timeSeriesData = data['Time Series FX (Daily)'];
  const result: ForexDataPoint[] = [];
  
  // Convert to array of data points
  for (const [date, values] of Object.entries(timeSeriesData)) {
    const timestamp = new Date(date).toISOString();
    
    // Skip if outside date range
    if (startDate && timestamp < startDate) continue;
    if (endDate && timestamp > endDate) continue;
    
    // Type assertion for values
    const typedValues = values as Record<string, string>;
    
    result.push({
      timestamp,
      open: parseFloat(typedValues['1. open']),
      high: parseFloat(typedValues['2. high']),
      low: parseFloat(typedValues['3. low']),
      close: parseFloat(typedValues['4. close'])
    });
  }
  
  // Sort by timestamp
  return result.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

/**
 * Get stock data from MCP
 */
async function getStockDataFromMCP(
  symbol: string,
  startDate?: string,
  endDate?: string
): Promise<StockDataPoint[]> {
  const response = await mcpClient.execute('financial-data', 'getStockData', {
    symbol,
    startDate,
    endDate,
    interval: 'daily'
  });
  
  if (!response.ok) {
    throw new Error(`MCP error: ${response.error}`);
  }
  
  return response.data.map((item: any) => ({
    timestamp: item.date,
    open: item.open,
    high: item.high,
    low: item.low,
    close: item.close,
    volume: item.volume,
    adjustedClose: item.adjustedClose
  }));
}

/**
 * Get forex data from MCP
 */
async function getForexDataFromMCP(
  pair: string,
  startDate?: string,
  endDate?: string
): Promise<ForexDataPoint[]> {
  const [fromCurrency, toCurrency] = pair.split('/');
  
  const response = await mcpClient.execute('financial-data', 'getForexData', {
    fromCurrency,
    toCurrency,
    startDate,
    endDate,
    interval: 'daily'
  });
  
  if (!response.ok) {
    throw new Error(`MCP error: ${response.error}`);
  }
  
  return response.data.map((item: any) => ({
    timestamp: item.date,
    open: item.open,
    high: item.high,
    low: item.low,
    close: item.close
  }));
}

/**
 * Generate mock stock data for testing
 */
function generateMockStockData(
  symbol: string,
  startDate?: string,
  endDate?: string
): StockDataPoint[] {
  const result: StockDataPoint[] = [];
  
  // Use provided dates or defaults
  const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const end = endDate ? new Date(endDate) : new Date();
  
  // Generate a starting price based on the symbol
  // This is just for mock data variety
  const symbolSum = symbol.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  let basePrice = 50 + (symbolSum % 200);
  
  // Generate daily data points
  for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
    // Skip weekends
    const day = date.getDay();
    if (day === 0 || day === 6) continue;
    
    // Add some randomness to the price
    const dailyChange = (Math.random() - 0.48) * basePrice * 0.05;
    basePrice += dailyChange;
    
    // Calculate high, low, open, close
    const volatility = basePrice * 0.02;
    const high = basePrice + Math.random() * volatility;
    const low = basePrice - Math.random() * volatility;
    const open = low + Math.random() * (high - low);
    const close = low + Math.random() * (high - low);
    
    // Add the data point
    result.push({
      timestamp: date.toISOString(),
      open,
      high,
      low,
      close,
      volume: Math.floor(1000000 + Math.random() * 9000000),
      adjustedClose: close
    });
  }
  
  return result;
}

/**
 * Generate mock forex data for testing
 */
function generateMockForexData(
  pair: string,
  startDate?: string,
  endDate?: string
): ForexDataPoint[] {
  const result: ForexDataPoint[] = [];
  
  // Use provided dates or defaults
  const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const end = endDate ? new Date(endDate) : new Date();
  
  // Generate a starting rate based on the pair
  // This is just for mock data variety
  const pairSum = pair.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  let baseRate = 1 + (pairSum % 10) / 10;
  
  // Generate daily data points
  for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
    // Add some randomness to the rate
    const dailyChange = (Math.random() - 0.5) * baseRate * 0.01;
    baseRate += dailyChange;
    
    // Calculate high, low, open, close
    const volatility = baseRate * 0.005;
    const high = baseRate + Math.random() * volatility;
    const low = baseRate - Math.random() * volatility;
    const open = low + Math.random() * (high - low);
    const close = low + Math.random() * (high - low);
    
    // Add the data point
    result.push({
      timestamp: date.toISOString(),
      open,
      high,
      low,
      close
    });
  }
  
  return result;
}
