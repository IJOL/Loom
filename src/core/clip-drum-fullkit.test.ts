import { describe, it, expect, beforeEach } from 'vitest';
import { isDrumFullKit, setDrumFullKit } from './clip-drum-fullkit';

describe('clip-drum-fullkit', () => {
  beforeEach(() => setDrumFullKit(false));
  it('defaults to false (compact)', () => { expect(isDrumFullKit()).toBe(false); });
  it('round-trips', () => { setDrumFullKit(true); expect(isDrumFullKit()).toBe(true); });
});
