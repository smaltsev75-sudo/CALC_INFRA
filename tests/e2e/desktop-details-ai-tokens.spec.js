import { expect, test } from '@playwright/test';
import {
    bootCleanApp,
    clickSidebarTab,
    createCalculationFromQuickStart,
    expectDashboardDetailsConsistency
} from './helpers.js';

test.describe.configure({ mode: 'parallel' });

function aiSummaryRow(page, label) {
    return page.locator('.details-ai-summary-table tbody tr').filter({ hasText: label });
}

function dashboardAiRow(page, label) {
    return page.locator('.dash-card-hero .dash-ai-metric-row').filter({ hasText: label });
}

function dashboardHeroResourceRow(page, label) {
    const block = page.locator('.dash-card-hero .dash-resources')
        .filter({ hasText: 'Объёмы ресурсов · ИТОГО' })
        .first();
    return block.locator('.dash-resource-row').filter({ hasText: label });
}

function dashboardStandResourceRow(page, standId, label) {
    return page.getByTestId(`dashboard-stand-${standId}`)
        .locator('.dash-resources')
        .filter({ hasText: 'Объёмы ресурсов' })
        .first()
        .locator('.dash-resource-row')
        .filter({ hasText: label });
}

async function expectDashboardTokensVisible(page) {
    const row = dashboardAiRow(page, 'Токены');
    await expect(page.locator('.dash-card-hero .dash-ai-metrics')).toBeVisible();
    await expect(page.locator('.dash-card-hero .dash-ai-metrics-title'))
        .toHaveText('Объёмы AI-нагрузки · ИТОГО');
    await expect(row).toBeVisible();
    await expect(row.locator('.dash-ai-metric-row-value')).toContainText(/млн токенов \/ мес/);
    await expect(row.locator('.dash-ai-metric-row-qty-empty')).toHaveCount(0);

    const resourceRow = dashboardHeroResourceRow(page, 'Токены');
    await expect(resourceRow).toBeVisible();
    await expect(resourceRow.locator('.dash-resource-row-value')).toContainText(/млн токенов \/ мес/);
    await expect(resourceRow.locator('.dash-resource-row-qty-empty')).toHaveCount(0);
}

async function expectDashboardResourceTokensVisible(page, standId) {
    const row = dashboardStandResourceRow(page, standId, 'Токены');
    await expect(row).toBeVisible();
    await expect(row.locator('.dash-resource-row-value')).toContainText(/млн токенов \/ мес/);
    await expect(row.locator('.dash-resource-row-qty-empty')).toHaveCount(0);
}

async function expectDashboardStorageVisible(page, standId) {
    const card = page.getByTestId(`dashboard-stand-${standId}`);
    await expect(card).toBeVisible();
    for (const label of ['SSD', 'HDD']) {
        const row = card.locator('.dash-resource-row').filter({ hasText: label });
        await expect(row).toBeVisible();
        await expect(row.locator('.dash-resource-row-qty-empty')).toHaveCount(0);
        await expect(row.locator('.dash-resource-row-value')).toContainText(/ТБ/);
    }
}

async function expectTokensQtySummaryVisible(page) {
    const row = aiSummaryRow(page, 'Токены');
    await expect(row).toBeVisible();
    await expect(row.locator('.details-ai-cell-total')).toContainText(/млн токенов \/ мес/);
    await expect(row.locator('.details-ai-cell-total')).not.toHaveText('—');
}

async function expectTokensBudgetSummaryVisible(page) {
    const row = aiSummaryRow(page, 'Токены');
    await expect(row).toBeVisible();
    await expect(row.locator('.details-ai-cell-total')).toContainText('₽');
    await expect(row.locator('.details-ai-cell-total')).toHaveText(/[1-9]/);
    await expect(row.locator('.details-ai-cell-total')).not.toContainText(/млн токенов/);
}

async function expectTokensBudgetSummaryZero(page) {
    const row = aiSummaryRow(page, 'Токены');
    await expect(row).toBeVisible();
    await expect(row.locator('.details-ai-cell-total')).toHaveText('—');
    await expect(row.locator('.details-ai-cell-total')).not.toContainText(/млн токенов/);
}

async function expandAiCategoryIfNeeded(page, tableSelector) {
    const inputRow = page.locator(`${tableSelector} tbody tr.item-row`).filter({ hasText: 'Входящие токены LLM' });
    if (await inputRow.count()) return;

    const aiCategory = page
        .locator(`${tableSelector} tbody tr.category-row`)
        .filter({ hasText: 'AI / LLM' })
        .first();
    await expect(aiCategory).toBeVisible();
    await aiCategory.click();
}

async function expectTokenItemRowsVisible(page, tableSelector) {
    await expandAiCategoryIfNeeded(page, tableSelector);

    const inputRow = page.locator(`${tableSelector} tbody tr.item-row`).filter({ hasText: 'Входящие токены LLM' });
    const outputRow = page.locator(`${tableSelector} tbody tr.item-row`).filter({ hasText: 'Исходящие токены LLM' });
    await expect(inputRow).toBeVisible();
    await expect(outputRow).toBeVisible();

    if (tableSelector.includes('details-table-cost')) {
        await expectPositiveRubRow(inputRow);
        await expectPositiveRubRow(outputRow);
        return;
    }

    await expectPositiveQtyRow(inputRow, /млн токенов/);
    await expectPositiveQtyRow(outputRow, /млн токенов/);
}

async function expectPositiveRubRow(row) {
    const total = row.locator('td.col-total').first();
    await expect(total).toContainText('₽');
    await expect(total).toHaveText(/[1-9]/);
    await expect(total).not.toHaveText(/^\s*(?:—|0\s*₽)\s*$/);

    const standTexts = await row.locator('td.col-stand').allTextContents();
    expect(standTexts.some(text => /[1-9]/.test(text) && text.includes('₽'))).toBeTruthy();
}

async function expectPositiveQtyRow(row, unitPattern) {
    const total = row.locator('td.col-total').first();
    await expect(total).toContainText(unitPattern);
    await expect(total).toHaveText(/[1-9]/);
    await expect(total).not.toHaveText(/^\s*—\s*$/);

    const standTexts = await row.locator('td.col-stand').allTextContents();
    expect(standTexts.some(text => /[1-9]/.test(text))).toBeTruthy();
}

test('Details shows calculated LLM tokens on Budget and Qty for Quick Start AI', async ({ page }) => {
    const consoleErrors = await bootCleanApp(page);

    await createCalculationFromQuickStart(page, {
        name: 'Details tokens contract',
        presetId: 'high_ai'
    });

    await expectDashboardTokensVisible(page);
    await expectDashboardDetailsConsistency(page);
    await expectDashboardResourceTokensVisible(page, 'DEV');
    await expectDashboardResourceTokensVisible(page, 'IFT');
    await expectDashboardResourceTokensVisible(page, 'LOAD');
    await expectDashboardStorageVisible(page, 'DEV');
    await expectDashboardStorageVisible(page, 'IFT');
    await expectDashboardStorageVisible(page, 'LOAD');

    await clickSidebarTab(page, 'details');
    await expect(page.locator('.details-table-cost')).toBeVisible();
    await expect(page.locator('.details-ai-summary')).toBeVisible();
    await expectTokensBudgetSummaryVisible(page);

    const cpuAgentsRow = aiSummaryRow(page, 'CPU агентов');
    await expect(cpuAgentsRow).toBeVisible();

    await page.locator('.details-hide-zero').click();
    await expectTokensBudgetSummaryVisible(page);
    await expect(cpuAgentsRow).toHaveCount(0);

    await expectTokenItemRowsVisible(page, '.details-table-cost');

    await page.getByRole('button', { name: 'Объём (qty)' }).click();
    await expect(page.locator('.details-table-qty')).toBeVisible();
    await expect(page.locator('.details-ai-summary')).toBeVisible();
    await expectTokensQtySummaryVisible(page);
    await expect(aiSummaryRow(page, 'CPU агентов')).toHaveCount(0);
    await expectTokenItemRowsVisible(page, '.details-table-qty');

    expect(consoleErrors).toEqual([]);
});

test('Dashboard and Details show token workload when LLM is hosted on own GPU', async ({ page }) => {
    const consoleErrors = await bootCleanApp(page);

    await createCalculationFromQuickStart(page, {
        name: 'On-prem token workload contract',
        presetId: 'high_ai'
    });

    await page.evaluate(async () => {
        const { store } = await import(new URL('js/state/store.js', document.baseURI).href);
        store.updateActiveCalc(calc => ({
            settings: {
                ...calc.settings,
                applyRiskFactors: false
            },
            answers: {
                ...calc.answers,
                ai_llm_used: true,
                ai_hosting_mode: 'on_prem_gpu',
                ai_avg_input_tokens: 2000,
                ai_avg_output_tokens: 500,
                ai_caching_share: 0,
                rag_needed: true,
                rag_corpus_size_gb: 2,
                rag_refresh_frequency: 'monthly'
            }
        }));
    });

    await expectDashboardTokensVisible(page);
    await expectDashboardDetailsConsistency(page);

    const tokenCostRows = page.locator('.dash-category-row').filter({ hasText: 'AI / LLM' });
    await expect(tokenCostRows.first()).toBeVisible();

    await clickSidebarTab(page, 'details');
    await expect(page.locator('.details-ai-summary')).toBeVisible();
    await expectTokensBudgetSummaryZero(page);

    await page.getByRole('button', { name: 'Объём (qty)' }).click();
    await expect(page.locator('.details-table-qty')).toBeVisible();
    await expectTokensQtySummaryVisible(page);
    await expectTokenItemRowsVisible(page, '.details-table-qty');

    expect(consoleErrors).toEqual([]);
});

test('Details and Dashboard restore token workload from explicit token answers when token rows are zero', async ({ page }) => {
    const consoleErrors = await bootCleanApp(page);

    await createCalculationFromQuickStart(page, {
        name: 'Details token fallback contract',
        presetId: 'high_ai'
    });

    await page.evaluate(async () => {
        const { store } = await import(new URL('js/state/store.js', document.baseURI).href);
        const { STAND_IDS } = await import(new URL('js/utils/constants.js', document.baseURI).href);
        store.updateActiveCalc(calc => ({
            answers: {
                ...calc.answers,
                ai_llm_used: false,
                ai_hosting_mode: 'external_api',
                ai_requests_per_user_day: 30,
                ai_avg_input_tokens: 2000,
                ai_avg_output_tokens: 500,
                ai_caching_share: 0
            },
            answersMeta: {
                ...(calc.answersMeta || {}),
                ai_requests_per_user_day: { source: 'manual' },
                ai_avg_input_tokens: { source: 'manual' },
                ai_avg_output_tokens: { source: 'manual' },
                ai_caching_share: { source: 'manual' }
            },
            dictionaries: {
                ...calc.dictionaries,
                items: calc.dictionaries.items.map(item => (
                    item.dashboardAiMetric === 'TOKENS'
                        ? {
                            ...item,
                            qtyFormulas: Object.fromEntries(STAND_IDS.map(sid => [sid, '0']))
                        }
                        : item
                ))
            }
        }));
    });

    await expectDashboardTokensVisible(page);
    await expectDashboardDetailsConsistency(page);

    await clickSidebarTab(page, 'details');
    await expect(page.locator('.details-ai-summary')).toBeVisible();
    await expectTokensBudgetSummaryVisible(page);

    await page.locator('.details-hide-zero').click();
    await expectTokensBudgetSummaryVisible(page);
    await expectTokenItemRowsVisible(page, '.details-table-cost');

    await page.getByRole('button', { name: 'Объём (qty)' }).click();
    await expect(page.locator('.details-table-qty')).toBeVisible();
    await expectTokenItemRowsVisible(page, '.details-table-qty');

    expect(consoleErrors).toEqual([]);
});
