import { expect, test } from '@playwright/test';
import {
    bootCleanApp,
    expectDashboardMatchesModel,
    expectDetailsCostCategoriesMatchModel,
    getCalculationUiModel,
    readDashboardUi,
    seedCalculations,
    switchTab
} from './helpers.js';

test.describe.configure({ mode: 'parallel' });

async function setAnswer(page, fieldId, value) {
    await page.evaluate(async ({ id, nextValue }) => {
        const calcCtl = await import('/js/controllers/calcController.js');
        calcCtl.setAnswer(id, nextValue);
    }, { id: fieldId, nextValue: value });
}

async function setSetting(page, key, value) {
    await page.evaluate(async ({ settingKey, nextValue }) => {
        const calcCtl = await import('/js/controllers/calcController.js');
        calcCtl.setSetting(settingKey, nextValue);
    }, { settingKey: key, nextValue: value });
}

async function toggleStand(page, standId) {
    await page.evaluate(async (id) => {
        const calcCtl = await import('/js/controllers/calcController.js');
        calcCtl.toggleStand(id);
    }, standId);
}

async function setManualVatRate(page, rate) {
    await page.evaluate(async (value) => {
        const calcCtl = await import('/js/controllers/calcController.js');
        calcCtl.setVatRateManual(value);
    }, rate);
}

test('Dashboard and Details match calculation model for a seeded desktop project', async ({ page }) => {
    const consoleErrors = await bootCleanApp(page);
    await seedCalculations(page);

    await expect(page.locator('.dashboard-grid')).toBeVisible();
    await expectDashboardMatchesModel(page);

    await switchTab(page, 'details');
    await expect(page.locator('.details-table-cost')).toBeVisible();
    await expectDetailsCostCategoriesMatchModel(page);

    expect(consoleErrors).toEqual([]);
});

test('Changing a key answer recalculates Dashboard and Details consistently', async ({ page }) => {
    const consoleErrors = await bootCleanApp(page);
    await seedCalculations(page);

    const before = await getCalculationUiModel(page);
    const nextPeakRps = await page.evaluate(async () => {
        const { store } = await import('/js/state/store.js');
        const current = Number(store.getState().activeCalc?.answers?.peak_rps) || 0;
        return Math.max(current * 3, 3_000);
    });

    await setAnswer(page, 'peak_rps', nextPeakRps);

    await expect.poll(async () => (await getCalculationUiModel(page)).totalMonthly)
        .not.toBe(before.totalMonthly);
    await expectDashboardMatchesModel(page);

    await switchTab(page, 'details');
    await expect(page.locator('.details-table-cost')).toBeVisible();
    await expectDetailsCostCategoriesMatchModel(page);

    expect(consoleErrors).toEqual([]);
});

test('Disabled stand is excluded from active totals in Dashboard and Details', async ({ page }) => {
    const consoleErrors = await bootCleanApp(page);
    await seedCalculations(page);

    const before = await getCalculationUiModel(page);
    await toggleStand(page, 'LOAD');

    await expect.poll(async () => (await getCalculationUiModel(page)).disabledStands)
        .toContain('LOAD');
    const after = await expectDashboardMatchesModel(page);

    expect(after.totalMonthly).toBeLessThan(before.totalMonthly);
    expect(after.activeStands).not.toContain('LOAD');
    expect(after.dashboard.stands.at(-1)).toMatchObject({ id: 'LOAD', disabled: true });

    await switchTab(page, 'details');
    await expect(page.locator('.details-table-cost')).toBeVisible();
    await expectDetailsCostCategoriesMatchModel(page);

    expect(consoleErrors).toEqual([]);
});

test('Risk and VAT toggles stay independent in rendered desktop totals', async ({ page }) => {
    const consoleErrors = await bootCleanApp(page);
    await seedCalculations(page);

    await setSetting(page, 'applyRiskFactors', false);
    await setSetting(page, 'vatEnabled', false);
    const noRisksNoVat = await expectDashboardMatchesModel(page);
    let ui = await readDashboardUi(page);
    expect(ui.heroBadges).toContain('БЕЗ РИСКОВ');
    expect(ui.heroBadges).toContain('БЕЗ НДС');

    await setManualVatRate(page, 0.22);
    await setSetting(page, 'vatEnabled', true);
    const noRisksWithVat = await expectDashboardMatchesModel(page);
    ui = await readDashboardUi(page);
    expect(ui.heroBadges).toContain('БЕЗ РИСКОВ');
    expect(ui.heroBadges).toContain('С НДС 22%');

    expect(noRisksWithVat.totalMonthly / noRisksNoVat.totalMonthly).toBeCloseTo(1.22, 3);

    await setSetting(page, 'applyRiskFactors', true);
    const risksWithVat = await expectDashboardMatchesModel(page);
    ui = await readDashboardUi(page);
    expect(ui.heroBadges).toContain('С РИСКАМИ');
    expect(ui.heroBadges).toContain('С НДС 22%');
    expect(risksWithVat.totalMonthly).toBeGreaterThan(noRisksWithVat.totalMonthly);

    await switchTab(page, 'details');
    await expect(page.locator('.details-table-cost')).toBeVisible();
    await expectDetailsCostCategoriesMatchModel(page);

    expect(consoleErrors).toEqual([]);
});
