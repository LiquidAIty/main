declare module '@data-formulator/views/DataFormulator' {
  import type React from 'react';
  export const DataFormulatorFC: React.ComponentType;
}

declare module '@data-formulator/app/store' {
  const store: unknown;
  export const persistor: unknown;
  export default store;
}

declare module '@data-formulator/app/dfSlice' {
  export type ModelConfig = {
    id: string;
    endpoint: string;
    model: string;
    api_key?: string;
    api_base?: string;
    api_version?: string;
  };

  export type DataFormulatorState = {
    models: ModelConfig[];
    selectedModelId: string | undefined;
  };

  export const dfActions: {
    addModel: (payload: ModelConfig) => unknown;
    selectModel: (payload: string | undefined) => unknown;
    updateModelStatus: (payload: {
      id: string;
      status: 'ok' | 'error' | 'testing' | 'unknown';
      message: string;
    }) => unknown;
  };
}
