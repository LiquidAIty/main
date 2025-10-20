import express from "express";
import solRoutes from "./routes/sol.routes";

const app = express();
app.use(express.json({ limit: "2mb" }));

// Mount order: health first, then /api/sol
app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/sol", solRoutes);

const PORT = Number(process.env.PORT || 4000);
app.listen(PORT, () => console.log("[BOOT] listening on :" + PORT));

// Add final error middleware to surface stack as JSON
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[ERROR]", err?.stack || err);
  res.status(500).json({ ok: false, error: String(err?.message || err) });
});
