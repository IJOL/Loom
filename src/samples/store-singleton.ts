// src/samples/store-singleton.ts
// One shared IndexedDB sample store for the whole app (UI imports + Plan-4
// hydration use the same instance / database).
import { IdbSampleStore } from './sample-store';

export const sampleStore = new IdbSampleStore();
