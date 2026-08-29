// Tiny static file server for previewing mockups and one-off HTML in a real
// browser. Deducing how a page renders is slower and less reliable than looking
// at it.
//
//   node tools/serve-static.mjs <dir> [port]
//
// Serves <dir> at http://localhost:<port>/ with directory listing at the root.

import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const root = resolve(process.argv[2] ?? '.');
const port = Number(process.argv[3] ?? 4399);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
};

async function listing(dir, urlPath) {
  const names = await readdir(dir);
  const rows = names.map((n) => `<li><a href="${urlPath.replace(/\/$/, '')}/${n}">${n}</a></li>`).join('');
  return `<!doctype html><meta charset="utf-8"><title>${urlPath}</title>`
    + `<body style="font:13px ui-monospace,monospace;background:#111;color:#ddd;padding:24px">`
    + `<h1 style="font-size:15px">${urlPath}</h1><ul>${rows}</ul>`;
}

createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    // Keep the served tree inside root — a normalised path must still start there.
    const target = normalize(join(root, urlPath));
    if (target !== root && !target.startsWith(root + sep)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const info = await stat(target);
    if (info.isDirectory()) {
      const index = join(target, 'index.html');
      const hasIndex = await stat(index).then(() => true, () => false);
      if (hasIndex) {
        res.writeHead(200, { 'content-type': TYPES['.html'] }).end(await readFile(index));
        return;
      }
      res.writeHead(200, { 'content-type': TYPES['.html'] }).end(await listing(target, urlPath));
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    }).end(await readFile(target));
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, () => {
  console.log(`serving ${root} at http://localhost:${port}/`);
});
