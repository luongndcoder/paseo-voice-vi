import type { Job } from "../shared/contract.ts";

let current: Job | null = null;
let running = false;

export function jobSnapshot(): Job | null {
  return current ? { ...current } : null;
}

export function isJobRunning(): boolean {
  return running;
}

export async function runJob(
  kind: Job["kind"],
  work: (update: (message: string) => void) => Promise<string>,
): Promise<Job> {
  if (running && current) return { ...current };
  running = true;
  const job: Job = {
    id: `${kind}-${Date.now()}`,
    kind,
    state: "running",
    message: kind === "download-model" ? "Starting model download…" : "Starting worker self-test…",
    startedAt: Date.now(),
  };
  current = { ...job };
  try {
    const message = await work((text) => {
      current = { ...job, state: "running", message: text };
    });
    current = { ...job, state: "succeeded", message, finishedAt: Date.now() };
  } catch (error) {
    current = {
      ...job,
      state: "failed",
      message: error instanceof Error ? error.message : String(error),
      finishedAt: Date.now(),
    };
  } finally {
    running = false;
  }
  return { ...(current as Job) };
}
