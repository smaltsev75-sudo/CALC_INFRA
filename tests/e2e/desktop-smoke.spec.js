import { expect, test } from '@playwright/test';
import {
    bootCleanApp,
    expectDetailsCostCategoriesMatchModel,
    expectNoHorizontalOverflow,
    seedCalculations,
    switchTab
} from './helpers.js';

test.describe.configure({ mode: 'parallel' });

test('dashboard and cost optimization planner render cleanly on desktop', async ({ page }) => {
    const consoleErrors = await bootCleanApp(page);
    await seedCalculations(page);

    await expect(page.locator('.dashboard-grid')).toBeVisible();
    await expect(page.locator('.dash-card-hero')).toBeVisible();

    await page.evaluate(async () => {
        const plannerCtl = await import(new URL('js/controllers/costOptimizationPlannerController.js', document.baseURI).href);
        plannerCtl.openCostOptimizationPlannerModal();
    });

    await expect(page.locator('.modal .cop-modal-body')).toBeVisible();
    await expect(page.locator('.cop-level-tabs')).toBeVisible();
    await expect(page.locator('.cop-summary-cards')).toBeVisible();
    await page.screenshot({ path: '.playwright-mcp/desktop-smoke-planner.png', fullPage: true });

    await expectNoHorizontalOverflow(page, [
        '.modal',
        '.modal-header',
        '.modal-footer-actions',
        '.cop-modal-footer',
        '.cop-level-tabs',
        '.cop-modal-constraints-grid',
        '.cop-summary-cards',
        '.cop-lever-group-header',
        '.cop-lever-head',
        '.cop-rollback-bar'
    ]);
    expect(consoleErrors).toEqual([]);
});

test('decision memo preview renders markdown tables on desktop', async ({ page }) => {
    const consoleErrors = await bootCleanApp(page);
    await seedCalculations(page);

    await page.evaluate(async () => {
        const memoCtl = await import(new URL('js/controllers/decisionMemoController.js', document.baseURI).href);
        memoCtl.openDecisionMemoModal();
    });

    await expect(page.locator('.decision-memo-preview')).toBeVisible();
    await expect(page.locator('.decision-memo-preview table').first()).toBeVisible();
    await page.screenshot({ path: '.playwright-mcp/desktop-smoke-decision-memo.png', fullPage: true });

    await expectNoHorizontalOverflow(page, [
        '.modal',
        '.modal-header',
        '.modal-footer-actions',
        '.decision-memo-modal-body',
        '.decision-memo-actions',
        '.decision-memo-preview'
    ]);
    expect(consoleErrors).toEqual([]);
});

test('details and comparison desktop tables render with seeded calculations', async ({ page }) => {
    const consoleErrors = await bootCleanApp(page);
    await seedCalculations(page);

    await switchTab(page, 'details');
    await expect(page.getByTestId('cost-check-report')).toBeVisible();
    await expect(page.getByTestId('cost-check-report')).toContainText('Проверка расчёта ЭК');
    await expect(page.getByTestId('cost-check-report')).toContainText('Источники');
    await expect(page.getByTestId('cost-check-report')).toContainText('Единицы');
    await expect(page.locator('.details-table-cost')).toBeVisible();
    await expect(page.locator('.details-table-cost tbody tr').first()).toBeVisible();
    await expectDetailsCostCategoriesMatchModel(page);
    await page.locator('.details-table-cost tbody .category-row-clickable').first().click();
    await expect(page.getByTestId('quantity-explain-button').first()).toBeVisible();
    await page.getByTestId('quantity-explain-button').first().click();
    await expect(page.locator('.modal-title')).toContainText('Почему столько?');
    await expect(page.getByTestId('quantity-explanation-panel')).toBeVisible();
    await expectNoHorizontalOverflow(page, [
        '.details-cost-check-report',
        '.cost-check-table',
        '.modal',
        '.formula-modal-body',
        '.quantity-explanation-panel',
        '.quantity-explanation-grid',
        '.quantity-explanation-card'
    ]);
    await page.locator('.modal-footer .btn-primary').click();
    await page.screenshot({ path: '.playwright-mcp/desktop-smoke-details.png', fullPage: true });

    await switchTab(page, 'comparison');
    await expect(page.locator('.comparison-table-unified')).toBeVisible();
    await expect(page.locator('.comparison-table-unified tbody tr').first()).toBeVisible();
    await page.screenshot({ path: '.playwright-mcp/desktop-smoke-comparison.png', fullPage: true });

    expect(consoleErrors).toEqual([]);
});
