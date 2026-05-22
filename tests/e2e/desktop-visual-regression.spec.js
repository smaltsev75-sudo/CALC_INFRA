import { expect, test } from '@playwright/test';
import {
    bootCleanApp,
    clickSidebarTab,
    seedCalculations
} from './helpers.js';
import {
    expectElementsDoNotOverlap,
    expectPageScreenshotSignal
} from './visual-assertions.js';

test.describe.configure({ mode: 'parallel' });

async function bootSeededDesktop(page) {
    const consoleErrors = await bootCleanApp(page);
    await seedCalculations(page);
    await expect(page.getByTestId('dashboard-grid')).toBeVisible();
    return consoleErrors;
}

async function expectDesktopChrome(page) {
    await expectElementsDoNotOverlap(page, [
        '.app-sidebar',
        '.app-topbar',
        '.app-main'
    ]);
}

test('dashboard keeps a non-empty desktop visual surface', async ({ page }) => {
    const consoleErrors = await bootSeededDesktop(page);

    await expect(page.locator('.dash-card-hero')).toBeVisible();
    await expectDesktopChrome(page);
    await expectPageScreenshotSignal(page, '.playwright-mcp/visual-dashboard.png', {
        minUniqueColorBuckets: 24,
        minNonBlankRatio: 0.18
    });

    expect(consoleErrors).toEqual([]);
});

test('details table keeps a readable desktop visual surface', async ({ page }) => {
    const consoleErrors = await bootSeededDesktop(page);

    await clickSidebarTab(page, 'details');
    await expect(page.locator('.details-table-cost')).toBeVisible();
    await expect(page.locator('.details-table-cost tbody tr').first()).toBeVisible();
    await expectDesktopChrome(page);
    await expectPageScreenshotSignal(page, '.playwright-mcp/visual-details.png', {
        minUniqueColorBuckets: 20,
        minNonBlankRatio: 0.14
    });

    expect(consoleErrors).toEqual([]);
});

test('comparison table keeps a non-empty desktop visual surface', async ({ page }) => {
    const consoleErrors = await bootSeededDesktop(page);

    await clickSidebarTab(page, 'comparison');
    await expect(page.locator('.comparison-table-unified')).toBeVisible();
    await expect(page.locator('.comparison-table-unified tbody tr').first()).toBeVisible();
    await expectDesktopChrome(page);
    await expectPageScreenshotSignal(page, '.playwright-mcp/visual-comparison.png', {
        minUniqueColorBuckets: 20,
        minNonBlankRatio: 0.14
    });

    expect(consoleErrors).toEqual([]);
});

test('questionnaire settings keep a non-empty desktop visual surface', async ({ page }) => {
    const consoleErrors = await bootSeededDesktop(page);

    await clickSidebarTab(page, 'questionnaire');
    await expect(page.getByTestId('questionnaire-settings-panel')).toBeVisible();
    await expect(page.locator('.questionnaire-section').first()).toBeVisible();
    await expectDesktopChrome(page);
    await expectPageScreenshotSignal(page, '.playwright-mcp/visual-questionnaire.png', {
        minUniqueColorBuckets: 20,
        minNonBlankRatio: 0.16
    });

    expect(consoleErrors).toEqual([]);
});

test('decision memo modal keeps a non-empty desktop visual surface', async ({ page }) => {
    const consoleErrors = await bootSeededDesktop(page);

    await page.evaluate(async () => {
        const memoCtl = await import(new URL('js/controllers/decisionMemoController.js', document.baseURI).href);
        memoCtl.openDecisionMemoModal();
    });

    const modal = page.getByTestId('decision-memo-modal');
    await expect(modal).toBeVisible();
    await expect(page.getByTestId('decision-memo-preview').locator('table').first()).toBeVisible();
    await expectPageScreenshotSignal(page, '.playwright-mcp/visual-decision-memo.png', {
        minWidth: 1200,
        minHeight: 700,
        minUniqueColorBuckets: 18,
        minNonBlankRatio: 0.16
    });

    expect(consoleErrors).toEqual([]);
});
