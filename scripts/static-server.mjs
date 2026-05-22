#!/usr/bin/env node

import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = resolve(fileURLToPath(new URL('.', import.meta.url)));
const repoRoot = resolve(__dirname, '..');

function argValue(name, fallback) {
    const idx = process.argv.indexOf(name);
    return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

const host = argValue('--host', process.env.DESKTOP_SMOKE_HOST || '127.0.0.1');
const port = Number(argValue('--port', process.env.DESKTOP_SMOKE_PORT || '8765'));
const silent = process.argv.includes('--silent');

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.svg': 'image/svg+xml; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.ico': 'image/x-icon'
};

function resolveRequestPath(urlPath) {
    const decoded = decodeURIComponent((urlPath || '/').split('?')[0]);
    const rel = normalize(decoded === '/' ? '/index.html' : decoded).replace(/^[/\\]+/, '');
    const abs = resolve(join(repoRoot, rel));
    const insideRoot = abs === repoRoot || abs.startsWith(repoRoot + sep);
    return insideRoot ? abs : null;
}

const server = createServer((req, res) => {
    try {
        const abs = resolveRequestPath(req.url);
        if (!abs) {
            res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Forbidden');
            return;
        }

        const st = statSync(abs, { throwIfNoEntry: false });
        if (!st || !st.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Not found');
            return;
        }

        res.writeHead(200, {
            'Content-Type': MIME[extname(abs).toLowerCase()] || 'application/octet-stream',
            'Cache-Control': 'no-store'
        });
        createReadStream(abs).pipe(res);
    } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(err?.stack || String(err));
    }
});

server.listen(port, host, () => {
    if (!silent) console.log(`Static server: http://${host}:${port}/`);
});
