// src/app/plugin-bootstrap.ts
import { registerPlugin } from '../plugins/registry';
import { tb303Plugin }       from '../engines/tb303';
import { subtractivePlugin } from '../engines/subtractive';
import { fmPlugin }          from '../engines/fm';
import { wavetablePlugin }   from '../engines/wavetable';
import { karplusPlugin }     from '../engines/karplus';
import { drumsPlugin }       from '../engines/drums-engine';
import { multifilterPlugin } from '../plugins/fx/multifilter';
import { distortionPlugin }  from '../plugins/fx/distortion';
import { delayPlugin }       from '../plugins/fx/delay';
import { reverbPlugin }      from '../plugins/fx/reverb';
import { lfoPlugin }         from '../plugins/modulators/lfo';
import { adsrPlugin }        from '../plugins/modulators/adsr';
import type { PluginFactory } from '../plugins/types';

const BUILTIN: PluginFactory[] = [
  tb303Plugin, subtractivePlugin, fmPlugin, wavetablePlugin, karplusPlugin, drumsPlugin,
  multifilterPlugin, distortionPlugin, delayPlugin, reverbPlugin,
  lfoPlugin, adsrPlugin,
];

/** Register every built-in plugin. Call once at app start, BEFORE
 *  `createAudioGraph()` (because some downstream code resolves plugins
 *  during graph construction). The `extras` parameter is unused today —
 *  it's the seam where phase 2 (runtime-loaded plugins) hooks in. */
export function bootstrapPlugins(extras: PluginFactory[] = []): void {
  for (const p of [...BUILTIN, ...extras]) registerPlugin(p);
}
