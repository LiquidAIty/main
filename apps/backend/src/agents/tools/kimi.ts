import type { ToolResult } from '../../types/agent';
import config from '../../config/sol.config.json';
import { safeFetch } from '../../security/safeFetch';
import { assertUrlAllowed, FetchPolicy } from '../../security/urlGuard';

type KimiAttachment = { url?: string } | null | undefined;
type KimiParams = {
  query?: string;
  url?: string;
  sourceUrl?: string;
  attachments?: KimiAttachment[];
};
const rawPolicy = (process.env.URL_POLICY ?? 'PUBLIC').toUpperCase();
const POLICY: FetchPolicy = rawPolicy === 'STRICT' || rawPolicy === 'OPEN' ? (rawPolicy as FetchPolicy) : 'PUBLIC';

const KIMI_ALLOW = (process.env.ALLOW_HOSTS_KIMI ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const KIMI_BASE = (process.env.KIMI_API_BASE ?? 'https://openrouter.ai').replace(/\/+$/, '');
const KIMI_TIMEOUT_MS = Number(process.env.KIMI_TIMEOUT_MS ?? '15000');

function collectUrls(params: KimiParams): string[] {
  const urls: string[] = [];
  if (params.url) urls.push(params.url);
  if (params.sourceUrl) urls.push(params.sourceUrl);
  if (Array.isArray(params.attachments)) {
    for (const attachment of params.attachments) {
      if (attachment?.url) {
        urls.push(attachment.url);
      }
    }
  }
  return urls;
}

export const kimiTool = {
  async run(params: KimiParams = {}): Promise<ToolResult> {
    if (!config.tools?.kimi?.enabled) {
      return {
        jobId: 'stub-kimi',
        status: 'error',
        events: [{ type: 'error', data: { message: 'Kimi tool disabled in config' } }],
        artifacts: [],
      };
    }

    if (!params.query || typeof params.query !== 'string' || params.query.trim().length === 0) {
      return {
        jobId: 'stub-kimi',
        status: 'error',
        events: [{ type: 'error', data: { message: 'Missing query for Kimi tool' } }],
        artifacts: [],
      };
    }

    const urls = collectUrls(params);
    for (const url of urls) {
      await assertUrlAllowed(url, { policy: POLICY, allowHosts: KIMI_ALLOW });
    }

    const message = await kimiRun(params.query);

    return {
      jobId: 'stub-kimi',
      status: 'ok',
      events: [{ type: 'info', data: { message } }],
      artifacts: [],
    };
  },
};

export async function kimiRun(query: string): Promise<string> {
  const apiUrl = `${KIMI_BASE}/api/v1/chat/completions`;

  await assertUrlAllowed(apiUrl, { policy: POLICY, allowHosts: KIMI_ALLOW });

  const response = await safeFetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY ?? ''}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'moonshotai/kimi-k2:free',
      messages: [{ role: 'user', content: query }],
    }),
    timeoutMs: KIMI_TIMEOUT_MS,
    policy: POLICY,
    allowHosts: KIMI_ALLOW,
  });

  if (!response.ok) {
    throw new Error(`Kimi API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? 'No response from Kimi.';
}
