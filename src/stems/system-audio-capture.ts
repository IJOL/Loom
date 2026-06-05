// Capture the computer's audio (system / tab) via getDisplayMedia, record it
// with MediaRecorder, and hand back a File ready to feed the stem separator.
// Browser-only (getDisplayMedia, MediaRecorder) — verified live, not unit-tested.

export interface AudioCapture {
  /** Stop recording + release the shared stream, resolving with the recording. */
  stop(): Promise<File>;
  /** Abort without producing a file (release the stream). */
  cancel(): void;
}

function pickMime(): string | undefined {
  const cands = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  for (const c of cands) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(c)) return c;
  }
  return undefined;
}

/** Start capturing the computer's audio. Opens the browser's screen-share picker
 *  (the user must tick "share audio"). Resolves once recording has started. */
export async function startSystemAudioCapture(): Promise<AudioCapture> {
  const md = navigator.mediaDevices;
  if (!md?.getDisplayMedia) {
    throw new Error('Tu navegador no permite capturar el audio del sistema.');
  }
  // video:true is required by Chrome to expose the "share audio" option; we keep
  // only the audio track and drop the video.
  const stream = await md.getDisplayMedia({ video: true, audio: true });
  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length === 0) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error('No se compartió audio. Vuelve a intentarlo y marca «compartir audio del sistema».');
  }

  const audioStream = new MediaStream(audioTracks);
  const mime = pickMime();
  const rec = new MediaRecorder(audioStream, mime ? { mimeType: mime } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  rec.start();

  const releaseTracks = () => stream.getTracks().forEach((t) => t.stop());

  return {
    stop: () => new Promise<File>((resolve, reject) => {
      rec.onstop = () => {
        releaseTracks();
        const type = rec.mimeType || mime || 'audio/webm';
        const ext = type.includes('ogg') ? 'ogg' : 'webm';
        resolve(new File(chunks, `captura.${ext}`, { type }));
      };
      rec.onerror = () => { releaseTracks(); reject(new Error('Fallo grabando el audio capturado.')); };
      try { rec.stop(); } catch (e) { releaseTracks(); reject(e as Error); }
    }),
    cancel: () => { try { rec.stop(); } catch { /* already stopped */ } releaseTracks(); },
  };
}
