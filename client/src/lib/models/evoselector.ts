/**
 * Evolutionary Model Selector
 * Uses evolutionary algorithms to select and optimize forecasting models
 */

import { ModelType } from './ontology';

/**
 * Fidelity level for model evaluation
 */
export enum FidelityLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  MULTI = 'multi'
}

/**
 * Model parameters for different model types
 */
export interface ModelParams {
  // ARIMA parameters
  arima?: {
    p?: number;
    d?: number;
    q?: number;
    P?: number;
    D?: number;
    Q?: number;
    m?: number;
  };
  
  // TBATS parameters
  tbats?: {
    seasonal_periods?: number[];
    use_box_cox?: boolean;
    use_trend?: boolean;
    use_damped_trend?: boolean;
  };
  
  // Prophet parameters
  prophet?: {
    changepoint_prior_scale?: number;
    seasonality_prior_scale?: number;
    holidays_prior_scale?: number;
    seasonality_mode?: 'additive' | 'multiplicative';
  };
  
  // ESN parameters
  esn?: {
    reservoirSize?: number;
    spectralRadius?: number;
    leakRate?: number;
    sparsity?: number;
    inputScaling?: number;
    regParam?: number;
  };
  
  // TFT parameters
  tft?: {
    hidden_size?: number;
    lstm_layers?: number;
    num_attention_heads?: number;
    dropout?: number;
    batch_size?: number;
    max_epochs?: number;
  };
  
  // N-BEATS parameters
  nbeats?: {
    num_stacks?: number;
    num_blocks?: number;
    num_layers?: number;
    layer_widths?: number;
    batch_size?: number;
    max_epochs?: number;
  };
  
  // Ensemble parameters
  ensemble?: {
    models?: ModelType[];
    weights?: Record<string, number>;
    method?: 'mean' | 'median' | 'weighted' | 'logpool';
  };
}

/**
 * Model recipe
 */
export interface ModelRecipe {
  id: string;
  type: ModelType;
  params: ModelParams;
  score?: number;
  metrics?: {
    mase?: number;
    smape?: number;
    mape?: number;
    rmse?: number;
    coverage?: number;
    crps?: number;
  };
}

/**
 * Search space for evolutionary algorithm
 */
export interface SearchSpace {
  models: ModelType[];
  arimaParams?: {
    p?: number[];
    d?: number[];
    q?: number[];
    P?: number[];
    D?: number[];
    Q?: number[];
    m?: number[];
  };
  tbatsParams?: {
    seasonal_periods?: number[][];
    use_box_cox?: boolean[];
    use_trend?: boolean[];
    use_damped_trend?: boolean[];
  };
  prophetParams?: {
    changepoint_prior_scale?: number[];
    seasonality_prior_scale?: number[];
    holidays_prior_scale?: number[];
    seasonality_mode?: ('additive' | 'multiplicative')[];
  };
  esnParams?: {
    reservoirSize?: number[];
    spectralRadius?: number[];
    leakRate?: number[];
    sparsity?: number[];
    inputScaling?: number[];
    regParam?: number[];
  };
  tftParams?: {
    hidden_size?: number[];
    lstm_layers?: number[];
    num_attention_heads?: number[];
    dropout?: number[];
    batch_size?: number[];
    max_epochs?: number[];
  };
  nbeatsParams?: {
    num_stacks?: number[];
    num_blocks?: number[];
    num_layers?: number[];
    layer_widths?: number[];
    batch_size?: number[];
    max_epochs?: number[];
  };
  ensembleParams?: {
    methods?: ('mean' | 'median' | 'weighted' | 'logpool')[];
  };
}

/**
 * Evolutionary algorithm selector request
 */
export interface EvoSelectorRequest {
  seriesId: string;
  searchSpace: SearchSpace;
  fidelity: FidelityLevel;
  populationSize?: number;
  generations?: number;
  eliteCount?: number;
  crossoverRate?: number;
  mutationRate?: number;
  timeLimit?: number; // in seconds
}

/**
 * Evolutionary algorithm selector response
 */
export interface EvoSelectorResponse {
  seriesId: string;
  recipes: ModelRecipe[];
  bestRecipe: ModelRecipe;
  searchSpace: SearchSpace;
  runtime: number; // in seconds
  generations: number;
  evaluations: number;
}

/**
 * Run evolutionary algorithm to select best model
 */
export async function runEvoSelector(
  request: EvoSelectorRequest
): Promise<EvoSelectorResponse> {
  try {
    const response = await fetch('/api/ts/evo-selector', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });
    
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status} :: ${text}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error running evolutionary selector:', error);
    throw error;
  }
}

/**
 * Generate a random model recipe from search space
 */
export function generateRandomRecipe(
  searchSpace: SearchSpace,
  id?: string
): ModelRecipe {
  // Helper to pick a random item from an array
  const randomPick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
  
  // Pick a random model type
  const type = randomPick(searchSpace.models);
  
  // Generate random parameters based on model type
  const params: ModelParams = {};
  
  if (type === ModelType.ARIMA && searchSpace.arimaParams) {
    params.arima = {
      p: searchSpace.arimaParams.p ? randomPick(searchSpace.arimaParams.p) : undefined,
      d: searchSpace.arimaParams.d ? randomPick(searchSpace.arimaParams.d) : undefined,
      q: searchSpace.arimaParams.q ? randomPick(searchSpace.arimaParams.q) : undefined,
      P: searchSpace.arimaParams.P ? randomPick(searchSpace.arimaParams.P) : undefined,
      D: searchSpace.arimaParams.D ? randomPick(searchSpace.arimaParams.D) : undefined,
      Q: searchSpace.arimaParams.Q ? randomPick(searchSpace.arimaParams.Q) : undefined,
      m: searchSpace.arimaParams.m ? randomPick(searchSpace.arimaParams.m) : undefined
    };
  } else if (type === ModelType.TBATS && searchSpace.tbatsParams) {
    params.tbats = {
      seasonal_periods: searchSpace.tbatsParams.seasonal_periods ? randomPick(searchSpace.tbatsParams.seasonal_periods) : undefined,
      use_box_cox: searchSpace.tbatsParams.use_box_cox ? randomPick(searchSpace.tbatsParams.use_box_cox) : undefined,
      use_trend: searchSpace.tbatsParams.use_trend ? randomPick(searchSpace.tbatsParams.use_trend) : undefined,
      use_damped_trend: searchSpace.tbatsParams.use_damped_trend ? randomPick(searchSpace.tbatsParams.use_damped_trend) : undefined
    };
  } else if (type === ModelType.PROPHET && searchSpace.prophetParams) {
    params.prophet = {
      changepoint_prior_scale: searchSpace.prophetParams.changepoint_prior_scale ? randomPick(searchSpace.prophetParams.changepoint_prior_scale) : undefined,
      seasonality_prior_scale: searchSpace.prophetParams.seasonality_prior_scale ? randomPick(searchSpace.prophetParams.seasonality_prior_scale) : undefined,
      holidays_prior_scale: searchSpace.prophetParams.holidays_prior_scale ? randomPick(searchSpace.prophetParams.holidays_prior_scale) : undefined,
      seasonality_mode: searchSpace.prophetParams.seasonality_mode ? randomPick(searchSpace.prophetParams.seasonality_mode) : undefined
    };
  } else if (type === ModelType.ESN && searchSpace.esnParams) {
    params.esn = {
      reservoirSize: searchSpace.esnParams.reservoirSize ? randomPick(searchSpace.esnParams.reservoirSize) : undefined,
      spectralRadius: searchSpace.esnParams.spectralRadius ? randomPick(searchSpace.esnParams.spectralRadius) : undefined,
      leakRate: searchSpace.esnParams.leakRate ? randomPick(searchSpace.esnParams.leakRate) : undefined,
      sparsity: searchSpace.esnParams.sparsity ? randomPick(searchSpace.esnParams.sparsity) : undefined,
      inputScaling: searchSpace.esnParams.inputScaling ? randomPick(searchSpace.esnParams.inputScaling) : undefined,
      regParam: searchSpace.esnParams.regParam ? randomPick(searchSpace.esnParams.regParam) : undefined
    };
  } else if (type === ModelType.TFT && searchSpace.tftParams) {
    params.tft = {
      hidden_size: searchSpace.tftParams.hidden_size ? randomPick(searchSpace.tftParams.hidden_size) : undefined,
      lstm_layers: searchSpace.tftParams.lstm_layers ? randomPick(searchSpace.tftParams.lstm_layers) : undefined,
      num_attention_heads: searchSpace.tftParams.num_attention_heads ? randomPick(searchSpace.tftParams.num_attention_heads) : undefined,
      dropout: searchSpace.tftParams.dropout ? randomPick(searchSpace.tftParams.dropout) : undefined,
      batch_size: searchSpace.tftParams.batch_size ? randomPick(searchSpace.tftParams.batch_size) : undefined,
      max_epochs: searchSpace.tftParams.max_epochs ? randomPick(searchSpace.tftParams.max_epochs) : undefined
    };
  } else if (type === ModelType.NBEATS && searchSpace.nbeatsParams) {
    params.nbeats = {
      num_stacks: searchSpace.nbeatsParams.num_stacks ? randomPick(searchSpace.nbeatsParams.num_stacks) : undefined,
      num_blocks: searchSpace.nbeatsParams.num_blocks ? randomPick(searchSpace.nbeatsParams.num_blocks) : undefined,
      num_layers: searchSpace.nbeatsParams.num_layers ? randomPick(searchSpace.nbeatsParams.num_layers) : undefined,
      layer_widths: searchSpace.nbeatsParams.layer_widths ? randomPick(searchSpace.nbeatsParams.layer_widths) : undefined,
      batch_size: searchSpace.nbeatsParams.batch_size ? randomPick(searchSpace.nbeatsParams.batch_size) : undefined,
      max_epochs: searchSpace.nbeatsParams.max_epochs ? randomPick(searchSpace.nbeatsParams.max_epochs) : undefined
    };
  } else if (type === ModelType.ENSEMBLE && searchSpace.ensembleParams) {
    // For ensemble, select a subset of models
    const modelCount = Math.min(3, searchSpace.models.length);
    const selectedModels: ModelType[] = [];
    
    // Ensure we don't select ENSEMBLE again
    const availableModels = searchSpace.models.filter(m => m !== ModelType.ENSEMBLE);
    
    // Select random models
    for (let i = 0; i < modelCount; i++) {
      if (availableModels.length > 0) {
        const idx = Math.floor(Math.random() * availableModels.length);
        selectedModels.push(availableModels[idx]);
        availableModels.splice(idx, 1);
      }
    }
    
    // Generate random weights
    const weights: Record<string, number> = {};
    selectedModels.forEach(model => {
      weights[model] = Math.random();
    });
    
    // Normalize weights
    const sum = Object.values(weights).reduce((a, b) => a + b, 0);
    Object.keys(weights).forEach(key => {
      weights[key] /= sum;
    });
    
    params.ensemble = {
      models: selectedModels,
      weights,
      method: searchSpace.ensembleParams.methods ? randomPick(searchSpace.ensembleParams.methods) : 'weighted'
    };
  }
  
  return {
    id: id || `recipe-${Math.random().toString(36).substring(2, 11)}`,
    type,
    params
  };
}

/**
 * Default search space for common time series
 */
export const defaultSearchSpace: SearchSpace = {
  models: [
    ModelType.ARIMA,
    ModelType.TBATS,
    ModelType.PROPHET,
    ModelType.ESN,
    ModelType.ENSEMBLE
  ],
  arimaParams: {
    p: [0, 1, 2, 3],
    d: [0, 1, 2],
    q: [0, 1, 2, 3],
    P: [0, 1, 2],
    D: [0, 1],
    Q: [0, 1],
    m: [7, 12, 24, 52]
  },
  tbatsParams: {
    seasonal_periods: [[7], [7, 365], [7, 30], [24], [24, 168]],
    use_box_cox: [true, false],
    use_trend: [true, false],
    use_damped_trend: [true, false]
  },
  prophetParams: {
    changepoint_prior_scale: [0.001, 0.01, 0.05, 0.1, 0.5],
    seasonality_prior_scale: [0.01, 0.1, 1.0, 10.0],
    holidays_prior_scale: [0.01, 0.1, 1.0, 10.0],
    seasonality_mode: ['additive', 'multiplicative']
  },
  esnParams: {
    reservoirSize: [50, 100, 200, 300, 500],
    spectralRadius: [0.7, 0.8, 0.9, 0.95, 0.99],
    leakRate: [0.1, 0.2, 0.3, 0.5, 0.8],
    sparsity: [0.05, 0.1, 0.2],
    inputScaling: [0.1, 0.5, 1.0, 2.0],
    regParam: [1e-6, 1e-5, 1e-4, 1e-3]
  },
  ensembleParams: {
    methods: ['mean', 'median', 'weighted', 'logpool']
  }
};

/**
 * Mock evolutionary selector for testing without API calls
 */
export function mockEvoSelector(request: EvoSelectorRequest): EvoSelectorResponse {
  const { seriesId, searchSpace, populationSize = 40, generations = 10 } = request;
  
  // Generate random recipes
  const recipes: ModelRecipe[] = [];
  for (let i = 0; i < 5; i++) {
    const recipe = generateRandomRecipe(searchSpace, `recipe-${i}`);
    
    // Add mock scores
    recipe.score = 0.5 + Math.random() * 0.5; // 0.5 to 1.0
    recipe.metrics = {
      mase: 0.5 + Math.random() * 0.5,
      smape: 5 + Math.random() * 10,
      mape: 5 + Math.random() * 10,
      rmse: 0.5 + Math.random() * 1.5,
      coverage: 0.8 + Math.random() * 0.15,
      crps: 0.2 + Math.random() * 0.3
    };
    
    recipes.push(recipe);
  }
  
  // Sort by score (higher is better)
  recipes.sort((a, b) => (b.score || 0) - (a.score || 0));
  
  return {
    seriesId,
    recipes,
    bestRecipe: recipes[0],
    searchSpace,
    runtime: 5 + Math.random() * 20,
    generations,
    evaluations: populationSize * generations
  };
}
