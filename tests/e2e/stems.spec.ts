import { test, expect } from '@playwright/test';

/**
 * Generate a minimal but decodable WAV: 16-bit PCM mono, 44100 Hz, ~0.1 s silence.
 * Chrome's AudioContext.decodeAudioData accepts this format.
 */
function silentWavBuffer(): Buffer {
  const sampleRate = 44100;
  const numSamples = 4410; // 0.1 s
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = numSamples * blockAlign;
  const buf = Buffer.alloc(44 + dataSize, 0);

  // RIFF header
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  // fmt chunk
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);           // chunk size
  buf.writeUInt16LE(1, 20);            // PCM
  buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  // data chunk
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  // samples are already zero-filled

  return buf;
}

test('separates a song into 4 sampler lanes (service stubbed)', async ({ page }) => {
  const wav = silentWavBuffer();
  // Base64-encode the WAV so we can embed it in addInitScript (no Node.js APIs there).
  const wavBase64 = wav.toString('base64');

  // Stub the stem service fetch calls via addInitScript so the mock runs INSIDE
  // the browser context before the app's StemClient is created. Playwright's
  // page.route() does not intercept the dialog's cross-origin fetch calls (the
  // fetch reference captured by StemClient at module init bypasses routing), so
  // a JS-level fetch mock is the reliable alternative.
  await page.addInitScript((wavB64: string) => {
    // Helper: base64 string → Uint8Array
    function b64ToUint8(b64: string): Uint8Array {
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return arr;
    }

    const wavBytes = b64ToUint8(wavB64);

    const origFetch = window.fetch.bind(window);

    window.fetch = async function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const url = String(input instanceof Request ? input.url : input);
      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();

      // Stub stem service calls on any port/host that matches the service pattern.
      // Default service URL is http://localhost:8765.
      if (url.includes('localhost:8765') || url.includes('__stems')) {
        // GET /health
        if (url.endsWith('/health')) {
          return new Response(JSON.stringify({ ok: true, model: 'htdemucs' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          });
        }
        // POST /jobs
        if (url.endsWith('/jobs') && method === 'POST') {
          return new Response(JSON.stringify({ jobId: 'e2e' }), {
            status: 201,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          });
        }
        // GET /jobs/e2e/stems/<name>  (stem download — returns WAV bytes)
        if (url.includes('/jobs/e2e/stems/')) {
          return new Response(wavBytes, {
            status: 200,
            headers: { 'Content-Type': 'audio/wav', 'Access-Control-Allow-Origin': '*' },
          });
        }
        // POST /transcribe — return no notes so no extra note lanes are created
        // (this test focuses on the audio stem lanes).
        if (url.includes('/transcribe') && method === 'POST') {
          return new Response(JSON.stringify({ kind: 'melodic', tempo: null, notes: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          });
        }
        // GET /jobs/e2e  (poll endpoint — immediately done)
        if (url.includes('/jobs/e2e')) {
          return new Response(JSON.stringify({
            status: 'done',
            progress: 1,
            stems: [
              { name: 'vocals', url: '/jobs/e2e/stems/vocals' },
              { name: 'drums',  url: '/jobs/e2e/stems/drums' },
              { name: 'bass',   url: '/jobs/e2e/stems/bass' },
              { name: 'other',  url: '/jobs/e2e/stems/other' },
            ],
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          });
        }
      }

      // Pass all other requests through normally.
      return origFetch(input, init);
    };
  }, wavBase64);

  await page.goto('/');

  // Wait for the app to finish booting (demo clips loaded).
  await page.waitForFunction(
    () => document.querySelectorAll('.session-cell-filled').length > 0,
  );

  await page.locator('#stems-open').click();

  // Wait for health check to complete: hint text changes away from "Comprobando…".
  await expect(page.locator('#stems-hint')).not.toHaveText(/Comprobando/, { timeout: 5000 });

  // Verify health succeeded (not the unreachable error).
  await expect(page.locator('#stems-hint')).toContainText('pistas', { timeout: 1000 });

  // Set the file — this triggers the 'change' event which enables #stems-run.
  await page.locator('#stems-file').setInputFiles({
    name: 'song.wav',
    mimeType: 'audio/wav',
    buffer: wav,
  });

  // After file is chosen and health succeeded, run button must be enabled.
  await expect(page.locator('#stems-run')).not.toBeDisabled({ timeout: 5000 });

  await page.locator('#stems-run').click();

  // Modal closes on success (lanes are created, then hidden=true).
  await expect(page.locator('#stems-modal')).toBeHidden({ timeout: 15000 });

  // The 4 stem sampler lanes are created (session tab bar shows their Spanish
  // labels). We assert presence rather than an exact total count: a demo may be
  // auto-loaded at boot and the replace/add timing makes an exact count fragile.
  const tabTexts = await page.locator('button.session-lane-tab').allTextContents();
  for (const label of ['Voz', 'Batería', 'Bajo', 'Otros']) {
    expect(tabTexts).toContain(label);
  }
});
