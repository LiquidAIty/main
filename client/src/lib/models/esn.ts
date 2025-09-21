/**
 * Echo State Network (ESN) with Sparse Recursive Least Squares (SR-RLS)
 * Implementation for time series forecasting
 */

/**
 * ESN+SR-RLS model configuration
 */
export interface ESNConfig {
  inputDim: number;      // Input dimension
  reservoirSize: number; // Number of neurons in reservoir (N)
  spectralRadius: number; // Spectral radius (rho)
  leakRate: number;      // Leak rate
  inputScaling: number;  // Input scaling factor
  regParam: number;      // Regularization parameter (alpha)
  sparsity: number;      // Reservoir sparsity (0-1)
  seed?: number;         // Random seed for reproducibility
}

/**
 * ESN state for persistence
 */
export interface ESNState {
  id: string;            // State ID
  x: number[];           // Reservoir state
  w: number[];           // Output weights
  P: number[][];         // P matrix for RLS
  config: ESNConfig;     // Configuration
}

/**
 * Echo State Network with SR-RLS implementation
 */
export class ESN_RLS {
  private N: number;
  private rho: number;
  private leak: number;
  private W: number[][];
  private Win: number[][];
  private x: number[];
  private P: number[][];
  private w: number[];
  private inputDim: number;
  private alpha: number;
  private sparsity: number;
  private seed: number;

  /**
   * Create a new ESN+SR-RLS model
   */
  constructor(config: ESNConfig) {
    this.inputDim = config.inputDim;
    this.N = config.reservoirSize;
    this.rho = config.spectralRadius;
    this.leak = config.leakRate;
    this.alpha = config.regParam;
    this.sparsity = config.sparsity;
    this.seed = config.seed || 42;
    
    // Initialize reservoir
    this.W = this.initReservoir();
    
    // Initialize input weights
    this.Win = this.initInputWeights();
    
    // Initialize state
    this.x = new Array(this.N).fill(0);
    
    // Initialize P matrix for RLS
    this.P = this.initPMatrix();
    
    // Initialize output weights
    this.w = new Array(this.N + this.inputDim).fill(0);
  }

  /**
   * Initialize the reservoir with sparse connections and scale to spectral radius
   */
  private initReservoir(): number[][] {
    // Create a random matrix
    const W: number[][] = [];
    const rng = this.createRNG(this.seed);
    
    for (let i = 0; i < this.N; i++) {
      W[i] = [];
      for (let j = 0; j < this.N; j++) {
        // Apply sparsity
        if (rng() < this.sparsity) {
          W[i][j] = (rng() * 2 - 1); // Random value between -1 and 1
        } else {
          W[i][j] = 0;
        }
      }
    }
    
    // Calculate spectral radius (approximation using power iteration)
    const maxEig = this.estimateSpectralRadius(W);
    
    // Scale to desired spectral radius
    for (let i = 0; i < this.N; i++) {
      for (let j = 0; j < this.N; j++) {
        W[i][j] = W[i][j] * (this.rho / (maxEig + 1e-8));
      }
    }
    
    return W;
  }

  /**
   * Initialize input weights
   */
  private initInputWeights(): number[][] {
    const Win: number[][] = [];
    const rng = this.createRNG(this.seed + 1);
    
    for (let i = 0; i < this.N; i++) {
      Win[i] = [];
      for (let j = 0; j < this.inputDim; j++) {
        Win[i][j] = (rng() * 2 - 1) * this.inputDim;
      }
    }
    
    return Win;
  }

  /**
   * Initialize P matrix for RLS
   */
  private initPMatrix(): number[][] {
    const dim = this.N + this.inputDim;
    const P: number[][] = [];
    
    for (let i = 0; i < dim; i++) {
      P[i] = [];
      for (let j = 0; j < dim; j++) {
        P[i][j] = i === j ? 1e4 : 0; // Initialize as identity matrix * 1e4
      }
    }
    
    return P;
  }

  /**
   * Estimate spectral radius using power iteration
   */
  private estimateSpectralRadius(matrix: number[][]): number {
    const n = matrix.length;
    let v = new Array(n).fill(0).map(() => Math.random());
    
    // Normalize
    const norm = Math.sqrt(v.reduce((sum, val) => sum + val * val, 0));
    v = v.map(val => val / norm);
    
    // Power iteration (20 iterations)
    for (let iter = 0; iter < 20; iter++) {
      // Matrix-vector multiplication
      const Av = new Array(n).fill(0);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          Av[i] += matrix[i][j] * v[j];
        }
      }
      
      // Normalize
      const normAv = Math.sqrt(Av.reduce((sum, val) => sum + val * val, 0));
      v = Av.map(val => val / normAv);
    }
    
    // One more multiplication to get eigenvalue
    const Av = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        Av[i] += matrix[i][j] * v[j];
      }
    }
    
    // Rayleigh quotient
    let rayleigh = 0;
    for (let i = 0; i < n; i++) {
      rayleigh += v[i] * Av[i];
    }
    
    return Math.abs(rayleigh);
  }

  /**
   * Create a simple RNG with seed
   */
  private createRNG(seed: number): () => number {
    return function() {
      const x = Math.sin(seed++) * 10000;
      return x - Math.floor(x);
    };
  }

  /**
   * Update reservoir state and get prediction
   */
  public step(u: number[], yPrev: number | null = null, forget: number = 0.995): {
    yhat: number;
    z: number[];
    g: number[];
  } {
    // State update
    const preActivation = new Array(this.N).fill(0);
    
    // W * x
    for (let i = 0; i < this.N; i++) {
      for (let j = 0; j < this.N; j++) {
        preActivation[i] += this.W[i][j] * this.x[j];
      }
    }
    
    // Win * u
    for (let i = 0; i < this.N; i++) {
      for (let j = 0; j < this.inputDim; j++) {
        preActivation[i] += this.Win[i][j] * u[j];
      }
    }
    
    // Apply leaky integration and tanh activation
    const xNew = new Array(this.N);
    for (let i = 0; i < this.N; i++) {
      xNew[i] = (1 - this.leak) * this.x[i] + this.leak * Math.tanh(preActivation[i]);
    }
    this.x = xNew;
    
    // Concatenate state and input for readout
    const z = [...this.x, ...u];
    
    // SR-RLS update
    const Pz = new Array(z.length).fill(0);
    for (let i = 0; i < z.length; i++) {
      for (let j = 0; j < z.length; j++) {
        Pz[i] += this.P[i][j] * z[j];
      }
    }
    
    // Calculate gain
    let zPz = 0;
    for (let i = 0; i < z.length; i++) {
      zPz += z[i] * Pz[i];
    }
    
    const g = Pz.map(val => val / (forget + zPz));
    
    // Calculate prediction
    let yhat = 0;
    for (let i = 0; i < z.length; i++) {
      yhat += this.w[i] * z[i];
    }
    
    return { yhat, z, g };
  }

  /**
   * Update weights based on prediction error
   */
  public updateWeights(z: number[], g: number[], yTrue: number, ridge: number = 1e-5): void {
    // Calculate prediction error
    let yhat = 0;
    for (let i = 0; i < z.length; i++) {
      yhat += this.w[i] * z[i];
    }
    const e = yTrue - yhat;
    
    // Update weights
    for (let i = 0; i < this.w.length; i++) {
      this.w[i] += g[i] * e;
    }
    
    // Update P matrix
    const gzP = [];
    for (let i = 0; i < z.length; i++) {
      gzP[i] = [];
      for (let j = 0; j < z.length; j++) {
        let sum = 0;
        for (let k = 0; k < z.length; k++) {
          sum += z[k] * this.P[k][j];
        }
        gzP[i][j] = g[i] * sum;
      }
    }
    
    for (let i = 0; i < z.length; i++) {
      for (let j = 0; j < z.length; j++) {
        this.P[i][j] = (this.P[i][j] - gzP[i][j]) / 0.995;
      }
    }
  }

  /**
   * Get the current state of the model for persistence
   */
  public getState(id: string): ESNState {
    return {
      id,
      x: [...this.x],
      w: [...this.w],
      P: this.P.map(row => [...row]),
      config: {
        inputDim: this.inputDim,
        reservoirSize: this.N,
        spectralRadius: this.rho,
        leakRate: this.leak,
        inputScaling: 1.0, // Default
        regParam: this.alpha,
        sparsity: this.sparsity,
        seed: this.seed
      }
    };
  }

  /**
   * Load a saved state
   */
  public loadState(state: ESNState): void {
    this.x = [...state.x];
    this.w = [...state.w];
    this.P = state.P.map(row => [...row]);
    
    // Only update config if dimensions match
    if (state.config.inputDim === this.inputDim && 
        state.config.reservoirSize === this.N) {
      this.rho = state.config.spectralRadius;
      this.leak = state.config.leakRate;
      this.alpha = state.config.regParam;
      this.sparsity = state.config.sparsity;
      this.seed = state.config.seed || this.seed;
    }
  }

  /**
   * Generate multi-step forecast
   */
  public forecast(
    initialInput: number[],
    steps: number,
    feedbackFn: (pred: number) => number[] = null
  ): number[] {
    const predictions: number[] = [];
    let currentInput = [...initialInput];
    
    for (let i = 0; i < steps; i++) {
      // Get prediction
      const { yhat } = this.step(currentInput);
      predictions.push(yhat);
      
      // Update input for next step if feedback function provided
      if (feedbackFn) {
        currentInput = feedbackFn(yhat);
      }
    }
    
    return predictions;
  }
}
