import { bindModalDialog } from '../app/modal-dialog';

// The import LOGIC is wired separately by wireMidiImportUI (it looks up the ids
// inside this dialog at wire time). This module only owns open/close.
export function bindMidiImportDialog(): { open(): void; close(): void } {
  const { open, close } = bindModalDialog('midi-import-dialog');
  // `close` is called from main.ts's onImported so a committed import dismisses
  // the dialog (Import MIDI → import + close; Cancel → close).
  return { open, close };
}
