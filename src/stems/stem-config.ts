// Base URL for the local stem service. Default is localhost; overridable via
// localStorage (e.g. a Codespaces HTTPS URL) without touching code.
export const STEM_SERVICE_DEFAULT_URL = 'http://localhost:8765';
const LS_KEY = 'loomStemServiceUrl';

function readLocalStorage(): string | undefined {
  try { return localStorage.getItem(LS_KEY) ?? undefined; } catch { return undefined; }
}

/** Resolve the base URL (no trailing slash). `override` wins over localStorage. */
export function stemServiceBaseUrl(opts: { override?: string } = {}): string {
  const raw = opts.override ?? readLocalStorage() ?? STEM_SERVICE_DEFAULT_URL;
  return raw.replace(/\/+$/, '');
}
