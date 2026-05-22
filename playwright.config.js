import { defineConfig } from '@playwright/test';

const port = Number(process.env.DESKTOP_SMOKE_PORT || 8765);
const host = process.env.DESKTOP_SMOKE_HOST || '127.0.0.1';
const channel = process.env.PLAYWRIGHT_CHANNEL || 'chrome';

export default defineConfig({
    testDir: './tests/e2e',
    testMatch: /.*\.spec\.js/,
    fullyParallel: true,
    workers: process.env.CI ? 2 : undefined,
    timeout: 30_000,
    expect: { timeout: 10_000 },
    reporter: [['list']],
    outputDir: '.playwright-mcp/test-results',
    use: {
        baseURL: `http://${host}:${port}`,
        browserName: 'chromium',
        channel,
        viewport: { width: 1365, height: 768 },
        deviceScaleFactor: 1,
        colorScheme: 'dark',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'off'
    },
    webServer: {
        command: `node scripts/static-server.mjs --host ${host} --port ${port} --silent`,
        url: `http://${host}:${port}/index.html`,
        reuseExistingServer: true,
        timeout: 15_000
    }
});
