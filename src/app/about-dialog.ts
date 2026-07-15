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

  return { open: modal.open };
}
