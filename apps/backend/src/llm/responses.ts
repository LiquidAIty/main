export type ResponsesPayloadParams = {
  model: string;
  input: any;
  response_format?: any;
  tools?: any;
  temperature?: number;
  top_p?: number;
  max_output_tokens: number;
  previous_response_id?: string | null;
};

function supportsSamplingParams(model: string): boolean {
  const m = String(model || '').toLowerCase();
  // GPT-5 chat/reasoning family does not accept temperature/top_p on Responses.
  if (/^gpt-5(?:[.-]|$)/.test(m)) return false;
  return true;
}

function normalizeTextFormat(responseFormat: any) {
  if (!responseFormat || typeof responseFormat !== 'object') return responseFormat;
  const format =
    (responseFormat.text && typeof responseFormat.text === 'object' && responseFormat.text.format) ||
    responseFormat.format ||
    responseFormat;

  if (!format || typeof format !== 'object') return format;
  if (format.type === 'text') return { type: 'text' };

  const legacy = format.json_schema && typeof format.json_schema === 'object'
    ? format.json_schema
    : null;
  const isJsonSchemaLike =
    format.type === 'json_schema' ||
    legacy !== null ||
    Object.prototype.hasOwnProperty.call(format, 'schema');

  if (!isJsonSchemaLike) return format;

  const name =
    (typeof format.name === 'string' && format.name.trim()) ||
    (typeof legacy?.name === 'string' && legacy.name.trim()) ||
    'structured_output';
  const schema =
    format.schema ??
    legacy?.schema ??
    {};
  const strict =
    typeof format.strict === 'boolean'
      ? format.strict
      : typeof legacy?.strict === 'boolean'
        ? legacy.strict
        : true;

  return {
    type: 'json_schema',
    name,
    schema,
    strict,
  };
}

export function buildResponsesPayload(params: ResponsesPayloadParams) {
  const payload: any = {
    model: params.model,
    input: params.input,
    max_output_tokens: params.max_output_tokens,
  };
  if (params.response_format !== undefined) {
    payload.text = { format: normalizeTextFormat(params.response_format) };
  }
  if (params.tools !== undefined) payload.tools = params.tools;
  if (supportsSamplingParams(params.model)) {
    if (typeof params.temperature === 'number') payload.temperature = params.temperature;
    if (typeof params.top_p === 'number') payload.top_p = params.top_p;
  }
  if (typeof params.previous_response_id === 'string' && params.previous_response_id.trim()) {
    payload.previous_response_id = params.previous_response_id.trim();
  }
  return payload;
}

export function buildTextInput(role: string, text: string) {
  return {
    role,
    content: [{ type: 'input_text', text }],
  };
}

export function buildResponsesInput(system: string, user: string) {
  const input: any[] = [];
  if (typeof system === 'string' && system.trim()) {
    input.push(buildTextInput('system', system));
  }
  input.push(buildTextInput('user', user));
  return input;
}

export function extractResponsesText(raw: any): string {
  if (typeof raw?.output_text === 'string') return raw.output_text;
  const output = raw?.output;
  if (!Array.isArray(output)) return '';
  const chunks: string[] = [];
  for (const item of output) {
    if (!item) continue;
    if (item.type === 'output_text' && typeof item.text === 'string') {
      chunks.push(item.text);
      continue;
    }
    const content = Array.isArray(item.content) ? item.content : [];
    for (const part of content) {
      if (!part) continue;
      if (typeof part.text === 'string') {
        chunks.push(part.text);
      }
    }
  }
  return chunks.join('');
}

export function extractResponsesFinishReason(raw: any): string | null {
  const first = Array.isArray(raw?.output) ? raw.output[0] : null;
  return (
    first?.finish_reason ??
    first?.stop_reason ??
    first?.status ??
    raw?.finish_reason ??
    null
  );
}
