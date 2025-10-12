// Knowledge Graph types

export interface Entity {
  id: string;
  labels: string[];
  properties?: Record<string, any>;
}

export interface Relation {
  sourceId: string;
  targetId: string;
  type: string;
  properties?: Record<string, any>;
}

export interface TimeSeriesPoint {
  t: number; // timestamp
  v: number; // value
  source?: string;
}

export interface Forecast {
  entityId: string;
  horizon: number;
  model: string; // 'ESN-RLS' | 'Prophet' | 'ARIMA' | etc
  predictions: TimeSeriesPoint[];
  metrics?: {
    mse?: number;
    mae?: number;
  };
}

export interface Gap {
  from: string;
  to: string;
  strength: number;
}
