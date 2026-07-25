// Plain-English copy for the per-lane COMP + SIDECHAIN sections: the two "?"
// legends and the tooltip for every control. Split out of lane-fx-panel.ts so
// the panel file stays about wiring, and so all the wording sits in one place
// where it can be read (and corrected) as prose.
//
// House style, learned from the user's complaint "there is a compressor and a
// thingamajig per lane and I have no idea how to use it":
//   - first line says what the section DOES, in words, no jargon;
//   - then one line per control, each naming its unit;
//   - abbreviations are always expanded (THR → threshold), never assumed.
//
// The legends are rendered inside a <pre> (`.editor-help-popover`, white-space:
// pre), so the column alignment below is what the user sees.

export const COMP_LEGEND = [
  'COMP — channel compressor',
  '',
  'Evens out this lane. Anything louder than THR gets turned down, so the loud',
  'hits and the quiet ones end up closer together; MKUP then brings the whole',
  'lane back up to the volume you had. Use it to make a part sit steady in the',
  'mix instead of jumping out.',
  '',
  '  THR   threshold (dB)     above this level it starts turning the lane down',
  '  RAT   ratio (x:1)        how hard it turns down whatever goes over THR',
  '  ATK   attack (ms)        how fast it clamps down on a loud hit',
  '  REL   release (ms)       how fast it lets go once the hit passes',
  '  KNEE  knee (dB)          0 = clamps abruptly at THR, higher = eases in',
  '  MKUP  make-up gain (x)   gives back the volume the compression took away',
  '  BYP   bypass             pushes it out of the way, to hear it on and off',
  '  GR    gain reduction     the bar moves while it is compressing — watch it',
  '',
  'Tip: BYP is on by default, so the compressor does nothing until you turn it',
  'off. Drop THR until the GR bar starts moving on the loud hits.',
].join('\n');

export const SC_LEGEND = [
  'SIDECHAIN — duck this lane',
  '',
  'Pick another lane whose hits should push this one out of the way. The classic',
  'use: the kick drum ducks the bass, so every kick is heard clearly and the',
  'bass dips underneath it. Nothing happens until you pick a source.',
  '',
  '  SRC    source            the lane whose hits do the ducking',
  '  DEPTH  depth (%)         how far this lane drops on each hit',
  '  ATK    attack (ms)       how fast the volume dips',
  '  REL    release (ms)      how fast the volume comes back up',
  '',
  'The line next to the dropdown always says what is wired right now, e.g.',
  '"Drums 1 -> duck 60%", or "off".',
].join('\n');

/** Tooltips for the COMP controls. Keys match the knob id leaves. */
export const COMP_TIPS = {
  thr:  'THR — threshold (dB): the level above which the compressor starts turning this lane down',
  rat:  'RAT — ratio (x:1): how hard it turns down whatever goes over the threshold',
  atk:  'ATK — attack (ms): how fast it clamps down once a sound goes over the threshold',
  rel:  'REL — release (ms): how fast it lets the volume back up after the sound drops',
  knee: 'KNEE — knee (dB): 0 clamps abruptly at the threshold, higher eases the compression in',
  mkup: 'MKUP — make-up gain (x): gives back the volume the compression took away',
  byp:  'BYP — bypass the compressor, to hear this lane with it and without it',
} as const;

/** Tooltips for the SIDECHAIN controls. */
export const SC_TIPS = {
  src:   'Source: the lane whose hits duck this one (classic: the kick ducks the bass). "off" = no ducking',
  depth: 'DEPTH — depth (%): how far this lane drops on each hit of the source',
  atk:   'ATK — attack (ms): how fast the volume dips when the source hits',
  rel:   'REL — release (ms): how fast the volume comes back up after the hit',
} as const;

/** Tooltip for the gain-reduction bar next to BYP. */
export const GR_TIP =
  'GR — gain reduction: how much the compressor is turning this lane down right now. '
  + 'Empty = not compressing at all; the bar fills as it clamps harder.';
