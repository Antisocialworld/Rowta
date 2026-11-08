// serve — a dependency-free static file server for web/dist, used only for local checks:
// render screenshots, the keyboard walkthrough, Lighthouse and link clicking. The owner deploys the same
// files to Vercel; this script is not part of the site and is never deployed (P1: no deploys by the agent).
//
// Run:  node web/serve.mjs   (default http://localhost:8321; PORT=xxxx to change)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, 'dist');
const PORT = Number(process.env.PORT ?? 8321);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function resolveFile(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]);
  const candidates = [];
  if (clean === '/') {
    candidates.push('index.html');
  } else {
    const rel = clean.replace(/^\//, '');
    if (clean.endsWith('/')) {
      // directory URL (/privacy/) -> dist/privacy/index.html
      candidates.push(path.join(rel, 'index.html'));
    } else {
      candidates.push(rel);
      candidates.push(`${rel}/index.html`);
      if (!path.extname(clean)) candidates.push(`${rel}.html`);
    }
  }
  for (const candidate of candidates) {
    const file = path.join(DIST, candidate);
    if (file.startsWith(DIST) && fs.existsSync(file) && fs.statSync(file).isFile()) return file;
  }
  return null;
}

// Token routes (PRD 8.1, 8.2): ONE static page answers any /magic, /magic/*, /invite or /invite/* URL,
// exactly like the Vercel rewrite in web/vercel.json. The fragment never reaches the server.
// These two routes carry noindex (X-Robots-Tag), no-referrer and no-store — skill 3.15 note 4.
const TOKEN_HEADERS = {
  'x-robots-tag': 'noindex, nofollow',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
};

function tokenRouteFile(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]);
  const page = /^\/magic(\/|$)/.test(clean)
    ? 'magic'
    : /^\/invite(\/|$)/.test(clean)
      ? 'invite'
      : /^\/billing\/complete(\/|$)/.test(clean)
        ? path.join('billing', 'complete')
        : null;
  if (page === null) return null;
  const file = path.join(DIST, page, 'index.html');
  return fs.existsSync(file) && fs.statSync(file).isFile() ? file : null;
}

http
  .createServer((req, res) => {
    const tokenFile = tokenRouteFile(req.url ?? '/');
    const file = tokenFile ?? resolveFile(req.url ?? '/');
    if (!file) {
      const notFound = path.join(DIST, '404.html');
      const body = fs.existsSync(notFound) ? fs.readFileSync(notFound) : 'Not found';
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      res.end(body);
      return;
    }
    const headers = { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' };
    if (tokenFile) Object.assign(headers, TOKEN_HEADERS);
    res.writeHead(200, headers);
    res.end(fs.readFileSync(file));
  })
  .listen(PORT, () => {
    console.log(`serving ${path.relative(process.cwd(), DIST)} on http://localhost:${PORT}`);
  });
