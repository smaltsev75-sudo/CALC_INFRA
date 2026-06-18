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
        assert.match(workflow, /npm ci/);
        assert.match(workflow, /npm run pages:build/);
        assert.match(workflow, /path:\s*\.pages-dist/);
        assert.match(script, /core\.quotepath=false/);
        assert.match(script, /'ls-files',\s*'-z'/);
        assert.match(script, /\.nojekyll/);
        assert.match(script, /skipPrefixes/);
    });

    it('deploys only after successful CI on the tested commit', () => {
        assert.doesNotMatch(workflow, /\n\s+push\s*:/,
            'Pages must not deploy directly on push; CI gates must complete first.');
        assert.match(workflow, /workflow_run:\s*[\s\S]*workflows:\s*\[\s*["']CI["']\s*\]/,
            'Pages workflow must be triggered by completed CI workflow.');
        assert.match(workflow, /if:\s*\$\{\{\s*github\.event\.workflow_run\.conclusion\s*==\s*['"]success['"]\s*\}\}/,
            'Deploy job must require successful CI conclusion.');
        assert.match(workflow, /ref:\s*\$\{\{\s*github\.event\.workflow_run\.head_sha\s*\}\}/,
            'Pages must checkout the exact commit that passed CI, not a moving branch ref.');
    });

    it('runs published smoke after deploy against the actual Pages URL', () => {
        assert.match(workflow, /npx playwright install --with-deps chromium/);
        assert.match(workflow, /Install Chromium for published smoke[\s\S]+timeout-minutes:\s*20/);
        assert.match(workflow, /PLAYWRIGHT_PUBLISHED_URL:\s*\$\{\{\s*steps\.deployment\.outputs\.page_url\s*\}\}/);
        assert.match(workflow, /PLAYWRIGHT_PUBLISHED_RETRIES:\s*2/);
        assert.match(workflow, /npm run smoke:published/);
    });

    it('CI validates the Pages artifact before whitespace check', () => {
        assert.match(ci, /Pages artifact check[\s\S]+npm run pages:build/);
    });

    it('CI Playwright install does not kill apt mid-run and retry into dpkg locks', () => {
        assert.match(ci, /Install Playwright browser[\s\S]+timeout-minutes:\s*20/);
        assert.match(ci, /npx playwright install --with-deps chromium/);
        assert.doesNotMatch(ci, /timeout\s+240\s+npx playwright install --with-deps chromium/);
        assert.doesNotMatch(ci, /for a in 1 2 3/);
    });
});
