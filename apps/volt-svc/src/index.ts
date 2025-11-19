// LEGACY: volt-svc is optional. /api/sol/run now calls Sol directly without this proxy.
// Minimal VoltAgent HTTP service on :3141
import { Agent } from "@voltagent/core";
import { openai } from "@ai-sdk/openai";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SYSTEM =
  "Be concise. No placeholders. If something cannot be verified, say 'not verified'.";

const PORT = Number(process.env.VOLT_PORT || 3141);

// Load env from multiple candidate paths and LOG which file was actually used
const envPaths = [
  join(process.cwd(), ".env"),
  join(process.cwd(), "apps", "backend", ".env"),
  // Use absolute path to backend .env
  "c:/Projects/LiquidAIty/main/apps/backend/.env",
  // Alternative absolute path formats
  "/Projects/LiquidAIty/main/apps/backend/.env",
  join(__dirname, "..", "..", "backend", ".env"), // for dist
  join(__dirname, "..", "backend", ".env")         // for ts-node/tsx
];

let envLoadedFrom: string | null = null;
for (const path of envPaths) {
  try {
    const result = dotenv.config({ path });
    if (result && !result.error) {
      envLoadedFrom = path;
      break;
    }
  } catch (error) {
    // Path doesn't exist or can't be loaded, continue to next
  }
}

console.log("[VOLT-SVC] env loaded from:", envLoadedFrom || "none");

// Force load the specific backend .env file if others failed
if (!envLoadedFrom) {
  try {
    dotenv.config({ path: "c:/Projects/LiquidAIty/main/apps/backend/.env" });
    envLoadedFrom = "c:/Projects/LiquidAIty/main/apps/backend/.env";
    console.log("[VOLT-SVC] fallback: loaded backend .env");
  } catch (error) {
    console.log("[VOLT-SVC] failed to load backend .env:", error);
  }
}

// Make backend .env override anything loaded earlier:
dotenv.config({ path: join(process.cwd(), "apps", "backend", ".env"), override: true });

const modelName = (process.env.OPENAI_MODEL || "gpt-5").trim();
console.log("[VOLT-SVC] model:", modelName);

// Prefer @voltagent/server-hono if available; otherwise use 'hono' directly.
let start = async () => {
  try {
    const { Hono } = await import("hono");
    const { serve } = await import("@hono/node-server");
    const app = new Hono();

    app.get("/health", (c) => c.json({ ok: true, service: "volt-svc" }));

    app.post("/run", async (c) => {
      // Check for OPENAI_API_KEY
      if (!process.env.OPENAI_API_KEY) {
        return c.json({ ok: false, error: "OPENAI_API_KEY missing in volt-svc process" }, 500);
      }

      const body = await c.req.json().catch(() => ({}));
      const goal = typeof body?.goal === "string" ? body.goal.trim() : "";
      if (!goal) return c.json({ ok: false, error: "goal is required" }, 400);

      try {
        const agent = new Agent({ name: "SOL", instructions: SYSTEM, model: openai(modelName) });
        // ✅ VoltAgent Agent API: generateText -> { text }
        const result: any = await agent.generateText(goal);
        const text = result?.text ?? "";
        if (!text) return c.json({ ok: false, error: "empty agent response" }, 502);

        return c.json({ ok: true, text });
      } catch (err: any) {
        return c.json({
          ok: false,
          error: String(err?.message || err),
          stack: err?.stack || "no stack"
        }, 500);
      }
    });

    serve({ fetch: app.fetch, port: PORT });
    console.log(`[VOLT-SVC] listening on :${PORT}`);
  } catch (e) {
    console.error("[VOLT-SVC] boot error:", e);
    process.exit(1);
  }
};

start();
