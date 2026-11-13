// Local preview of team.html outside Chrome: serves the build (dist/, run npm run build first) and injects the same fake `chrome` + seed data the UI tests use.
// Usage: node preview-server.cjs [port]   (language: ?lang=en|vi)
const http = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { buildSeed, installFakeChrome } = require('./ui-fixture.cjs');

const dist = path.join(__dirname, 'dist');
const port = Number(process.argv[2] || process.env.PORT || 5173);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const relative = decodeURIComponent(url.pathname).replace(/^\//, '') || 'team.html';
  const filename = path.resolve(dist, relative);
  if (!filename.startsWith(dist + path.sep)) { res.writeHead(403).end(); return; }
  try {
    let body = await readFile(filename);
    if (relative === 'team.html') {
      const seed = await buildSeed({ language: url.searchParams.get('lang') || 'vi' });
      // `<` escaped so seed text can never close the script tag.
      const shim = `<script>(${installFakeChrome})({ seed: ${JSON.stringify(seed).replace(/</g, '\\u003c')} });</script>`;
      body = body.toString('utf8').replace('<head>', '<head>' + shim);
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`Themis preview: http://localhost:${port}/team.html`));
