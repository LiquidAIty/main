import { Router } from "express";
import { pingNeo4j } from "../connectors/neo4j";
import { pingEsn } from "../connectors/esn";

const router = Router();

router.get("/", (_req, res) => {
  res.json({ status: "ok" });
});

router.get("/health", async (_req, res) => {
  const out: { ok: boolean; neo4j?: string; esn?: string } = { ok: true };

  try {
    out.neo4j = await pingNeo4j();
  } catch {
    out.neo4j = "down";
    out.ok = false;
  }

  try {
    out.esn = await pingEsn();
  } catch {
    out.esn = "down";
    out.ok = false;
  }

  res.json(out);
});

export default router;
