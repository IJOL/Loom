import { bindModalDialog } from '../app/modal-dialog';

// The controller LOGIC is wired separately by wireControlSurfaceUI (it looks up
// the ids inside this dialog at wire time). This module only owns open/close.
export function bindMidiControlDialog(): { open(): void } {
  const { open } = bindModalDialog('midi-control-dialog');
  return { open };
}
