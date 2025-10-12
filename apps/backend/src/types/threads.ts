export type ThreadEvent =
  | { type: "hello"; threadId: string; ok: true; [k: string]: unknown }
  | { type: "update"; threadId: string; phase?: string; token?: string; tool?: string; [k: string]: unknown }
  | { type: "done"; threadId: string; status?: string; [k: string]: unknown };
