import { Router } from "express";
import { threadEvents } from "./threads.routes";
import type { ThreadEvent } from "../types/threads";

const router = Router();

router.get("/stream/:threadId", (req, res) => {
  const { threadId } = req.params;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const keepAlive = setInterval(() => {
    res.write(":\n\n");
  }, 15000);

  const send = (type: string, data: unknown) => {
    res.write(`event: ${type}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  send("hello", { type: "hello", threadId, ok: true } satisfies ThreadEvent);

  const onUpdate = (evt: ThreadEvent) => {
    if (!evt || evt.threadId !== threadId) return;
    send(evt.type, evt);
  };

  threadEvents.on("update", onUpdate);

  req.on("close", () => {
    clearInterval(keepAlive);
    threadEvents.off("update", onUpdate);
    res.end();
  });
});

export default router;
