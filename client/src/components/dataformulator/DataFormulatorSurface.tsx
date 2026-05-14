import React, { Suspense, lazy } from 'react';
import { Provider, useDispatch, useSelector } from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';
import dataFormulatorStore, { persistor } from '@data-formulator/app/store';
import {
  dfActions,
  type DataFormulatorState,
  type ModelConfig,
} from '@data-formulator/app/dfSlice';

const DataFormulatorFC = lazy(async () => {
  const mod = await import('@data-formulator/views/DataFormulator');
  return { default: mod.DataFormulatorFC };
});

export type DataFormulatorModelConfig = {
  provider: 'openai' | 'openrouter';
  model: string;
  apiBase?: string | null;
  ready?: boolean;
};

function hashModelId(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function toDataFormulatorModelConfig(
  modelConfig?: DataFormulatorModelConfig | null,
): ModelConfig | null {
  if (!modelConfig?.ready) return null;
  const model = modelConfig.model.trim();
  if (!model) return null;

  const endpoint = modelConfig.provider === 'openrouter' ? 'openai' : 'openai';
  const apiBase =
    modelConfig.apiBase?.trim() ||
    (modelConfig.provider === 'openrouter'
      ? 'https://openrouter.ai/api/v1'
      : undefined);
  const id = `liquidaity-${hashModelId(
    `${modelConfig.provider}:${endpoint}:${model}:${apiBase || ''}`,
  )}`;

  return {
    id,
    endpoint,
    model,
    api_base: apiBase,
  };
}

function DataFormulatorModelConfigBridge({
  modelConfig,
}: {
  modelConfig?: DataFormulatorModelConfig | null;
}): null {
  const dispatch = useDispatch();
  const models = useSelector((state: DataFormulatorState) => state.models);
  const selectedModelId = useSelector(
    (state: DataFormulatorState) => state.selectedModelId,
  );

  React.useLayoutEffect(() => {
    const nextModel = toDataFormulatorModelConfig(modelConfig);
    if (!nextModel) return;
    if (selectedModelId) return;

    const existing = models.find(
      (model) =>
        model.endpoint === nextModel.endpoint &&
        model.model === nextModel.model &&
        model.api_base === nextModel.api_base &&
        model.api_version === nextModel.api_version,
    );
    const modelId = existing?.id || nextModel.id;
    const dispatchDataFormulatorAction = dispatch as (action: unknown) => unknown;

    if (!existing) {
      dispatchDataFormulatorAction(dfActions.addModel(nextModel));
    }
    dispatchDataFormulatorAction(
      dfActions.updateModelStatus({
        id: modelId,
        status: 'ok',
        message: 'Configured from LiquidAIty Agent Card.',
      }),
    );
    dispatchDataFormulatorAction(dfActions.selectModel(modelId));
  }, [dispatch, modelConfig, models, selectedModelId]);

  return null;
}

export default function DataFormulatorSurface({
  modelConfig = null,
}: {
  modelConfig?: DataFormulatorModelConfig | null;
}): React.ReactElement {
  return (
    <div
      data-testid="data-formulator-surface"
      style={{
        height: '100%',
        width: '100%',
        minHeight: 0,
        minWidth: 0,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <Provider store={dataFormulatorStore as any}>
        <PersistGate loading={null} persistor={persistor as any}>
          <DataFormulatorModelConfigBridge modelConfig={modelConfig} />
          <Suspense fallback={null}>
            <DataFormulatorFC />
          </Suspense>
        </PersistGate>
      </Provider>
    </div>
  );
}
