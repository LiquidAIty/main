export type MediaProviderName =
  | 'openrouter'
  | 'peepshow'
  | 'remotion'
  | 'local_upload'
  | 'manual';

export type MediaPrompt = {
  id: string;
  text: string;
  negativePrompt?: string;
  ratio?: '16:9' | '9:16' | '1:1' | '4:5';
  durationSeconds?: number;
  updatedAt: string;
};

export type MediaStyleToken = {
  id: string;
  label: string;
  value: string;
  strength?: number;
};

export type MediaAsset = {
  id: string;
  kind: 'image' | 'video' | 'audio' | 'manifest' | 'project_note';
  label: string;
  source: MediaProviderName;
  status: 'draft' | 'ready' | 'error';
  createdAt: string;
  path?: string;
  mimeType?: string;
};

export type MediaGenerationJob = {
  id: string;
  provider: MediaProviderName;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  promptId: string;
  inputAssetIds: string[];
  outputAssetIds: string[];
  createdAt: string;
  updatedAt: string;
  errorMessage?: string;
};

export type MediaAnalysisManifest = {
  id: string;
  assetId: string;
  provider: 'peepshow';
  summary: string;
  tags: string[];
  createdAt: string;
  reportPath?: string;
  manifestPath?: string;
};

export type MediaRenderJob = {
  id: string;
  provider: 'remotion';
  status: 'draft' | 'queued' | 'rendering' | 'done' | 'failed';
  sourceAssetIds: string[];
  outputAssetId?: string;
  compositionName?: string;
  createdAt: string;
  updatedAt: string;
};
