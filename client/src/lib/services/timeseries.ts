/**
 * Time Series Data Collection and Aggregation Service
 * Handles collection of time series data at 1-minute intervals and aggregation at various time scales
 */

/**
 * Time series data point
 */
export interface TimePoint {
  timestamp: string;  // ISO format timestamp with timezone
  value: number;
  tags?: Record<string, string>;
  metadata?: Record<string, any>;
}

/**
 * Aggregation type
 */
export enum AggregationType {
  AVG = 'avg',
  SUM = 'sum',
  MIN = 'min',
  MAX = 'max',
  COUNT = 'count',
  FIRST = 'first',
  LAST = 'last',
  STDDEV = 'stddev',
  PERCENTILE_95 = 'p95',
  PERCENTILE_99 = 'p99'
}

/**
 * Time interval for aggregation
 */
export enum TimeInterval {
  MINUTE = 'minute',
  HOUR = 'hour',
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
  QUARTER = 'quarter',
  YEAR = 'year'
}

/**
 * Aggregated time series data with extended statistics
 */
export interface AggregatedData {
  interval: TimeInterval;
  aggregation: AggregationType;
  points: Array<{
    timestamp: string;
    value: number;      // The aggregated value (based on aggregation type)
    min?: number;       // Minimum value in the period
    max?: number;       // Maximum value in the period
    count?: number;     // Number of points aggregated
    weekNumber?: number; // Week number (1-53) if interval is WEEK
  }>;
}

/**
 * Time series collection configuration
 */
export interface TimeSeriesConfig {
  seriesId: string;
  name: string;
  source: string;
  collectIntervalMs?: number;  // Default: 60000 (1 minute)
  retentionPeriods?: {
    raw?: number;       // Days to keep raw data (default: 7)
    minute?: number;    // Days to keep minute aggregations (default: 30)
    hour?: number;      // Days to keep hourly aggregations (default: 90)
    day?: number;       // Days to keep daily aggregations (default: 365)
    week?: number;      // Days to keep weekly aggregations (default: 520)
    month?: number;     // Days to keep monthly aggregations (default: 1095)
    year?: number;      // Days to keep yearly aggregations (default: 3650)
  };
  defaultAggregations?: AggregationType[];  // Default: [AVG, MIN, MAX]
  tags?: Record<string, string>;
  entityId?: string;    // Optional link to knowledge graph entity
}

/**
 * Insert time series data points
 */
export async function insertTimePoints(
  seriesId: string,
  points: TimePoint[]
): Promise<{ ok: boolean; count: number; message?: string }> {
  try {
    const response = await fetch('/api/ts/insert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        seriesId,
        points
      })
    });
    
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status} :: ${text}`);
    }
    
    const data = await response.json();
    return {
      ok: true,
      count: data.count || points.length,
      message: 'Points inserted successfully'
    };
  } catch (error) {
    console.error('Error inserting time points:', error);
    return {
      ok: false,
      count: 0,
      message: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Register a new time series
 */
export async function registerTimeSeries(
  config: TimeSeriesConfig
): Promise<{ ok: boolean; seriesId: string; message?: string }> {
  try {
    const response = await fetch('/api/ts/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });
    
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status} :: ${text}`);
    }
    
    const data = await response.json();
    return {
      ok: true,
      seriesId: data.seriesId || config.seriesId,
      message: 'Time series registered successfully'
    };
  } catch (error) {
    console.error('Error registering time series:', error);
    return {
      ok: false,
      seriesId: config.seriesId,
      message: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Query time series data with optional aggregation
 */
export async function queryTimeSeries(
  seriesId: string,
  startTime: string,
  endTime: string,
  interval?: TimeInterval,
  aggregation?: AggregationType
): Promise<{ ok: boolean; data: TimePoint[] | AggregatedData; message?: string }> {
  try {
    const url = new URL('/api/ts/query', window.location.origin);
    url.searchParams.append('seriesId', seriesId);
    url.searchParams.append('start', startTime);
    url.searchParams.append('end', endTime);
    
    if (interval) {
      url.searchParams.append('interval', interval);
    }
    
    if (aggregation) {
      url.searchParams.append('aggregation', aggregation);
    }
    
    const response = await fetch(url.toString());
    
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status} :: ${text}`);
    }
    
    const data = await response.json();
    
    if (interval && aggregation) {
      return {
        ok: true,
        data: {
          interval,
          aggregation,
          points: data.points || []
        }
      };
    } else {
      return {
        ok: true,
        data: data.points || []
      };
    }
  } catch (error) {
    console.error('Error querying time series:', error);
    return {
      ok: false,
      data: [],
      message: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Get aggregated data for multiple intervals
 */
export async function getMultiAggregation(
  seriesId: string,
  startTime: string,
  endTime: string,
  aggregation: AggregationType = AggregationType.AVG
): Promise<{ 
  ok: boolean; 
  hourly?: AggregatedData;
  daily?: AggregatedData;
  weekly?: AggregatedData;
  monthly?: AggregatedData;
  yearly?: AggregatedData;
  message?: string;
}> {
  try {
    const response = await fetch('/api/ts/multi-aggregation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        seriesId,
        start: startTime,
        end: endTime,
        aggregation,
        includeStats: true // Include min/max for all periods
      })
    });
    
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status} :: ${text}`);
    }
    
    const data = await response.json();
    
    return {
      ok: true,
      hourly: data.hourly,
      daily: data.daily,
      weekly: data.weekly,
      monthly: data.monthly,
      yearly: data.yearly
    };
  } catch (error) {
    console.error('Error getting multi-aggregation:', error);
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Get weekly aggregation by week number
 */
export async function getWeeklyAggregation(
  seriesId: string,
  year: number,
  aggregation: AggregationType = AggregationType.AVG
): Promise<{ 
  ok: boolean; 
  data?: Array<{
    weekNumber: number;
    startDate: string;
    endDate: string;
    value: number;
    min: number;
    max: number;
    count: number;
  }>;
  message?: string;
}> {
  try {
    const response = await fetch('/api/ts/weekly-aggregation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        seriesId,
        year,
        aggregation
      })
    });
    
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status} :: ${text}`);
    }
    
    const data = await response.json();
    
    return {
      ok: true,
      data: data.weeks
    };
  } catch (error) {
    console.error('Error getting weekly aggregation:', error);
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Start a data collection job
 */
export async function startDataCollection(
  seriesId: string,
  dataSourceConfig: Record<string, any>
): Promise<{ ok: boolean; jobId?: string; message?: string }> {
  try {
    const response = await fetch('/api/ts/start-collection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        seriesId,
        dataSourceConfig
      })
    });
    
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status} :: ${text}`);
    }
    
    const data = await response.json();
    
    return {
      ok: true,
      jobId: data.jobId,
      message: 'Data collection started successfully'
    };
  } catch (error) {
    console.error('Error starting data collection:', error);
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Stop a data collection job
 */
export async function stopDataCollection(
  jobId: string
): Promise<{ ok: boolean; message?: string }> {
  try {
    const response = await fetch('/api/ts/stop-collection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId })
    });
    
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status} :: ${text}`);
    }
    
    return {
      ok: true,
      message: 'Data collection stopped successfully'
    };
  } catch (error) {
    console.error('Error stopping data collection:', error);
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Get collection job status
 */
export async function getCollectionStatus(
  jobId: string
): Promise<{ 
  ok: boolean; 
  status?: 'running' | 'stopped' | 'error'; 
  lastRun?: string;
  pointsCollected?: number;
  error?: string;
  message?: string;
}> {
  try {
    const response = await fetch(`/api/ts/collection-status?jobId=${encodeURIComponent(jobId)}`);
    
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status} :: ${text}`);
    }
    
    const data = await response.json();
    
    return {
      ok: true,
      status: data.status,
      lastRun: data.lastRun,
      pointsCollected: data.pointsCollected,
      error: data.error
    };
  } catch (error) {
    console.error('Error getting collection status:', error);
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Create a new time series with automatic collection
 */
export async function createTimeSeriesWithCollection(
  config: TimeSeriesConfig,
  dataSourceConfig: Record<string, any>
): Promise<{ 
  ok: boolean; 
  seriesId?: string; 
  jobId?: string;
  message?: string;
}> {
  // First register the time series
  const registerResult = await registerTimeSeries(config);
  
  if (!registerResult.ok) {
    return registerResult;
  }
  
  // Then start the collection job
  const collectionResult = await startDataCollection(
    registerResult.seriesId,
    dataSourceConfig
  );
  
  if (!collectionResult.ok) {
    return {
      ok: false,
      seriesId: registerResult.seriesId,
      message: `Time series registered but collection failed: ${collectionResult.message}`
    };
  }
  
  return {
    ok: true,
    seriesId: registerResult.seriesId,
    jobId: collectionResult.jobId,
    message: 'Time series created and collection started successfully'
  };
}

/**
 * Link a time series to a knowledge graph entity
 */
export async function linkTimeSeriestoEntity(
  seriesId: string,
  entityId: string
): Promise<{ ok: boolean; message?: string }> {
  try {
    const response = await fetch('/api/kg/link-series', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        seriesId,
        entityId
      })
    });
    
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status} :: ${text}`);
    }
    
    return {
      ok: true,
      message: 'Time series linked to entity successfully'
    };
  } catch (error) {
    console.error('Error linking time series to entity:', error);
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Generate a timestamp for the current time with timezone
 */
export function getCurrentTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Format a timestamp for a specific timezone
 */
export function formatTimestampWithTimezone(
  date: Date,
  timezone: string = 'UTC'
): string {
  return date.toLocaleString('en-US', { timeZone: timezone });
}

/**
 * Get the week number (1-53) for a given date
 */
export function getWeekNumber(date: Date): number {
  // Create a copy of the date to avoid modifying the original
  const d = new Date(date);
  
  // Set to nearest Thursday: current date + 4 - current day number
  // Make Sunday's day number 7
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  
  // Get first day of year
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  
  // Calculate full weeks to nearest Thursday
  const weekNumber = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  
  return weekNumber;
}

/**
 * Calculate aggregated value
 */
export function calculateAggregation(
  values: number[],
  aggregationType: AggregationType
): number {
  if (values.length === 0) {
    return 0;
  }
  
  switch (aggregationType) {
    case AggregationType.AVG:
      return values.reduce((sum, val) => sum + val, 0) / values.length;
      
    case AggregationType.SUM:
      return values.reduce((sum, val) => sum + val, 0);
      
    case AggregationType.MIN:
      return Math.min(...values);
      
    case AggregationType.MAX:
      return Math.max(...values);
      
    case AggregationType.COUNT:
      return values.length;
      
    case AggregationType.FIRST:
      return values[0];
      
    case AggregationType.LAST:
      return values[values.length - 1];
      
    case AggregationType.STDDEV:
      const avg = values.reduce((sum, val) => sum + val, 0) / values.length;
      const squareDiffs = values.map(val => Math.pow(val - avg, 2));
      const avgSquareDiff = squareDiffs.reduce((sum, val) => sum + val, 0) / squareDiffs.length;
      return Math.sqrt(avgSquareDiff);
      
    case AggregationType.PERCENTILE_95:
      const sorted95 = [...values].sort((a, b) => a - b);
      const idx95 = Math.floor(sorted95.length * 0.95);
      return sorted95[idx95];
      
    case AggregationType.PERCENTILE_99:
      const sorted99 = [...values].sort((a, b) => a - b);
      const idx99 = Math.floor(sorted99.length * 0.99);
      return sorted99[idx99];
      
    default:
      return values.reduce((sum, val) => sum + val, 0) / values.length;
  }
}

/**
 * Calculate extended statistics for a set of values
 */
export function calculateExtendedStats(values: number[]): {
  avg: number;
  sum: number;
  min: number;
  max: number;
  count: number;
  stddev?: number;
} {
  if (values.length === 0) {
    return {
      avg: 0,
      sum: 0,
      min: 0,
      max: 0,
      count: 0
    };
  }
  
  const sum = values.reduce((acc, val) => acc + val, 0);
  const avg = sum / values.length;
  const min = Math.min(...values);
  const max = Math.max(...values);
  
  // Calculate standard deviation
  const squareDiffs = values.map(val => Math.pow(val - avg, 2));
  const avgSquareDiff = squareDiffs.reduce((acc, val) => acc + val, 0) / values.length;
  const stddev = Math.sqrt(avgSquareDiff);
  
  return {
    avg,
    sum,
    min,
    max,
    count: values.length,
    stddev
  };
}
