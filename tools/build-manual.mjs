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

async function withPreview(fn) {
  const server = await preview({ preview: { port: 4173, strictPort: true } });
  const url = server.resolvedUrls?.local?.[0] ?? 'http://localhost:4173/';
  try { await fn(url); }
  finally { await new Promise((res) => server.httpServer.close(res)); }
}

async function main() {
  if (!pdfOnly) await withPreview((url) => buildShots(url));
  if (!shotsOnly) { await buildPdf(); buildWebHtml(); }
  console.log('manual: done.');
}

main().catch((err) => { console.error(err); process.exit(1); });
