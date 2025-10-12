import { Router } from "express";
import { randomUUID } from "crypto";
import { EventEmitter } from "node:events";
import { z } from "zod";
import { runOrchestrator } from "../agents/lang/orchestratorGraph";
import type { ThreadEvent } from "../types/threads";

type Msg = { role: "user" | "assistant" | "tool"; content: string };
type ThreadState = { threadId: string; messages: Msg[]; status?: string; result?: string; plan?: string; loops?: number };

// TODO: Replace with Prisma/Postgres persistence - see models: Thread(id, state_json, updated_at), Checkpoint(thread_id, step, state_json)
const mem = new Map<string, ThreadState>();

export function getThreadState(id: string): ThreadState {
  return mem.get(id) ?? { threadId: id, messages: [] };
}

export function saveThreadState(id: string, state: ThreadState) {
  mem.set(id, state);
}

export const threadEvents = new EventEmitter();
threadEvents.setMaxListeners(0);

const messageSchema = z.object({ message: z.string().min(1, "Message is required") });

export const threadsRouter = Router();

// POST /threads - Create new thread
threadsRouter.post("/threads", (_req, res) => {
  const id = randomUUID();
  saveThreadState(id, { threadId: id, messages: [] });
  res.json({ ok: true, threadId: id });
});

// GET /threads/:id - Get thread state
threadsRouter.get("/threads/:id", (req, res) => {
  res.json(getThreadState(req.params.id));
});

// POST /threads/:id/runs - Start a new run
threadsRouter.post("/threads/:id/runs", async (req, res) => {
  try {
    const id = req.params.id;
    const parsed = messageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.flatten().fieldErrors });
    }
    const msg = parsed.data.message;
    const st = getThreadState(id);
    st.messages = [...(st.messages ?? []), { role: "user", content: msg }];
    const out = await runOrchestrator(id, st.messages);
    const newState = { ...st, ...out };
    saveThreadState(id, newState);
    threadEvents.emit("update", { type: "update", threadId: id, state: newState } as ThreadEvent);
    return res.json({ ok: true, status: newState.status, result: newState.result, messages: newState.messages });
  } catch (e: unknown) {
    return res.status(500).json({ ok: false, error: e instanceof Error ? e.message : "Unknown error" });
  }
});

// POST /threads/:id/resume - Resume with user feedback (HITL)
threadsRouter.post("/threads/:id/resume", async (req, res) => {
  try {
    const id = req.params.id;
    const parsed = messageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.flatten().fieldErrors });
    }
    const msg = parsed.data.message;
    const st = getThreadState(id);
    st.messages = [...(st.messages ?? []), { role: "user", content: msg }];
    const out = await runOrchestrator(id, st.messages);
    const newState = { ...st, ...out };
    saveThreadState(id, newState);
    threadEvents.emit("update", { type: "update", threadId: id, state: newState } as ThreadEvent);
    return res.json({ ok: true, status: newState.status, result: newState.result, messages: newState.messages });
  } catch (e: unknown) {
    return res.status(500).json({ ok: false, error: e instanceof Error ? e.message : "Unknown error" });
  }
});

export default threadsRouter;
export type { ThreadState };
