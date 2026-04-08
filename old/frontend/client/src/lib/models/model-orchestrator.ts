/**
 * Model Orchestrator
 * Coordinates evolutionary model selection and ESN integration with knowledge graph data
 */

import { ModelType } from './ontology';
import { EvoSelectorRequest, EvoSelectorResponse, ModelRecipe } from './evoselector';
import { TimeInterval, AggregationType } from '../services/timeseries';
import { kgRunEvoModelSelection, kgGetEntityTimeSeries, feedESNWithModels } from '../api';

/**
 * Model evaluation result with accuracy metrics
 */
export interface ModelEvaluationResult {
  modelId: string;
  modelType: ModelType;
  accuracy: {
    mase: number;
    smape: number;
    mape: number;
    rmse: number;
    coverage: number;
    crps: number;
  };
  predictedAccuracy: number; // 0-1 score from split sampling probability
  confidence: number; // 0-1 confidence score
  trainingTime: number; // in seconds
  timestamp: string;
}

/**
 * ESN ensemble configuration
 */
export interface ESNEnsembleConfig {
  targetSeriesId: string;
  sourceModels: Array<{
    modelId: string;
    modelType: ModelType;
    weight: number;
  }>;
  windowSize: number;
  horizon: number;
  combineMethod: 'concat' | 'average' | 'weighted';
}

/**
 * Training strategy for model selection
 */
export enum TrainingStrategy {
  FAST = 'fast',       // Quick training for rapid iteration
  BALANCED = 'balanced', // Balance between speed and accuracy
  THOROUGH = 'thorough', // Thorough training for best accuracy
  ADAPTIVE = 'adaptive'  // Adapts based on data characteristics
}

/**
 * Knowledge graph data source for model training
 */
export interface KGDataSource {
  entityId: string;
  seriesId: string;
  timeRange: {
    start: string;
    end: string;
  };
  aggregation: AggregationType;
  interval: TimeInterval;
}

/**
 * Run the evolutionary model selection process
 * @param seriesId - The time series ID to model
 * @param entityId - The knowledge graph entity ID
 * @param strategy - The training strategy to use
 * @param additionalSources - Additional knowledge graph data sources to use for training
 */
export async function runModelEvolution(
  seriesId: string,
  entityId: string,
  strategy: TrainingStrategy = TrainingStrategy.BALANCED,
  additionalSources: KGDataSource[] = []
): Promise<EvoSelectorResponse> {
  // Configure the evolutionary selector request based on the strategy
  const request: EvoSelectorRequest = configureEvoRequest(seriesId, strategy);
  
  // Add knowledge graph data sources to the request
  if (additionalSources.length > 0) {
    request.kgDataSources = additionalSources;
  }
  
  // Run the evolutionary model selection
  const result = await kgRunEvoModelSelection(seriesId, entityId, request);
  
  if (!result.ok || !result.result) {
    throw new Error(result.message || 'Failed to run evolutionary model selection');
  }
  
  return result.result;
}

/**
 * Configure the evolutionary selector request based on the strategy
 */
function configureEvoRequest(
  seriesId: string,
  strategy: TrainingStrategy
): EvoSelectorRequest {
  // Base configuration
  const request: EvoSelectorRequest = {
    seriesId,
    searchSpace: {
      models: [
        ModelType.ARIMA,
        ModelType.TBATS,
        ModelType.PROPHET,
        ModelType.ESN,
        ModelType.TFT,
        ModelType.NBEATS,
        ModelType.ENSEMBLE
      ],
      // Default search space parameters
      arimaParams: {
        p: [0, 1, 2, 3],
        d: [0, 1, 2],
        q: [0, 1, 2, 3]
      },
      esnParams: {
        reservoirSize: [50, 100, 200],
        spectralRadius: [0.8, 0.9, 0.99],
        leakRate: [0.1, 0.3, 0.5]
      }
    },
    fidelity: 'medium'
  };
  
  // Adjust configuration based on strategy
  switch (strategy) {
    case TrainingStrategy.FAST:
      request.populationSize = 20;
      request.generations = 5;
      request.timeLimit = 60; // 1 minute
      request.fidelity = 'low';
      // Reduce search space
      request.searchSpace.models = [ModelType.ARIMA, ModelType.ESN, ModelType.ENSEMBLE];
      break;
      
    case TrainingStrategy.BALANCED:
      request.populationSize = 40;
      request.generations = 10;
      request.timeLimit = 300; // 5 minutes
      request.fidelity = 'medium';
      break;
      
    case TrainingStrategy.THOROUGH:
      request.populationSize = 60;
      request.generations = 20;
      request.timeLimit = 1800; // 30 minutes
      request.fidelity = 'high';
      // Expand search space
      request.searchSpace.arimaParams = {
        p: [0, 1, 2, 3, 4, 5],
        d: [0, 1, 2],
        q: [0, 1, 2, 3, 4, 5],
        P: [0, 1, 2],
        D: [0, 1],
        Q: [0, 1, 2],
        m: [7, 12, 24, 52]
      };
      request.searchSpace.esnParams = {
        reservoirSize: [50, 100, 200, 300, 500],
        spectralRadius: [0.7, 0.8, 0.9, 0.95, 0.99],
        leakRate: [0.1, 0.2, 0.3, 0.5, 0.8],
        sparsity: [0.05, 0.1, 0.2],
        inputScaling: [0.1, 0.5, 1.0, 2.0],
        regParam: [1e-6, 1e-5, 1e-4, 1e-3]
      };
      break;
      
    case TrainingStrategy.ADAPTIVE:
      request.populationSize = 30;
      request.generations = 15;
      request.timeLimit = 600; // 10 minutes
      request.fidelity = 'multi';
      request.adaptiveStrategy = true;
      break;
  }
  
  return request;
}

/**
 * Feed the best models from evolutionary selection into an ESN ensemble
 * @param evolutionResult - The result from evolutionary model selection
 * @param targetSeriesId - The target time series ID for the ESN model
 * @param entityId - The knowledge graph entity ID
 * @param topN - Number of top models to include (default: 3)
 */
export async function feedBestModelsToESN(
  evolutionResult: EvoSelectorResponse,
  targetSeriesId: string,
  entityId: string,
  topN: number = 3
): Promise<{ ok: boolean; modelId?: string; message?: string }> {
  // Get the top N models from the evolution result
  const topModels = evolutionResult.recipes
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, topN);
  
  // Calculate weights based on model scores
  const totalScore = topModels.reduce((sum, model) => sum + (model.score || 0), 0);
  const weights: Record<string, number> = {};
  
  topModels.forEach(model => {
    const normalizedScore = (model.score || 0) / totalScore;
    weights[model.id] = normalizedScore;
  });
  
  // Configure ESN ensemble
  const config: ESNEnsembleConfig = {
    targetSeriesId,
    sourceModels: topModels.map(model => ({
      modelId: model.id,
      modelType: model.type,
      weight: weights[model.id]
    })),
    windowSize: 24, // Default window size
    horizon: 12,    // Default forecast horizon
    combineMethod: 'weighted'
  };
  
  // Feed the models to the ESN
  return await feedESNWithModels(
    targetSeriesId,
    topModels.map(model => model.id),
    {
      windowSize: config.windowSize,
      horizon: config.horizon,
      combineMethod: config.combineMethod,
      weights
    }
  );
}

/**
 * Calculate predicted accuracy using split sampling probability
 * @param recipe - The model recipe to evaluate
 * @param seriesId - The time series ID
 */
export async function calculatePredictedAccuracy(
  recipe: ModelRecipe,
  seriesId: string
): Promise<number> {
  // This would normally call a backend API to perform split sampling
  // For now, we'll return a mock value based on the model type
  
  // In a real implementation, this would:
  // 1. Split the data into training and validation sets
  // 2. Train the model on the training set
  // 3. Evaluate on the validation set
  // 4. Repeat with different splits
  // 5. Calculate probability of accuracy based on the results
  
  // Mock implementation
  const baseAccuracy = recipe.score || 0.5;
  const randomFactor = Math.random() * 0.2 - 0.1; // -0.1 to 0.1
  
  return Math.min(0.99, Math.max(0.1, baseAccuracy + randomFactor));
}

/**
 * Run the complete model orchestration process:
 * 1. Evolutionary model selection
 * 2. Accuracy prediction with split sampling
 * 3. Feed best models to ESN
 */
export async function orchestrateModelPipeline(
  seriesId: string,
  entityId: string,
  strategy: TrainingStrategy = TrainingStrategy.BALANCED
): Promise<{
  evolutionResult: EvoSelectorResponse;
  esnResult: { ok: boolean; modelId?: string; message?: string };
  predictedAccuracies: Record<string, number>;
}> {
  // Step 1: Get additional knowledge graph data sources
  const entitySeriesResult = await kgGetEntityTimeSeries(entityId);
  const additionalSources: KGDataSource[] = [];
  
  if (entitySeriesResult.ok && entitySeriesResult.series) {
    // Add related time series as additional data sources
    entitySeriesResult.series
      .filter(series => series.seriesId !== seriesId) // Exclude the target series
      .slice(0, 3) // Limit to 3 additional sources
      .forEach(series => {
        additionalSources.push({
          entityId,
          seriesId: series.seriesId,
          timeRange: {
            start: series.startDate || '',
            end: series.endDate || ''
          },
          aggregation: AggregationType.AVG,
          interval: TimeInterval.DAY
        });
      });
  }
  
  // Step 2: Run evolutionary model selection
  const evolutionResult = await runModelEvolution(
    seriesId,
    entityId,
    strategy,
    additionalSources
  );
  
  // Step 3: Calculate predicted accuracies using split sampling
  const predictedAccuracies: Record<string, number> = {};
  for (const recipe of evolutionResult.recipes) {
    predictedAccuracies[recipe.id] = await calculatePredictedAccuracy(recipe, seriesId);
  }
  
  // Step 4: Feed best models to ESN
  const esnResult = await feedBestModelsToESN(
    evolutionResult,
    seriesId,
    entityId
  );
  
  return {
    evolutionResult,
    esnResult,
    predictedAccuracies
  };
}
