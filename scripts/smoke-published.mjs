#!/usr/bin/env node
// Runs a small Playwright smoke against the published GitHub Pages build.

import { spawnSync } from 'node:child_process';

const publishedUrl = process.env.PLAYWRIGHT_PUBLISHED_URL
    || 'https://smaltsev75-sudo.github.io/CALC_INFRA/';
const retries = process.env.PLAYWRIGHT_PUBLISHED_RETRIES ?? '1';

const args = [
    '--no-deprecation',
    './node_modules/@playwright/test/cli.js',
    'test',
    '--config=playwright.config.js',
    'tests/e2e/published-smoke.spec.js'
];

if (retries !== '0') {
    args.push('--retries', retries);
}

console.log(`Published smoke URL: ${publishedUrl}`);
console.log(`Published smoke retries: ${retries}`);

const result = spawnSync(process.execPath, args, {
    stdio: 'inherit',
    env: {
        ...process.env,
        PLAYWRIGHT_BASE_URL: publishedUrl
    }
});

process.exit(result.status ?? 1);
