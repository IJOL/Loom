import type {
  PluginFactory, PluginKind, SynthInstance, FxInstance,
} from './types';

const plugins = new Map<string, PluginFactory>();
const key = (kind: PluginKind, id: string) => `${kind}:${id}`;

export function registerPlugin(factory: PluginFactory): void {
  const k = key(factory.kind, factory.manifest.id);
  if (plugins.has(k)) console.warn(`Plugin "${k}" already registered, overwriting.`);
  plugins.set(k, factory);
}

export function getPlugin<K extends PluginKind>(kind: K, id: string): Extract<PluginFactory, { kind: K }> | undefined;
export function getPlugin(kind: PluginKind, id: string): PluginFactory | undefined;
export function getPlugin(kind: PluginKind, id: string): PluginFactory | undefined {
  return plugins.get(key(kind, id));
}

/** Reverses registerPlugin for one (kind, id). The rollback half of a
 *  drop-in fx's registration — an fx that main.js already delivered must not
 *  survive its OWN plugin failing on a later component (see adoptFx in
 *  loom-api.ts), the same way unregisterEngine exists for the in-tree
 *  descriptor path. A no-op if nothing is registered under that pair. */
export function unregisterPlugin(kind: PluginKind, id: string): void {
  plugins.delete(key(kind, id));
}

export function listPlugins<K extends PluginKind>(kind: K): Extract<PluginFactory, { kind: K }>[];
export function listPlugins(): PluginFactory[];
export function listPlugins(kind?: PluginKind): PluginFactory[] {
  const all = Array.from(plugins.values());
  return kind ? all.filter((p) => p.kind === kind) : all;
}

export function createInstance(kind: 'engine',    id: string, ctx: AudioContext, output: AudioNode): SynthInstance | undefined;
export function createInstance(kind: 'fx',        id: string, ctx: AudioContext): FxInstance | undefined;
export function createInstance(kind: PluginKind, id: string, ctx: AudioContext, arg?: unknown): unknown {
  const p = plugins.get(key(kind, id));
  if (!p) return undefined;
  if (p.kind === 'engine')    return p.create(ctx, arg as AudioNode);
  if (p.kind === 'fx')        return p.create(ctx);
  return undefined;
}

/** Test-only escape hatch. Do not use in app code. */
export function _resetRegistry(): void { plugins.clear(); }
