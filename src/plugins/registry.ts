import type {
  PluginFactory, PluginKind, SynthInstance, FxInstance, ModulatorInstance,
} from './types';

const plugins = new Map<string, PluginFactory>();
const key = (kind: PluginKind, id: string) => `${kind}:${id}`;

export function registerPlugin(factory: PluginFactory): void {
  const k = key(factory.kind, factory.manifest.id);
  if (plugins.has(k)) console.warn(`Plugin "${k}" already registered, overwriting.`);
  plugins.set(k, factory);
}

export function getPlugin(kind: PluginKind, id: string): PluginFactory | undefined {
  return plugins.get(key(kind, id));
}

export function listPlugins<K extends PluginKind>(kind: K): Extract<PluginFactory, { kind: K }>[];
export function listPlugins(): PluginFactory[];
export function listPlugins(kind?: PluginKind): PluginFactory[] {
  const all = Array.from(plugins.values());
  return kind ? all.filter((p) => p.kind === kind) : all;
}

export function createInstance(kind: 'synth',     id: string, ctx: AudioContext, output: AudioNode): SynthInstance | undefined;
export function createInstance(kind: 'fx',        id: string, ctx: AudioContext): FxInstance | undefined;
export function createInstance(kind: 'modulator', id: string, ctx: AudioContext, bpm: number): ModulatorInstance | undefined;
export function createInstance(kind: PluginKind, id: string, ctx: AudioContext, arg?: unknown): unknown {
  const p = plugins.get(key(kind, id));
  if (!p) return undefined;
  if (p.kind === 'synth')     return p.create(ctx, arg as AudioNode);
  if (p.kind === 'fx')        return p.create(ctx);
  if (p.kind === 'modulator') return p.create(ctx, arg as number);
  return undefined;
}

/** Test-only escape hatch. Do not use in app code. */
export function _resetRegistry(): void { plugins.clear(); }
