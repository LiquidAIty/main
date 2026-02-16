export type KgIngestQueueJob = {
  projectId: string;
  doc_id: string;
  src: string;
  mode: string;
  user_text: string;
  assistant_text: string;
};

type Worker = (job: KgIngestQueueJob) => Promise<void>;

const queue: KgIngestQueueJob[] = [];
const queuedKeys = new Set<string>();
let worker: Worker | null = null;
let workerInterval: NodeJS.Timeout | null = null;
let running = false;

function keyFor(job: KgIngestQueueJob): string {
  return `${job.projectId}:${job.doc_id}`;
}

async function tick() {
  if (running || !worker) return;
  const job = queue.shift();
  if (!job) return;

  running = true;
  const key = keyFor(job);
  queuedKeys.delete(key);
  try {
    await worker(job);
  } catch (err: any) {
    console.error('[KG_V2][WORK] crash', {
      projectId: job.projectId,
      doc_id: job.doc_id,
      error: err?.message || String(err),
    });
  } finally {
    running = false;
  }
}

function startLoop() {
  if (workerInterval) return;
  workerInterval = setInterval(() => {
    void tick();
  }, 250);
}

export function registerKgIngestWorker(fn: Worker) {
  worker = fn;
  startLoop();
}

export function enqueueKgIngestJob(job: KgIngestQueueJob): { queued: boolean } {
  const key = keyFor(job);
  if (queuedKeys.has(key)) {
    return { queued: false };
  }
  queuedKeys.add(key);
  queue.push(job);
  return { queued: true };
}

