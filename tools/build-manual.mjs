// Orchestrates the manual build:
//   default        : screenshots (needs a preview server) + PDF
//   --shots-only   : screenshots only
//   --pdf-only     : PDF only (no server)
//
// Run via npm: build:manual / manual:shots / manual:pdf.
// Assumes dist/ is fresh — `build:manual` runs `npm run build` first.
import { preview } from 'vite';
import { buildShots } from './manual/shots.mjs';
import { buildPdf } from './manual/pdf.mjs';
import { buildWebHtml } from './manual/web.mjs';

const args = process.argv.slice(2);
const shotsOnly = args.includes('--shots-only');
const pdfOnly = args.includes('--pdf-only');
// --only=a,b,c restricts the run to those shot names. `buildShots` always took
// the filter; nothing passed one, so adding or fixing ONE screenshot meant
// re-running all of them.
const onlyArg = args.find((a) => a.startsWith('--only='));
const only = onlyArg ? onlyArg.slice('--only='.length).split(',').filter(Boolean) : undefined;

// --port=NNNN moves the preview server. 4173 is also the e2e suite's port and
// the one a stray `vite preview` from another checkout sits on; strictPort then
// fails the whole manual build over a server that is not even serving this
// build. Nothing about the shots depends on the number.
const portArg = args.find((a) => a.startsWith('--port='));
const port = portArg ? Number(portArg.slice('--port='.length)) : 4173;

async function withPreview(fn) {
  const server = await preview({ preview: { port, strictPort: true } });
  const url = server.resolvedUrls?.local?.[0] ?? 'http://localhost:4173/';
  try { await fn(url); }
  finally { await new Promise((res) => server.httpServer.close(res)); }
}

async function main() {
  if (!pdfOnly) await withPreview((url) => buildShots(url, only));
  if (!shotsOnly) { await buildPdf(); buildWebHtml(); }
  console.log('manual: done.');
}

main().catch((err) => { console.error(err); process.exit(1); });
