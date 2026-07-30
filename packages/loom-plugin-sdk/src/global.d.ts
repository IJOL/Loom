import type { LoomApi } from './manifest';

declare global {
  /** Installed by the host before any plugin module is evaluated. */
  const Loom: LoomApi;
}

export {};
