import { Router, Request, Response } from "express";

const router = Router();

// POST /api/sol/run → forwards to volt-svc :3141
router.post("/run", async (req: Request, res: Response) => {
  try {
    const raw = req.body?.goal;
    const goal = typeof raw === "string" ? raw.trim() : "";
    if (!goal) return res.status(400).json({ ok: false, error: "goal is required" });

    const r = await fetch("http://localhost:3141/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal }),
    });

    // Read the response body once and store it
    let responseBody;
    const contentType = r.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      responseBody = await r.json().catch(() => ({ error: "Invalid JSON response" }));
    } else {
      responseBody = await r.text().catch(() => "Unable to read response");
    }

    if (!r.ok) {
      return res.status(502).json({
        ok: false,
        status: r.status,
        from: "volt-svc",
        body: responseBody
      });
    }
    return res.json(responseBody);
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

export default router;
