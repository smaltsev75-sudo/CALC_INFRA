#!/usr/bin/env node
// Build a GitHub Pages artifact that mirrors tracked static files.

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const outDir = path.join(root, '.pages-dist');
const skipPrefixes = [
    '.github/',
    '.claude/',
    '.pages-dist/',
    'node_modules/',
    '.playwright-mcp/',
    'playwright-report/',
    'test-results/'
];

const result = spawnSync('git', ['-c', 'core.quotepath=false', 'ls-files', '-z'], {
    cwd: root,
    encoding: 'utf8'
});

if (result.status !== 0) {
    process.stderr.write(result.stderr || 'git ls-files failed\n');
    process.exit(result.status || 1);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

let copied = 0;
for (const rel of result.stdout.split('\0').filter(Boolean)) {
    const normalized = rel.replace(/\\/g, '/');
    if (skipPrefixes.some(prefix => normalized.startsWith(prefix))) continue;
    const from = path.join(root, rel);
    if (!existsSync(from)) continue;
    const to = path.join(outDir, rel);
    mkdirSync(path.dirname(to), { recursive: true });
    cpSync(from, to);
    copied++;
}

writeFileSync(path.join(outDir, '.nojekyll'), '');
console.log(`Pages artifact prepared in .pages-dist (${copied} tracked files + .nojekyll).`);
