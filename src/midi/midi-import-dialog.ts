import { bindModalDialog } from '../app/modal-dialog';

// The import LOGIC is wired separately by wireMidiImportUI (it looks up the ids
// inside this dialog at wire time). This module only owns open/close.
export function bindMidiImportDialog(): { open(): void } {
  const { open } = bindModalDialog('midi-import-dialog');
  return { open };
}
