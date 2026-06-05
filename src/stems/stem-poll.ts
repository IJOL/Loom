import type { JobStatus } from './stem-client';

export interface PollOptions {
  onProgress?: (status: JobStatus['status'], progress: number | null) => void;
  signal?: AbortSignal;
  intervalMs?: number;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
  });

/** Poll getJob() until the job reaches a terminal state. Resolves with the `done`
 *  status, rejects on `error` (message = backend error) or on abort. */
export async function pollJob(
  getJob: () => Promise<JobStatus>,
  opts: PollOptions = {},
): Promise<JobStatus> {
  const interval = opts.intervalMs ?? 1000;
  for (;;) {
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const status = await getJob();
    opts.onProgress?.(status.status, status.progress);
    if (status.status === 'done') return status;
    if (status.status === 'error') throw new Error(status.error || 'separation failed');
    await sleep(interval, opts.signal);
  }
}
