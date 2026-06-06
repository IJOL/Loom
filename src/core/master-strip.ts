// Master strip — the mixer column for the master bus.
//
// Lives in the last (scenes) column of the session mixer row. It mirrors the
// shape of a lane column (buildMixerColumn) but is intentionally simplified:
//   - a "MASTER" name header,
//   - an FX toggle button that opens/closes the master FX panel,
//   - a vertical fader that is a PROXY of the existing #volume control, and
//   - a VU meter fed by a dedicated master meter analyser.
//
// CRITICAL: the fader never writes master.gain directly and never brackets its
// own undo. It writes `volInput.value` and dispatches `#volume`'s `input`
// event, reusing that handler (which writes master.gain and participates in the
// undo bracket). This is what keeps save (SavedStateV3.masterVol) and undo
// working unchanged.

import { createLevelMeter } from './level-meter';

const fmtPct = (v: number) => `${Math.round(v * 100)}%`;

export interface MasterStripDeps {
  /** The existing #volume range input; the master fader proxies it. */
  volInput: HTMLInputElement;
  /** Dedicated meter tap of the master bus (fftSize=512). */
  masterMeterAnalyser: AnalyserNode;
  /** Whether the master FX panel is currently open (drives the button .active). */
  isFxOpen(): boolean;
  /** Called when the FX button is clicked. */
  onToggleFx(): void;
  /**
   * Optional teardown registration. When provided, the strip registers the VU
   * meter handle so the caller can dispose it when the strip is rebuilt.
   */
  registerDisposable?(d: { dispose(): void }): void;
}

export function buildMasterStrip(deps: MasterStripDeps): HTMLElement {
  const col = document.createElement('div');
  col.className = 'mix-col master-strip';

  // Name header
  const name = document.createElement('div');
  name.className = 'mix-name';
  name.textContent = 'MASTER';
  col.appendChild(name);

  // FX toggle button
  const fxBtn = document.createElement('button');
  fxBtn.className = 'master-fx-toggle';
  fxBtn.textContent = 'FX';
  fxBtn.title = 'Master effects';
  if (deps.isFxOpen()) fxBtn.classList.add('active');
  fxBtn.addEventListener('click', () => deps.onToggleFx());
  col.appendChild(fxBtn);

  // Vertical fader (proxy of #volume) + VU meter.
  //
  // The fader writes volInput.value and dispatches volInput's `input` event so
  // the existing #volume handler does the real work (master.gain + undo).
  const faderWrap = document.createElement('div');
  faderWrap.className = 'mix-fader-wrap';

  const faderRow = document.createElement('div');
  faderRow.className = 'mix-fader-row';

  const fader = document.createElement('input');
  fader.type = 'range';
  fader.className = 'mix-fader';
  fader.min = '0'; fader.max = '1'; fader.step = '0.01';
  fader.value = deps.volInput.value;

  const faderVal = document.createElement('div');
  faderVal.className = 'mix-fader-val';
  const updateFaderText = () => { faderVal.textContent = fmtPct(parseFloat(fader.value)); };
  updateFaderText();

  fader.addEventListener('input', () => {
    deps.volInput.value = fader.value;
    deps.volInput.dispatchEvent(new Event('input'));
    updateFaderText();
  });

  const vuMeter = createLevelMeter({ analyser: deps.masterMeterAnalyser });
  if (deps.registerDisposable) deps.registerDisposable(vuMeter);

  faderRow.appendChild(fader);
  faderRow.appendChild(vuMeter.el);
  faderWrap.appendChild(faderRow);
  faderWrap.appendChild(faderVal);
  col.appendChild(faderWrap);

  return col;
}
