import express from "express";
import cookieParser = require("cookie-parser");
import routes from "./routes";

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser() as any);

function logStartupBanner() {
  const nodeEnv = process.env.NODE_ENV || "development";
  const model = process.env.OPENAI_MODEL || "gpt-5.1-chat-latest";
  const baseUrl = process.env.OPENAI_BASE_URL || "(default)";
  const apiKey = process.env.OPENAI_API_KEY || "";
  const redactedKey = apiKey.length > 8 ? `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}` : "(not set)";

  console.log("──────────────── SOL BACKEND START ────────────────");
  console.log(`NODE_ENV:         ${nodeEnv}`);
  console.log(`SOL model:        ${model}`);
  console.log(`OPENAI_BASE_URL:  ${baseUrl}`);
  console.log(`OPENAI_API_KEY:   ${redactedKey}`);
  console.log("───────────────────────────────────────────────────");
}

// Mount all routes under /api
app.use("/api", routes);

const PORT = Number(process.env.PORT || 4000);
logStartupBanner();
app.listen(PORT, () => console.log("[BOOT] listening on :" + PORT));

// Add final error middleware to surface stack as JSON
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[ERROR]", err?.stack || err);
  res.status(500).json({ ok: false, error: String(err?.message || err) });
});
