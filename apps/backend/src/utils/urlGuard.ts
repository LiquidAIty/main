import { isIP } from 'node:net';

const PRIVATE_IPV4_RANGES = [
  { prefix: '10.' },
  { prefix: '127.' },
  { prefix: '169.254.' },
  { prefix: '192.168.' },
  { prefix: '172.', range: [16, 31] }
];

function isPrivateIp(host: string): boolean {
  if (!isIP(host)) return false;
  if (host.includes(':')) return true; // treat IPv6 as private by default unless allowlisted
  if (PRIVATE_IPV4_RANGES.some(r => host.startsWith(r.prefix))) {
    if (host.startsWith('172.')) {
      const second = Number(host.split('.')[1] ?? NaN);
      return !Number.isNaN(second) && second >= 16 && second <= 31;
    }
    return true;
  }
  return false;
}

const defaultBlockedHosts = ['localhost', '127.0.0.1'];

export function assertUrlAllowed(rawUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Invalid URL provided');
  }

  const allowList = (process.env.INGEST_URL_ALLOWLIST || '')
    .split(',')
    .map(x => x.trim().toLowerCase())
    .filter(Boolean);

  const host = parsed.hostname.toLowerCase();

  if (allowList.length > 0) {
    if (!allowList.includes(host)) {
      throw new Error(`URL host "${host}" is not in allowlist`);
    }
    return;
  }

  if (defaultBlockedHosts.includes(host)) {
    throw new Error(`URL host "${host}" is blocked`);
  }

  if (isPrivateIp(host)) {
    throw new Error(`URL host "${host}" resolves to a private network`);
  }
}
