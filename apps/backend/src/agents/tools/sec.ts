import { z } from "zod";

const SecSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("company_submissions"), cikOrTicker: z.string() }),
  z.object({
    op: z.literal("company_filings"),
    cikOrTicker: z.string(),
    form: z.string().optional(),
    limit: z.number().default(10),
  }),
  z.object({ op: z.literal("fetch_document"), url: z.string().url() }),
]);

type SecResult = {
  ok: boolean;
  data: unknown;
  error: string | null;
};

async function secFetch(url: string): Promise<SecResult> {
  const response = await fetch(url, {
    headers: {
      "user-agent": process.env.SEC_USER_AGENT || "liquidai@example.com",
    },
  });
  if (!response.ok) {
    return { ok: false, data: null, error: `SEC ${response.status}` };
  }
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json()
    : await response.text();
  return { ok: true, data, error: null };
}

function normalizeTicker(input: string) {
  return input.trim().toUpperCase();
}

function padCik(id: string) {
  return id.replace(/^CIK/i, "CIK").replace(/[^0-9]/g, "").padStart(10, "0");
}

function buildSubmissionsUrl(cikOrTicker: string) {
  const id = normalizeTicker(cikOrTicker);
  if (id.startsWith("CIK")) {
    const numeric = padCik(id);
    return `https://data.sec.gov/submissions/CIK${numeric}.json`;
  }
  return "https://www.sec.gov/files/company_tickers.json";
}

function buildFilingsUrl(cikOrTicker: string, limit: number) {
  const query = encodeURIComponent(cikOrTicker);
  const size = Math.min(Math.max(limit, 1), 200);
  return `https://data.sec.gov/api/search?keys=${query}&from=0&size=${size}`;
}

export const secTool = {
  name: "sec",
  run: async (raw: unknown) => {
    const params = SecSchema.parse(raw);
    if (params.op === "company_submissions") {
      const url = buildSubmissionsUrl(params.cikOrTicker);
      return secFetch(url);
    }
    if (params.op === "company_filings") {
      const url = buildFilingsUrl(params.cikOrTicker, params.limit);
      return secFetch(url);
    }
    if (params.op === "fetch_document") {
      return secFetch(params.url);
    }
    return { ok: false, data: null, error: "unsupported op" };
  },
};

export { SecSchema };
