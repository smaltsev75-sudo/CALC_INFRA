/**
 * Public documentation must not point to files that disappear from a clean
 * checkout / GitHub release. This guards README/UserManual drift against
 * .gitignore changes.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..', '..');
const PUBLIC_DOCS = ['README.md', 'UserManual.md', 'HOW_TO_START.md'];

function trackedFiles() {
    return new Set(execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
        .split(/\r?\n/)
        .filter(Boolean)
        .map(p => p.replace(/\\/g, '/')));
}

function localMarkdownLinks(src) {
    return [...src.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)]
        .map(m => m[1].trim())
        .filter(href => href && !/^(https?:|mailto:|#)/i.test(href))
        .map(href => href.split('#')[0].split('?')[0])
        .filter(Boolean);
}

describe('public documentation links resolve in clean checkout', () => {
    const tracked = trackedFiles();

    for (const doc of PUBLIC_DOCS) {
        it(`${doc}: all local link targets are tracked files`, () => {
            const abs = join(ROOT, doc);
            const src = readFileSync(abs, 'utf8');
            const missing = [];

            for (const href of localMarkdownLinks(src)) {
                const targetAbs = resolve(dirname(abs), decodeURIComponent(href));
                const rel = relative(ROOT, targetAbs).replace(/\\/g, '/');
                if (!existsSync(targetAbs) || !tracked.has(rel)) missing.push(href);
            }

            assert.deepEqual(missing, [],
                `${doc} links to files that are absent from a clean checkout: ${missing.join(', ')}`);
        });
    }
});
