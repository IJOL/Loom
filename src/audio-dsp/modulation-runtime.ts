export type ModLite = {
  id: string;
  kind: string;
  enabled: boolean;
  rateHz: number;
  waveform: string;
  connections: { paramId: string; depth: number }[];
};
