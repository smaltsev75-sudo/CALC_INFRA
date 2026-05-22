import { expect, test } from '@playwright/test';
import {
    bootCleanApp,
    clickSidebarTab,
    createCalculationFromQuickStart,
    expectDashboardMatchesModel,
    expectDetailsCostCategoriesMatchModel,
    getCalculationUiModel,
    readDashboardUi
} from './helpers.js';

test.describe.configure({ mode: 'parallel' });

test('Quick Start creates a calculation and desktop navigation works through real clicks', async ({ page }) => {
    const consoleErrors = await bootCleanApp(page);

    await createCalculationFromQuickStart(page, {
        name: 'Desktop user flow: B2C AI',
        presetId: 'high_ai'
    });

    let model = await expectDashboardMatchesModel(page);
    expect(model.calcName).toBe('Desktop user flow: B2C AI');

    await page.getByTestId('dashboard-period-annual').click();
    await expect.poll(async () => (await getCalculationUiModel(page)).period).toBe('annual');
    await expectDashboardMatchesModel(page);

    await page.getByTestId('stand-toggle-LOAD').click();
    await expect.poll(async () => (await getCalculationUiModel(page)).disabledStands).toContain('LOAD');
    model = await expectDashboardMatchesModel(page);
    expect(model.activeStands).not.toContain('LOAD');

    await page.getByTestId('dashboard-hero-details').click();
    await expect(page.locator('.details-table-cost')).toBeVisible();
    await expectDetailsCostCategoriesMatchModel(page);

    await clickSidebarTab(page, 'comparison');
    await expect(page.locator('.comparison-picker')).toBeVisible();
    await expect(page.locator('.empty-state-title')).toContainText('Выберите расчёты');

    expect(consoleErrors).toEqual([]);
});

test('Questionnaire risk and VAT settings update rendered desktop totals through real clicks', async ({ page }) => {
    const consoleErrors = await bootCleanApp(page);

    await createCalculationFromQuickStart(page, {
        name: 'Desktop user flow: risk VAT',
        presetId: 'high_ai'
    });

    await clickSidebarTab(page, 'questionnaire');
    await expect(page.getByTestId('questionnaire-settings-panel')).toBeVisible();

    if ((await getCalculationUiModel(page)).settings.applyRiskFactors) {
        await page.getByTestId('setting-applyRiskFactors-toggle').click();
        await expect.poll(async () => (await getCalculationUiModel(page)).settings.applyRiskFactors).toBe(false);
    }
    if ((await getCalculationUiModel(page)).settings.vatEnabled) {
        await page.getByTestId('setting-vatEnabled-toggle').click();
        await expect.poll(async () => (await getCalculationUiModel(page)).settings.vatEnabled).toBe(false);
    }

    await page.getByTestId('setting-vatMode-manual').click();
    await page.getByTestId('setting-vatRate').fill('22');
    await expect.poll(async () => (await getCalculationUiModel(page)).settings.vatRate).toBeCloseTo(0.22, 6);

    await page.getByTestId('setting-vatEnabled-toggle').click();
    await expect.poll(async () => (await getCalculationUiModel(page)).settings.vatEnabled).toBe(true);

    await clickSidebarTab(page, 'dashboard');
    await expectDashboardMatchesModel(page);
    const ui = await readDashboardUi(page);
    expect(ui.heroBadges).toContain('БЕЗ РИСКОВ');
    expect(ui.heroBadges).toContain('С НДС 22%');

    await clickSidebarTab(page, 'details');
    await expect(page.locator('.details-table-cost')).toBeVisible();
    await expectDetailsCostCategoriesMatchModel(page);

    expect(consoleErrors).toEqual([]);
});

test('Cost optimization planner opens from the Dashboard CTA by user click', async ({ page }) => {
    const consoleErrors = await bootCleanApp(page);

    await createCalculationFromQuickStart(page, {
        name: 'Desktop user flow: planner',
        presetId: 'high_ai'
    });

    const plannerTrigger = page
        .locator('[data-testid="open-cost-optimization-planner"], [data-testid="next-step-cost_optimization_planner"]')
        .first();
    await expect(plannerTrigger).toBeVisible();
    await plannerTrigger.click();

    await expect(page.locator('.modal .cop-modal-body')).toBeVisible();
    await expect(page.locator('.cop-level-tabs')).toBeVisible();
    await expect(page.locator('.cop-summary-cards')).toBeVisible();

    expect(consoleErrors).toEqual([]);
});
