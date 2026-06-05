// Pure-ish typed wrapper over the stem-service HTTP contract. All network calls
// go through an injected fetch so it is unit-testable. Network failures (service
// not running) surface as StemServiceUnreachable so the UI can show a clear hint.

export type StemName = 'vocals' | 'drums' | 'bass' | 'other';

export interface StemRef { name: string; url: string; }

export interface JobStatus {
  status: 'queued' | 'running' | 'done' | 'error';
  progress: number | null;
  stems?: StemRef[];
  error?: string;
}

export class StemServiceUnreachable extends Error {
  constructor(public readonly baseUrl: string, cause?: unknown) {
    super(`Stem service unreachable at ${baseUrl}`);
    this.name = 'StemServiceUnreachable';
    (this as { cause?: unknown }).cause = cause;
  }
}

type FetchFn = typeof fetch;

export class StemClient {
  constructor(private readonly baseUrl: string, private readonly fetchFn: FetchFn = fetch) {}

  private async req(path: string, init?: RequestInit): Promise<Response> {
    try {
      return await this.fetchFn(`${this.baseUrl}${path}`, init ?? {});
    } catch (cause) {
      throw new StemServiceUnreachable(this.baseUrl, cause);
    }
  }

  async health(): Promise<{ ok: boolean; model: string }> {
    const r = await this.req('/health');
    if (!r.ok) throw new StemServiceUnreachable(this.baseUrl);
    return r.json();
  }

  async createJob(file: File): Promise<string> {
    const body = new FormData();
    body.append('file', file, file.name);
    const r = await this.req('/jobs', { method: 'POST', body });
    if (!r.ok) throw new Error(`createJob failed: HTTP ${r.status}`);
    return (await r.json()).jobId as string;
  }

  async getJob(jobId: string): Promise<JobStatus> {
    const r = await this.req(`/jobs/${jobId}`);
    if (!r.ok) throw new Error(`getJob failed: HTTP ${r.status}`);
    return r.json() as Promise<JobStatus>;
  }

  async cancelJob(jobId: string): Promise<void> {
    try { await this.req(`/jobs/${jobId}`, { method: 'DELETE' }); } catch { /* best-effort */ }
  }

  /** Resolve a (possibly relative) stem url returned by the service against the base. */
  stemUrl(url: string): string {
    return /^https?:\/\//i.test(url) ? url : `${this.baseUrl}${url}`;
  }
}
