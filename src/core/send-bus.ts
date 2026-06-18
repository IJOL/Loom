// A generic FX send bus: lanes connect a per-channel send gain into `input`;
// the signal passes through an InsertChain (seeded with one effect, e.g. delay
// or reverb), through a return-level gain, and into the master sum bus. Muting
// zeroes the return without disconnecting the chain.
import { InsertChain } from '../plugins/fx/insert-chain';
import type { InsertSlot } from '../session/insert-slot';

export interface SendBusState {
  id: string;
  label: string;
  returnLevel: number;
  muted: boolean;
  inserts: InsertSlot[];
}

export class SendBus {
  readonly input: GainNode;
  readonly inserts: InsertChain;
  private readonly returnGain: GainNode;
  private _muted = false;
  private _level = 1;

  constructor(
    ctx: AudioContext,
    public readonly id: string,
    public label: string,
    output: AudioNode,
  ) {
    this.input = ctx.createGain();
    this.returnGain = ctx.createGain();
    this.returnGain.gain.value = 1;
    // input → [inserts] → returnGain → output(master)
    this.inserts = new InsertChain(this.input, this.returnGain);
    this.returnGain.connect(output);
  }

  setReturnLevel(g: number): void {
    this._level = g;
    if (!this._muted) this.returnGain.gain.value = g;
  }
  getReturnLevel(): number { return this._level; }

  setMuted(m: boolean): void {
    this._muted = m;
    this.returnGain.gain.value = m ? 0 : this._level;
  }
  isMuted(): boolean { return this._muted; }

  /** Serialize bus-level state. Insert slots are owned by the session and
   *  serialized there (mirrors lane/master inserts), so default to []. */
  serialize(inserts: InsertSlot[] = []): SendBusState {
    return { id: this.id, label: this.label, returnLevel: this._level, muted: this._muted, inserts };
  }
}
