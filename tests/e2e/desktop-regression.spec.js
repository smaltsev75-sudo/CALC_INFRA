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
        const calcCtl = await import(new URL('js/controllers/calcController.js', document.baseURI).href);
        calcCtl.setAnswer(id, nextValue);
    }, { id: fieldId, nextValue: value });
}

async function setSetting(page, key, value) {
    await page.evaluate(async ({ settingKey, nextValue }) => {
        const calcCtl = await import(new URL('js/controllers/calcController.js', document.baseURI).href);
        calcCtl.setSetting(settingKey, nextValue);
    }, { settingKey: key, nextValue: value });
}

async function toggleStand(page, standId) {
    await page.evaluate(async (id) => {
        const calcCtl = await import(new URL('js/controllers/calcController.js', document.baseURI).href);
        calcCtl.toggleStand(id);
    }, standId);
}

async function setManualVatRate(page, rate) {
    await page.evaluate(async (value) => {
        const calcCtl = await import(new URL('js/controllers/calcController.js', document.baseURI).href);
        calcCtl.setVatRateManual(value);
    }, rate);
}

test('Dashboard and Details match calculation model for a seeded desktop project', async ({ page }) => {
    const consoleErrors = await bootCleanApp(page);
    await seedCalculations(page);

    await expect(page.locator('.dashboard-grid')).toBeVisible();
    await expect(page.getByTestId('dashboard-provider-price-actuality'))
        .toContainText('Актуальность прайса: 22.05.2026');
    await expect(page.getByTestId('dashboard-provider-price-actuality'))
        .not.toContainText('версия');
    await expect(page.getByTestId('dashboard-provider-price-actuality'))
        .not.toHaveAttribute('title', /.+/);
    await expectDashboardMatchesModel(page);

    await switchTab(page, 'details');
    await expect(page.locator('.details-table-cost')).toBeVisible();
    await expect(page.locator('.details-provider-price-actuality'))
        .toContainText('Актуальность прайса: 22.05.2026');
    await expect(page.locator('.details-provider-price-actuality'))
        .not.toContainText('версия');
    await expect(page.locator('.details-provider-price-actuality'))
        .not.toHaveAttribute('title', /.+/);
    await expectDetailsCostCategoriesMatchModel(page);

    expect(consoleErrors).toEqual([]);
});

test('Changing a key answer recalculates Dashboard and Details consistently', async ({ page }) => {
    const consoleErrors = await bootCleanApp(page);
    await seedCalculations(page);

    const before = await getCalculationUiModel(page);
    const nextPeakRps = await page.evaluate(async () => {
        const { store } = await import(new URL('js/state/store.js', document.baseURI).href);
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

test('Provider price summary preserves decimal comma in expanded tariff rows', async ({ page }) => {
    const consoleErrors = await bootCleanApp(page);
    await seedCalculations(page);

    await page.evaluate(async () => {
        const { store } = await import(new URL('js/state/store.js', document.baseURI).href);
        store.setActiveTab('questionnaire');
        store.setUi({
            questionnaireSettingsOpen: true,
            providerOverlayExpanded: false
        });
    });

    const collapsedSummary = page.locator('.provider-price-summary:not(.is-expanded)');
    await expect(collapsedSummary).toBeVisible();
    await expect(collapsedSummary.locator('.provider-price-actuality'))
        .toContainText('Актуальность прайса: 22.05.2026');
    await expect(collapsedSummary.locator('.provider-price-actuality'))
        .not.toContainText('версия');
    await expect(collapsedSummary.locator('.provider-price-actuality'))
        .not.toHaveAttribute('title', /.+/);

    await page.locator('.provider-price-summary-header').click();
    const summary = page.locator('.provider-price-summary.is-expanded');
    await expect(summary).toBeVisible();
    await expect(summary.locator('.provider-price-actuality'))
        .toContainText('Актуальность прайса: 22.05.2026');
    await expect(summary.locator('.provider-price-actuality'))
        .not.toContainText('версия');
    await expect(summary.locator('.provider-price-actuality'))
        .not.toHaveAttribute('title', /.+/);

    const ssdRowValue = summary
        .locator('.provider-price-row')
        .filter({ hasText: 'SSD' })
        .locator('.provider-price-row-value-num');
    await expect(ssdRowValue).toHaveText(/9\s*717,76/);
    await expect(ssdRowValue).not.toHaveText(/9\s*717\s+76/);

    await expect(summary.locator('.provider-price-trust-notice .provider-price-trust-badge'))
        .toHaveText('Проверено');
    await expect(summary.locator('.provider-price-category-list .provider-price-trust-badge'))
        .toHaveCount(0);
    await expect(summary.locator('abbr.term-hint', { hasText: 'WAF' }))
        .toHaveAttribute('title', /защита веб-приложений/);

    await page.getByTestId('setting-provider').selectOption('vk');
    await expect(summary.locator('.provider-price-trust-notice'))
        .toContainText('WAF/DDoS по запросу');

    const vkWafRow = summary
        .locator('.provider-price-row')
        .filter({ hasText: 'WAF' });
    await expect(vkWafRow.locator('.provider-price-row-value-num')).toHaveText('по запросу');
    await expect(vkWafRow.locator('.provider-price-trust-badge')).toHaveText('По запросу');
    await expect(vkWafRow.locator('abbr.term-hint')).toHaveAttribute('title', /защита веб-приложений/);

    await page.locator('.provider-analytics-btn').click();
    const analyticsModal = page.locator('.modal-overlay').filter({ hasText: 'Прайс-бенчмарк' });
    await expect(analyticsModal.locator('.modal')).toHaveClass(/modal-analytics/);
    await expect(analyticsModal.locator('.analytics-trust-matrix')).toBeVisible();
    await expect(analyticsModal.locator('.analytics-trust-matrix')).toContainText('Cloud.ru vs Yandex vs VK');
    await expect(analyticsModal.locator('.analytics-trust-matrix .analytics-provider-meta')).toHaveCount(0);
    await expect(analyticsModal.locator('.analytics-table .analytics-provider-meta')).toHaveCount(3);
    await expect(analyticsModal.locator('.analytics-table .analytics-provider-meta').first())
        .toContainText('Актуальность прайса:');
    await expect(analyticsModal.locator('.analytics-table .analytics-provider-meta').first())
        .not.toContainText('версия');
    await expect(analyticsModal.locator('.analytics-table .analytics-provider-meta').first())
        .not.toHaveAttribute('title', /.+/);
    await expect(analyticsModal.locator('.analytics-hint')).toContainText('Показаны до 6 крупнейших ЭК');
    await expect(analyticsModal.locator('.analytics-hint')).toContainText('публичная цена Cloud.ru');
    const benchmarkCategoryCount = await analyticsModal.locator('.analytics-cat-toggle').count();
    expect(benchmarkCategoryCount).toBeGreaterThan(0);
    expect(benchmarkCategoryCount).toBeLessThanOrEqual(6);
    await expect(analyticsModal.locator('.analytics-th-cat')).toHaveCount(benchmarkCategoryCount);
    const cloudBenchmarkRow = analyticsModal.locator('.analytics-table tbody tr')
        .filter({ hasText: 'Cloud.ru' });
    await expect(cloudBenchmarkRow.locator('.analytics-td-cat-empty')).toHaveCount(0);
    await expect(cloudBenchmarkRow).not.toContainText('Нет цены');
    await expect(cloudBenchmarkRow.locator('.analytics-td-cat-price')).toHaveCount(benchmarkCategoryCount);
    await expect.poll(async () => analyticsModal.locator('.analytics-table').evaluate(table => {
        const headers = [...table.querySelectorAll('thead .analytics-th-cat')];
        const cells = [...table.querySelectorAll('tbody tr:first-child .analytics-td-cat')];
        return headers.length === cells.length && headers.every((th, index) =>
            getComputedStyle(th).textAlign === 'right'
            && getComputedStyle(cells[index]).textAlign === 'right');
    })).toBe(true);
    await expect.poll(async () => cloudBenchmarkRow.evaluate(row => {
        const sum = [...row.querySelectorAll('.analytics-td-cat')]
            .reduce((acc, td) => acc + Number(td.getAttribute('data-monthly-impact') || 0), 0);
        const total = Number(row.querySelector('.analytics-td-total')?.getAttribute('data-total-cost'));
        return Number.isFinite(total) && Math.abs(sum - total) < 0.01;
    })).toBe(true);
    await expect(analyticsModal.locator('.analytics-th-total')).toContainText('Вклад ЭК');
    await expect.poll(async () => analyticsModal.locator('.analytics-trust-matrix-wrap')
        .evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await expect.poll(async () => analyticsModal.locator('.analytics-table')
        .evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);

    expect(consoleErrors).toEqual([]);
});

test('Help modal renders scannable UserManual on desktop', async ({ page }) => {
    const consoleErrors = await bootCleanApp(page);

    const advancedToggle = page.getByTestId('sidebar-advanced-toggle');
    const helpButton = page.getByTestId('sidebar-help-button');
    await expect(advancedToggle).not.toHaveAttribute('title', /.+/);
    await expect(helpButton).not.toHaveAttribute('title', /.+/);

    const advancedBox = await advancedToggle.boundingBox();
    const helpBox = await helpButton.boundingBox();
    expect(advancedBox).not.toBeNull();
    expect(helpBox).not.toBeNull();
    expect(helpBox.y).toBeGreaterThanOrEqual(advancedBox.y + advancedBox.height - 1);

    await helpButton.hover();
    await expect(helpButton).not.toHaveAttribute('title', /.+/);
    await helpButton.click();
    const modal = page.locator('.modal-overlay').filter({ hasText: 'Справка' });
    await expect(modal.locator('.modal')).toBeVisible();

    const helpContent = modal.locator('.help-content').first();
    await expect(helpContent.locator('h2', { hasText: 'С чего начать' })).toBeVisible();
    await expect(helpContent.locator('table').filter({ hasText: 'Получить первую оценку' })).toBeVisible();
    await expect(helpContent.locator('h2', { hasText: 'Типовой сценарий использования' })).toBeVisible();
    await expect(helpContent).toContainText('без технического словаря');
    await expect(helpContent).toContainText('WAF (защита веб-приложений)');
    await expect(helpContent).toContainText('DDoS (защита от распределённых атак)');
    await expect(modal.locator('h2', { hasText: 'Горячие клавиши' })).toHaveCount(1);
    await expect(helpContent.locator('pre').filter({ hasText: 'Расчёты → Новый расчёт' })).toHaveCount(0);
    await expect.poll(async () => helpContent.evaluate(el => getComputedStyle(el).maxWidth))
        .toBe('940px');
    await expect.poll(async () => modal.locator('.modal').evaluate(el => el.scrollWidth <= el.clientWidth + 1))
        .toBe(true);

    expect(consoleErrors).toEqual([]);
});

test('Details qty renders notification package units without numeric duplication', async ({ page }) => {
    const consoleErrors = await bootCleanApp(page);
    await seedCalculations(page);

    await switchTab(page, 'details');
    await page.getByRole('button', { name: 'Объём (qty)' }).click();
    await expect(page.locator('.details-table-qty')).toBeVisible();

    const servicesCategory = page
        .locator('.details-table-qty tbody tr.category-row')
        .filter({ hasText: 'УСЛУГИ' })
        .first();
    await servicesCategory.click();

    const smsRow = page
        .locator('.details-table-qty tbody tr.item-row')
        .filter({ hasText: 'SMS-уведомления' });
    const emailRow = page
        .locator('.details-table-qty tbody tr.item-row')
        .filter({ hasText: 'Email-уведомления' });
    const pushRow = page
        .locator('.details-table-qty tbody tr.item-row')
        .filter({ hasText: 'PUSH-уведомления' });

    await expect(smsRow).toContainText(/тыс\.\s*SMS/);
    await expect(emailRow).toContainText(/тыс\.\s*писем/);
    await expect(pushRow).toContainText(/млн\s*PUSH/);

    await expect(smsRow).not.toContainText(/\b1000\s+SMS\b/);
    await expect(emailRow).not.toContainText(/\b1000\s+писем\b/);
    await expect(pushRow).not.toContainText(/\b\d+\s+1\s+млн\s+PUSH\b/);

    expect(consoleErrors).toEqual([]);
});
