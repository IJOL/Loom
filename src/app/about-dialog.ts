// Help ▸ About Loom. The prose lives in index.html; this fills in the two facts
// that must never rot: the version label and the commit count (both inlined at
// build time by vite.config's `define`).
import { bindModalDialog } from './modal-dialog';

export function bindAboutDialog(): { open(): void } {
  const modal = bindModalDialog('about-dialog');

  const version = document.getElementById('about-version');
  if (version) version.textContent = `v${__APP_VERSION__} · ${__APP_STAGE__} · ${__APP_CODENAME__}`;

  // 0 when the build had no git (source tarball) — say nothing rather than lie.
  const commits = document.getElementById('about-commits');
  if (commits) {
    commits.textContent = __GIT_COMMITS__ > 0
      ? `${__GIT_COMMITS__.toLocaleString('en-US')} commits`
      : 'Well over a thousand commits';
  }

  bindTheTruth();

  return { open: modal.open };
}

// Clicking the paragraph's last line drops the mask. Clicking it again puts it
// back on — the joke only works if it can be un-told.
function bindTheTruth(): void {
  const tell = document.getElementById('about-tell');
  const truth = document.getElementById('about-truth');
  if (!tell || !truth) return;

  tell.addEventListener('click', () => {
    const showing = truth.hidden;
    truth.hidden = !showing;
    tell.setAttribute('aria-expanded', String(showing));
    if (showing) truth.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
}
