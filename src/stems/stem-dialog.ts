import { StemClient, StemServiceUnreachable } from './stem-client';
import { importStems } from './stem-import';
import { startSystemAudioCapture, type AudioCapture } from './system-audio-capture';

export interface StemDialogDeps {
  ctx: AudioContext;
  client: StemClient;
  addStemLanes: (
    stems: { label: string; sampleId: string; durationSec: number }[],
    opts?: { replace?: boolean },
  ) => void;
  transcribeStem?: (file: File, label: string, kind: 'melodic' | 'drums') => Promise<void>;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fmtElapsed = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

/** Wire the Stems modal. Call once at boot after deps exist. */
export function wireStemDialog(deps: StemDialogDeps): void {
  const modal = $('stems-modal');
  const fileInput = $<HTMLInputElement>('stems-file');
  const runBtn = $<HTMLButtonElement>('stems-run');
  const listenBtn = $<HTMLButtonElement>('stems-listen');
  const cancelBtn = $<HTMLButtonElement>('stems-cancel');
  const progress = $('stems-progress');
  const bar = $<HTMLProgressElement>('stems-bar');
  const statusEl = $('stems-status');
  const hint = $('stems-hint');
  const replaceBox = $<HTMLInputElement>('stems-replace');

  let controller: AbortController | null = null; // separation in progress
  let capture: AudioCapture | null = null;       // live system-audio capture
  let startedAt = 0;

  const setStatus = (msg: string) => { statusEl.textContent = msg; };
  const LISTEN_IDLE = '🎙 Escuchar audio del PC';
  const LISTEN_REC = '■ Detener y separar';

  const close = () => {
    if (controller) return;       // don't close mid-separation
    capture?.cancel(); capture = null;
    listenBtn.textContent = LISTEN_IDLE;
    modal.hidden = true;
  };

  const open = async () => {
    capture?.cancel(); capture = null;
    listenBtn.textContent = LISTEN_IDLE;
    modal.hidden = false;
    progress.hidden = true;
    cancelBtn.hidden = true;
    runBtn.disabled = true;
    listenBtn.disabled = true;
    fileInput.disabled = false;
    fileInput.value = '';
    setStatus('');
    hint.textContent = 'Comprobando el servicio…';
    try {
      await deps.client.health();
      hint.textContent = '4 pistas (voz / batería / bajo / otros) vía el servicio local.';
      runBtn.disabled = !fileInput.files?.length;
      listenBtn.disabled = false;
    } catch (err) {
      hint.textContent = err instanceof StemServiceUnreachable
        ? 'No encuentro el servicio de stems en localhost:8765. ¿Está arrancado? (ver tools/stem-service/README.md)'
        : 'No se pudo contactar el servicio de stems.';
      runBtn.disabled = true;
      listenBtn.disabled = true;
    }
  };

  /** Shared separation flow used by both "Separar" (file) and "Detener" (capture). */
  const runSeparation = async (file: File) => {
    controller = new AbortController();
    startedAt = performance.now();
    runBtn.disabled = true;
    listenBtn.disabled = true;
    fileInput.disabled = true;
    cancelBtn.hidden = false;
    progress.hidden = false;
    bar.removeAttribute('value'); // indeterminate until we get a number
    setStatus('Subiendo…');

    try {
      await importStems(deps, file, {
        signal: controller.signal,
        replace: replaceBox?.checked ?? true,
        onProgress: (status, p) => {
          const elapsed = Math.floor((performance.now() - startedAt) / 1000);
          if (typeof p === 'number') bar.value = p; else bar.removeAttribute('value');
          setStatus(
            status === 'done' ? 'Listo'
              : status === 'transcribing' ? 'Transcribiendo notas…'
              : `Separando… ${fmtElapsed(elapsed)}`,
          );
        },
      });
      controller = null;
      modal.hidden = true; // success: lanes are created, close
    } catch (err) {
      controller = null;
      cancelBtn.hidden = true;
      progress.hidden = true;
      fileInput.disabled = false;
      runBtn.disabled = !fileInput.files?.length;
      listenBtn.disabled = false;
      const aborted = err instanceof DOMException && err.name === 'AbortError';
      const msg = aborted ? 'Cancelado' : ((err as Error)?.message ?? 'Error en la separación.');
      setStatus(msg);
      hint.textContent = msg;
    }
  };

  fileInput.addEventListener('change', () => {
    if (!capture && !controller) runBtn.disabled = !fileInput.files?.length;
  });

  runBtn.addEventListener('click', () => {
    const file = fileInput.files?.[0];
    if (file) void runSeparation(file);
  });

  listenBtn.addEventListener('click', async () => {
    // Stop a running capture and feed it to the separator.
    if (capture) {
      const cap = capture; capture = null;
      listenBtn.textContent = LISTEN_IDLE;
      setStatus('Procesando la grabación…');
      let file: File;
      try {
        file = await cap.stop();
      } catch (err) {
        setStatus((err as Error)?.message ?? 'Error al capturar el audio.');
        runBtn.disabled = !fileInput.files?.length;
        fileInput.disabled = false;
        return;
      }
      if (!file.size) {
        setStatus('No se capturó audio (¿marcaste «compartir audio»?).');
        runBtn.disabled = !fileInput.files?.length;
        fileInput.disabled = false;
        return;
      }
      void runSeparation(file);
      return;
    }

    // Start a capture.
    setStatus('');
    try {
      capture = await startSystemAudioCapture();
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === 'NotAllowedError';
      hint.textContent = aborted
        ? 'Captura cancelada.'
        : ((err as Error)?.message ?? 'No se pudo capturar el audio del sistema.');
      return;
    }
    listenBtn.textContent = LISTEN_REC;
    runBtn.disabled = true;
    fileInput.disabled = true;
    setStatus('Grabando… reproduce el audio y pulsa «Detener y separar».');
  });

  cancelBtn.addEventListener('click', () => { controller?.abort(); controller = null; });

  $('stems-open').addEventListener('click', open);
  $('stems-close').addEventListener('click', close);
  $('stems-backdrop').addEventListener('click', close);
}
