#!/usr/bin/env node
// Runs a small Playwright smoke against the published GitHub Pages build.

import { spawnSync } from 'node:child_process';

const publishedUrl = process.env.PLAYWRIGHT_PUBLISHED_URL
    || 'https://smaltsev75-sudo.github.io/CALC_INFRA/';

const result = spawnSync(process.execPath, [
    '--no-deprecation',
    './node_modules/@playwright/test/cli.js',
    'test',
    '--config=playwright.config.js',
    'tests/e2e/published-smoke.spec.js'
], {
    stdio: 'inherit',
    env: {
        ...process.env,
        PLAYWRIGHT_BASE_URL: publishedUrl
    }
});

process.exit(result.status ?? 1);
