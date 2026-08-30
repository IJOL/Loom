// Capture the computer's audio (system / tab) via getDisplayMedia, record it
// with MediaRecorder, and hand back a File ready to feed the stem separator.
// Browser-only (getDisplayMedia, MediaRecorder) — verified live except the
// stream-request failure paths, which ARE unit-tested.
//
// requestSystemAudioStream is shared with loop capture (performance ●), which
// routes the same stream into the audio graph instead of a MediaRecorder.

/** Ask the browser for the computer's audio. Opens the screen-share picker
 *  (the user must tick "share audio"); resolves with an audio-only stream and
 *  the release that stops the underlying tracks (video included). */
export async function requestSystemAudioStream(): Promise<{ stream: MediaStream; release(): void }> {
  const md = navigator.mediaDevices;
  if (!md?.getDisplayMedia) {
    throw new Error('Your browser does not support capturing system audio.');
  }
  // video:true is required by Chrome to expose the "share audio" option; we keep
  // only the audio track and drop the video.
  const stream = await md.getDisplayMedia({ video: true, audio: true });
  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length === 0) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error('No audio was shared. Try again and tick «share system audio».');
  }
  return {
    stream: new MediaStream(audioTracks),
    release: () => stream.getTracks().forEach((t) => t.stop()),
  };
}

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
  const { stream: audioStream, release: releaseTracks } = await requestSystemAudioStream();
  const mime = pickMime();
  const chunks: Blob[] = [];
  let rec: MediaRecorder;
  try {
    rec = new MediaRecorder(audioStream, mime ? { mimeType: mime } : undefined);
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.start();
  } catch (e) {
    releaseTracks(); // don't leave the screen-share running if recording can't start
    throw e;
  }

  return {
    stop: () => new Promise<File>((resolve, reject) => {
      rec.onstop = () => {
        releaseTracks();
        const type = rec.mimeType || mime || 'audio/webm';
        const ext = type.includes('ogg') ? 'ogg' : 'webm';
        resolve(new File(chunks, `captura.${ext}`, { type }));
      };
      rec.onerror = () => { releaseTracks(); reject(new Error('Failed recording the captured audio.')); };
      try { rec.stop(); } catch (e) { releaseTracks(); reject(e as Error); }
    }),
    cancel: () => { try { rec.stop(); } catch { /* already stopped */ } releaseTracks(); },
  };
}
