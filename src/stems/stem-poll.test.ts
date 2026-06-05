import { describe, it, expect, vi } from 'vitest';
import { pollJob } from './stem-poll';
import type { JobStatus } from './stem-client';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('pollJob', () => {
  it('polls until done, forwarding progress, and resolves with the final status', async () => {
    const seq: JobStatus[] = [
      { status: 'queued', progress: null },
      { status: 'running', progress: 0.5 },
      { status: 'done', progress: 1, stems: [{ name: 'vocals', url: '/u' }] },
    ];
    let i = 0;
    const getJob = vi.fn(async () => seq[Math.min(i++, seq.length - 1)]);
    const onProgress = vi.fn();

    const final = await pollJob(getJob, { onProgress, intervalMs: 0 });

    expect(final.status).toBe('done');
    expect(final.stems?.length).toBe(1);
    expect(onProgress).toHaveBeenCalledWith('queued', null);
    expect(onProgress).toHaveBeenCalledWith('running', 0.5);
  });

  it('rejects when the job errors', async () => {
    const getJob = vi.fn(async (): Promise<JobStatus> => ({ status: 'error', progress: null, error: 'boom' }));
    await expect(pollJob(getJob, { intervalMs: 0 })).rejects.toThrow('boom');
  });

  it('stops polling when the signal aborts', async () => {
    const ctrl = new AbortController();
    const getJob = vi.fn(async (): Promise<JobStatus> => ({ status: 'running', progress: null }));
    const p = pollJob(getJob, { intervalMs: 0, signal: ctrl.signal });
    await tick();
    ctrl.abort();
    await expect(p).rejects.toThrow(/abort/i);
  });
});
