import dns from "node:dns/promises";
import net from "node:net";

const PRIVATE_V4: Array<[string, string]> = [
  ["10.0.0.0", "10.255.255.255"],
  ["172.16.0.0", "172.31.255.255"],
  ["192.168.0.0", "192.168.255.255"],
  ["127.0.0.0", "127.255.255.255"],
];

const LOOPBACK_V6 = "::1";
const CLOUD_METADATA_HOSTS = new Set([
  "169.254.169.254",
  "169.254.169.253",
  "169.254.170.2",
  "169.254.169.250",
  "169.254.169.251",
  "169.254.169.252",
  "metadata.google.internal",
  "instance-data",
  "100.100.100.200",
].map(h => h.toLowerCase()));

const allowPrivate = (process.env.ALLOW_PRIVATE_NETWORK ?? "false").toLowerCase() === "true";
const allowLoopback = (process.env.ALLOW_LOOPBACK ?? "false").toLowerCase() === "true";

function ipToNum(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function inRange(ip: string, [start, end]: [string, string]): boolean {
  const value = ipToNum(ip);
  const min = ipToNum(start);
  const max = ipToNum(end);
  return value >= min && value <= max;
}

function stripBrackets(host: string): string {
  return host.replace(/^\[/, "").replace(/\]$/, "");
}

function isLoopbackV4(ip: string): boolean {
  return ip.startsWith("127.");
}

function isLoopbackHost(host: string): boolean {
  const normalized = stripBrackets(host).toLowerCase();
  return normalized === "localhost" || normalized === "::1" || normalized === "0:0:0:0:0:0:0:1" || normalized.startsWith("127.");
}

function isPrivateIPv6(address: string): boolean {
  return address.toLowerCase().startsWith("fc") || address.toLowerCase().startsWith("fd") || address.toLowerCase().startsWith("fe80");
}

function isCloudMetadataHost(host: string): boolean {
  const normalized = stripBrackets(host).toLowerCase();
  return CLOUD_METADATA_HOSTS.has(normalized);
}

export type FetchPolicy = "STRICT" | "PUBLIC" | "OPEN";

const DEFAULT_POLICY = (process.env.URL_POLICY ?? "PUBLIC").toUpperCase() as FetchPolicy;

export async function assertUrlAllowed(
  rawUrl: string,
  opts: { allowHosts?: string[]; policy?: FetchPolicy } = {}
): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL");
  }

  const policy = opts.policy ?? DEFAULT_POLICY;
  const scheme = parsed.protocol.replace(":", "").toLowerCase();

  if (!["http", "https"].includes(scheme)) {
    if (policy !== "OPEN") {
      throw new Error(`Blocked scheme: ${scheme}`);
    }
    return;
  }

  if (policy === "OPEN") {
    return;
  }

  const hostname = parsed.hostname;
  const normalizedHost = stripBrackets(hostname).toLowerCase();

  if (isCloudMetadataHost(normalizedHost)) {
    throw new Error("Metadata service blocked");
  }

  if (isLoopbackHost(normalizedHost) && !allowLoopback) {
    throw new Error("Loopback blocked");
  }

  let address = normalizedHost;
  if (!net.isIP(normalizedHost)) {
    try {
      const lookupResult = await dns.lookup(hostname, { family: 0 });
      address = lookupResult.address;
    } catch {
      // If DNS lookup fails, fall back to host string for allowlist checks.
      address = normalizedHost;
    }
  }

  if (net.isIPv4(address)) {
    if (isLoopbackV4(address) && !allowLoopback) {
      throw new Error("Loopback blocked");
    }
    if (!allowPrivate && PRIVATE_V4.some(range => inRange(address, range)) && !isLoopbackV4(address)) {
      throw new Error("Private network blocked");
    }
  } else if (net.isIPv6(address)) {
    if (address === LOOPBACK_V6 && !allowLoopback) {
      throw new Error("Loopback blocked");
    }
    if (!allowPrivate && isPrivateIPv6(address)) {
      throw new Error("Private network blocked");
    }
  }

  if (policy === "STRICT" && opts.allowHosts?.length) {
    const allowed = opts.allowHosts.some(host => host.trim().toLowerCase() === normalizedHost);
    if (!allowed) {
      throw new Error(`Host not allowlisted: ${hostname}`);
    }
  }
}
