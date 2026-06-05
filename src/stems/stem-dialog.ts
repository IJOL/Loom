import { StemClient, StemServiceUnreachable } from './stem-client';
import { importStems } from './stem-import';

export interface StemDialogDeps {
  ctx: AudioContext;
  client: StemClient;
  addStemLanes: (
    stems: { label: string; sampleId: string; durationSec: number }[],
    opts?: { replace?: boolean },
  ) => void;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fmtElapsed = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

/** Wire the Stems modal. Call once at boot after deps exist. */
export function wireStemDialog(deps: StemDialogDeps): void {
  const modal = $('stems-modal');
  const fileInput = $<HTMLInputElement>('stems-file');
  const runBtn = $<HTMLButtonElement>('stems-run');
  const cancelBtn = $<HTMLButtonElement>('stems-cancel');
  const progress = $('stems-progress');
  const bar = $<HTMLProgressElement>('stems-bar');
  const statusEl = $('stems-status');
  const hint = $('stems-hint');

  let controller: AbortController | null = null;
  let startedAt = 0;

  const close = () => { if (!controller) modal.hidden = true; };
  const setStatus = (msg: string) => { statusEl.textContent = msg; };

  const open = async () => {
    modal.hidden = false;
    progress.hidden = true;
    cancelBtn.hidden = true;
    runBtn.disabled = true;
    fileInput.value = '';
    setStatus('');
    hint.textContent = 'Comprobando el servicio…';
    try {
      await deps.client.health();
      hint.textContent = '4 pistas (voz / batería / bajo / otros) vía el servicio local.';
      runBtn.disabled = !fileInput.files?.length;
    } catch (err) {
      hint.textContent = err instanceof StemServiceUnreachable
        ? 'No encuentro el servicio de stems en localhost:8765. ¿Está arrancado? (ver tools/stem-service/README.md)'
        : 'No se pudo contactar el servicio de stems.';
      runBtn.disabled = true;
    }
  };

  fileInput.addEventListener('change', () => { runBtn.disabled = !fileInput.files?.length; });

  runBtn.addEventListener('click', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    controller = new AbortController();
    startedAt = performance.now();
    runBtn.disabled = true;
    cancelBtn.hidden = false;
    progress.hidden = false;
    bar.removeAttribute('value'); // indeterminate until we get a number
    setStatus('Subiendo…');

    const replace = $<HTMLInputElement>('stems-replace')?.checked ?? true;
    try {
      await importStems(deps, file, {
        signal: controller.signal,
        replace,
        onProgress: (status, p) => {
          const elapsed = Math.floor((performance.now() - startedAt) / 1000);
          if (typeof p === 'number') bar.value = p; else bar.removeAttribute('value');
          setStatus(status === 'done' ? 'Listo' : `Separando… ${fmtElapsed(elapsed)}`);
        },
      });
      controller = null;
      modal.hidden = true; // success: lanes are created, close
    } catch (err) {
      controller = null;
      cancelBtn.hidden = true;
      progress.hidden = true;
      runBtn.disabled = false;
      const aborted = err instanceof DOMException && err.name === 'AbortError';
      const msg = aborted ? 'Cancelado' : ((err as Error)?.message ?? 'Error en la separación.');
      setStatus(msg);
      hint.textContent = msg;
    }
  });

  cancelBtn.addEventListener('click', () => { controller?.abort(); controller = null; });

  $('stems-open').addEventListener('click', open);
  $('stems-close').addEventListener('click', close);
  $('stems-backdrop').addEventListener('click', close);
}
