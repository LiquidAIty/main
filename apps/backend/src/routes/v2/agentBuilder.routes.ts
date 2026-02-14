import { Router } from 'express';
import type { AgentType } from '../../services/v2/agentConfigStore';
import { resolveAgentConfig } from '../../services/resolveAgents';
import { resolveModel } from '../../llm/models.config';
import { safeFetch } from '../../security/safeFetch';
import {
  buildResponsesInput,
  buildResponsesPayload,
  extractResponsesFinishReason,
  extractResponsesText,
} from '../../llm/responses';

const router = Router();

const VALID_AGENT_TYPES: AgentType[] = ['llm_chat', 'kg_ingest', 'agent_builder'];

type LlmDebug = {
  provider: string;
  model: string;
  endpoint: string;
  request: any;
  response: any | null;
  error: any | null;
  elapsed_ms: number | null;
  request_id: string | null;
  finish_reason?: string | null;
  usage?: any | null;
};

class LlmInvokeError extends Error {
  debug?: LlmDebug;
  constructor(message: string, debug?: LlmDebug) {
    super(message);
    this.name = 'LlmInvokeError';
    this.debug = debug;
  }
}

function buildChatPayload(params: {
  modelId: string;
  system: string;
  userContent: string;
  temperature?: number | null;
  topP?: number | null;
  maxTokens: number;
  responseFormat?: any | null;
  tools?: any[] | null;
}) {
  const payload: any = {
    model: params.modelId,
    messages: [
      { role: 'system', content: params.system || 'You are a LiquidAIty agent.' },
      { role: 'user', content: params.userContent },
    ],
    max_tokens: params.maxTokens,
  };
  if (typeof params.temperature === 'number') {
    payload.temperature = params.temperature;
  }
  if (typeof params.topP === 'number') {
    payload.top_p = params.topP;
  }
  if (params.responseFormat) {
    payload.response_format = params.responseFormat;
  }
  if (params.tools) {
    payload.tools = params.tools;
  }
  return payload;
}

function isValidAgentType(agentType: string): agentType is AgentType {
  return VALID_AGENT_TYPES.includes(agentType as AgentType);
}

function missingFromResolveError(message: string): string[] | null {
  const missing: string[] = [];
  if (message.includes('_prompt_missing')) missing.push('prompt_template');
  if (message.includes('_model_missing')) missing.push('model_key');
  if (missing.length) {
    missing.push('provider');
    return missing;
  }
  return null;
}


async function invokeLlmWithDebug(params: {
  modelKey: string;
  system: string;
  userContent: string;
  temperature?: number | null;
  topP?: number | null;
  maxTokens?: number | null;
  previousResponseId?: string | null;
  responseFormat?: any | null;
  tools?: any[] | null;
}): Promise<{ text: string; debug: LlmDebug }> {
  const model = resolveModel(params.modelKey);
  const temperature = params.temperature;
  const topP = params.topP;
  const max_tokens = params.maxTokens;
  const responseFormat = params.responseFormat ?? null;
  const tools = params.tools ?? null;
  if (typeof max_tokens !== 'number') {
    throw new LlmInvokeError('missing_config: max_tokens');
  }
  const timeout = Number(process.env.REQUEST_TIMEOUT_MS ?? 20000);

  const payload = buildChatPayload({
    modelId: model.id,
    system: params.system,
    userContent: params.userContent,
    temperature,
    topP,
    maxTokens: max_tokens,
    responseFormat,
    tools,
  });

  const requestDebug = {
    provider: model.provider,
    url: '',
    payload,
  };

  if (model.provider === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || !apiKey.trim()) {
      throw new LlmInvokeError('provider_key_missing: provider=openai');
    }
    const base = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    const url = `${base.replace(/\/+$/, '')}/responses`;
    const allowHosts = (process.env.ALLOW_HOSTS_OPENAI || 'api.openai.com')
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean);
    requestDebug.url = url;

    const started = Date.now();
    try {
      const responsePayload = buildResponsesPayload({
        model: model.id,
        input: buildResponsesInput(params.system, params.userContent),
        response_format: responseFormat ?? undefined,
        tools: tools ?? undefined,
        temperature: typeof temperature === 'number' ? temperature : undefined,
        top_p: typeof topP === 'number' ? topP : undefined,
        max_output_tokens: max_tokens,
        previous_response_id: params.previousResponseId ?? undefined,
      });
      requestDebug.payload = responsePayload;
      const res = await safeFetch(
        url,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(responsePayload),
          timeoutMs: timeout,
          allowHosts,
        },
      );

      const elapsed_ms = Date.now() - started;
      const request_id = res.headers.get('x-request-id') || res.headers.get('request-id') || null;
      const raw = await res.text();
      let parsed: any = null;
      try {
        parsed = raw ? JSON.parse(raw) : null;
      } catch {
        parsed = raw;
      }

      const debug: LlmDebug = {
        provider: model.provider,
        model: model.id,
        endpoint: new URL(url).pathname,
        request: responsePayload,
        response: res.ok ? parsed : null,
        error: res.ok ? null : parsed,
        elapsed_ms,
        request_id,
        finish_reason: res.ok ? extractResponsesFinishReason(parsed) : null,
        usage: res.ok ? (parsed?.usage ?? null) : null,
      };

      if (!res.ok) {
        throw new LlmInvokeError(`provider_error: HTTP ${res.status}`, debug);
      }

      const text = extractResponsesText(parsed);
      return { text, debug };
    } catch (err: any) {
      if (err instanceof LlmInvokeError) throw err;
      throw new LlmInvokeError(err?.message || 'openai_request_failed', {
        provider: model.provider,
        model: model.id,
        endpoint: new URL(url).pathname,
        request: requestDebug.payload,
        response: null,
        error: err,
        elapsed_ms: null,
        request_id: null,
      });
    }
  }

  if (model.provider === 'openrouter') {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey || !apiKey.trim()) {
      throw new LlmInvokeError('provider_key_missing: provider=openrouter');
    }
    const base = process.env.OPENROUTER_BASE_URL || 'https://api.openrouter.ai';
    const url = `${base.replace(/\/+$/, '')}/chat/completions`;
    const allowHosts = (process.env.ALLOW_HOSTS_OPENROUTER || 'api.openrouter.ai,openrouter.ai')
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean);
    requestDebug.url = url;

    const started = Date.now();
    try {
      const res = await safeFetch(
        url,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          timeoutMs: timeout,
          allowHosts,
        },
      );

      const elapsed_ms = Date.now() - started;
      const request_id = res.headers.get('x-request-id') || res.headers.get('request-id') || null;
      const raw = await res.text();
      let parsed: any = null;
      try {
        parsed = raw ? JSON.parse(raw) : null;
      } catch {
        parsed = raw;
      }

      const debug: LlmDebug = {
        provider: model.provider,
        model: model.id,
        endpoint: new URL(url).pathname,
        request: requestDebug.payload,
        response: res.ok ? parsed : null,
        error: res.ok ? null : parsed,
        elapsed_ms,
        request_id,
        finish_reason: res.ok ? (parsed?.choices?.[0]?.finish_reason ?? null) : null,
        usage: res.ok ? (parsed?.usage ?? null) : null,
      };

      if (!res.ok) {
        throw new LlmInvokeError(`provider_error: HTTP ${res.status}`, debug);
      }

      const text = parsed?.choices?.[0]?.message?.content ?? '';
      return { text, debug };
    } catch (err: any) {
      if (err instanceof LlmInvokeError) throw err;
      throw new LlmInvokeError(err?.message || 'openrouter_request_failed', {
        provider: model.provider,
        model: model.id,
        endpoint: new URL(url).pathname,
        request: requestDebug.payload,
        response: null,
        error: err,
        elapsed_ms: null,
        request_id: null,
      });
    }
  }

  throw new LlmInvokeError(`provider_not_supported: ${model.provider}`);
}

router.post('/:projectId/agent_builder/chat', async (req, res) => {
  const projectId = req.params.projectId;
  const { message } = req.body || {};

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ ok: false, error: 'message is required' });
  }

  try {
    const resolved = await resolveAgentConfig(projectId, 'agent_builder', '/api/v2/projects/:projectId/agent_builder/chat');
    if (!resolved) {
      return res.status(404).json({ ok: false, error: 'agent_not_found' });
    }

    const { text, debug } = await invokeLlmWithDebug({
      modelKey: resolved.modelKey,
      system: resolved.systemPrompt,
      userContent: message,
      temperature: resolved.temperature ?? undefined,
      topP: resolved.topP ?? undefined,
      maxTokens: resolved.maxTokens ?? undefined,
      previousResponseId: resolved.previousResponseId ?? undefined,
      responseFormat: resolved.responseFormat ?? undefined,
      tools: resolved.tools ?? undefined,
    });

    return res.json({ ok: true, text, debug });
  } catch (err: any) {
    const missing = missingFromResolveError(String(err?.message || ''));
    if (missing) {
      return res.status(409).json({ ok: false, error: 'missing_config', missing });
    }
    if (err instanceof LlmInvokeError) {
      return res.status(500).json({
        ok: false,
        error: err.message,
        debug: err.debug,
      });
    }
    console.error('[AGENT_BUILDER_CHAT] failed', err);
    return res.status(500).json({ ok: false, error: err?.message || 'agent_builder_chat_failed' });
  }
});

router.post('/:projectId/agents/:agentType/test', async (req, res) => {
  const projectId = req.params.projectId;
  const agentType = req.params.agentType;
  const { input } = req.body || {};

  if (!agentType || !isValidAgentType(agentType)) {
    return res.status(400).json({ ok: false, error: 'invalid_agent_type' });
  }
  if (!input || typeof input !== 'string') {
    return res.status(400).json({ ok: false, error: 'input is required' });
  }

  try {
    const resolved = await resolveAgentConfig(projectId, agentType, '/api/v2/projects/:projectId/agents/:agentType/test');
    if (!resolved) {
      return res.status(404).json({ ok: false, error: 'agent_not_found' });
    }

    const { text, debug } = await invokeLlmWithDebug({
      modelKey: resolved.modelKey,
      system: resolved.systemPrompt,
      userContent: input,
      temperature: resolved.temperature ?? undefined,
      topP: resolved.topP ?? undefined,
      maxTokens: resolved.maxTokens ?? undefined,
      previousResponseId: resolved.previousResponseId ?? undefined,
      responseFormat: resolved.responseFormat ?? undefined,
      tools: resolved.tools ?? undefined,
    });

    return res.json({
      ok: true,
      debug,
      outputText: text,
    });
  } catch (err: any) {
    const missing = missingFromResolveError(String(err?.message || ''));
    if (missing) {
      return res.status(409).json({ ok: false, error: 'missing_config', missing });
    }
    if (err instanceof LlmInvokeError) {
      return res.status(500).json({
        ok: false,
        error: err.message,
        debug: err.debug,
      });
    }
    console.error('[AGENT_TEST] failed', err);
    return res.status(500).json({ ok: false, error: err?.message || 'agent_test_failed' });
  }
});

export default router;
