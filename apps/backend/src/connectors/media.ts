import { safeFetch } from "../security/safeFetch";
import { assertUrlAllowed } from "../security/urlGuard";

const ALLOW_MEDIA = (process.env.ALLOW_HOSTS_MEDIA ?? "raw.githubusercontent.com,github.com,cdn.jsdelivr.net,cdn.yourdomain.com")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

export async function fetchBinary(url: string): Promise<Uint8Array> {
  await assertUrlAllowed(url, { allowHosts: ALLOW_MEDIA });
  const res = await safeFetch(url, { allowHosts: ALLOW_MEDIA, timeoutMs: 12_000 });
  if (!res.ok) {
    throw new Error(`Media ${res.status} ${res.statusText}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

export async function fetchText(url: string): Promise<string> {
  await assertUrlAllowed(url, { allowHosts: ALLOW_MEDIA });
  const res = await safeFetch(url, { allowHosts: ALLOW_MEDIA, timeoutMs: 12_000 });
  if (!res.ok) {
    throw new Error(`Media ${res.status} ${res.statusText}`);
  }
  return res.text();
}
