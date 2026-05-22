/**
 * GitHub Pages is deployed by an explicit workflow instead of legacy
 * deploy-from-branch. This keeps Pages on repo-owned action versions.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = rel => readFileSync(join(ROOT, rel), 'utf8');

describe('GitHub Pages workflow', () => {
    const workflow = read('.github/workflows/pages.yml');
    const script = read('scripts/build-pages-dist.mjs');
    const ci = read('.github/workflows/ci.yml');

    it('uses Node 24-aware actions and deploy-pages', () => {
        assert.match(workflow, /uses:\s*actions\/checkout@v6/);
        assert.match(workflow, /uses:\s*actions\/configure-pages@v6/);
        assert.match(workflow, /uses:\s*actions\/setup-node@v6/);
        assert.match(workflow, /node-version:\s*24/);
        assert.match(workflow, /uses:\s*actions\/upload-pages-artifact@v5/);
        assert.match(workflow, /uses:\s*actions\/deploy-pages@v5/);
    });

    it('builds a .pages-dist artifact from tracked files', () => {
        assert.match(workflow, /npm run pages:build/);
        assert.match(workflow, /path:\s*\.pages-dist/);
        assert.match(script, /core\.quotepath=false/);
        assert.match(script, /'ls-files',\s*'-z'/);
        assert.match(script, /\.nojekyll/);
        assert.match(script, /skipPrefixes/);
    });

    it('CI validates the Pages artifact before whitespace check', () => {
        assert.match(ci, /Pages artifact check[\s\S]+npm run pages:build/);
    });
});
