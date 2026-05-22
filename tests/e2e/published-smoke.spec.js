import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
    bootCleanApp,
    clickSidebarTab,
    createCalculationFromQuickStart,
    expectNoHorizontalOverflow
} from './helpers.js';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

test.describe.configure({ mode: 'parallel' });

test('configured app URL serves current desktop shell and Quick Start flow', async ({ page }) => {
    const consoleErrors = await bootCleanApp(page);

    await expect(page.locator('.sidebar-brand-version')).toHaveText(`v${pkg.version}`);
    await createCalculationFromQuickStart(page, {
        name: 'Published smoke: Quick Start',
        presetId: 'std_b2b'
    });

    await expect(page.getByTestId('dashboard-grid')).toBeVisible();
    await clickSidebarTab(page, 'details');
    await expect(page.locator('.details-table-cost')).toBeVisible();
    await clickSidebarTab(page, 'comparison');
    await expect(page.locator('.empty-state-title, .comparison-table-unified').first()).toBeVisible();

    await expectNoHorizontalOverflow(page, [
        '.app-layout',
        '.app-main',
        '.app-topbar',
        '.dashboard-grid'
    ]);
    expect(consoleErrors).toEqual([]);
});
