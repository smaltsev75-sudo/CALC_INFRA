import { expect, test } from '@playwright/test';
import {
    bootCleanApp,
    clickSidebarTab,
    createCalculationFromQuickStart,
    expectDashboardDetailsConsistency
} from './helpers.js';

test.describe.configure({ mode: 'parallel' });

async function getExpectedPositiveVisibility(page) {
    return page.evaluate(async () => {
        const { store } = await import(new URL('js/state/store.js', document.baseURI).href);
        const { calculate } = await import(new URL('js/domain/calculator.js', document.baseURI).href);
        const {
            aggregateAiMetrics,
            aggregateResources,
            deriveAiMetricItemQty,
            distributeRoundingPreservingSum
        } = await import(new URL('js/ui/dashboardAggregates.js', document.baseURI).href);
        const { effectiveQtyForDisplay } = await import(new URL('js/ui/detailsSections.js', document.baseURI).href);
        const {
            DASHBOARD_AI_METRIC_TITLES,
            STAND_IDS
        } = await import(new URL('js/utils/constants.js', document.baseURI).href);

        const state = store.getState();
        const calc = state.activeCalc;
        if (!calc) throw new Error('No active calculation');

        const result = calculate(calc, state.calcRevision);
        const disabledStands = calc.view?.disabledStands || [];
        const activeStands = STAND_IDS.filter(sid => !disabledStands.includes(sid));
        const applyRisks = calc.settings?.applyRiskFactors !== false;
        const items = calc.dictionaries?.items || [];
        const resources = aggregateResources(result, items, disabledStands, applyRisks);
        distributeRoundingPreservingSum(resources, activeStands);
        const aiMetrics = aggregateAiMetrics(result, items, disabledStands, applyRisks, calc);

        const resourceDisplayLabel = (label) =>
            label === 'TOKENS' ? (DASHBOARD_AI_METRIC_TITLES.TOKENS || 'Токены') : label;
        const aiDisplayLabel = (label) => DASHBOARD_AI_METRIC_TITLES[label] || label;
        const withTokenResource = (resourceMap = {}, aiMap = {}) => {
            const token = aiMap.TOKENS;
            const qty = Number(token?.qty) || 0;
            if (qty <= 0) return resourceMap;
            return {
                ...resourceMap,
                TOKENS: {
                    qty,
                    unit: token.unit || 'млн токенов',
                    applicable: token.applicable !== false
                }
            };
        };
        const positiveLabels = (map, toLabel) => Object.entries(map || {})
            .filter(([, entry]) => Number(entry?.qty) > 0)
            .map(([label]) => toLabel(label));

        const qtyItems = [];
        for (const item of items) {
            const itemResult = result.items?.[item.id];
            if (!itemResult) continue;
            const hasPositiveQty = activeStands.some(sid => {
                const cell = itemResult.stands?.[sid];
                if (!cell) return false;
                if (effectiveQtyForDisplay(cell, applyRisks) > 0) return true;
                return deriveAiMetricItemQty(calc, item.id, sid) > 0;
            });
            if (hasPositiveQty) qtyItems.push({ id: item.id, name: item.name || item.id });
        }

        return {
            resources: {
                total: positiveLabels(withTokenResource(resources.total, aiMetrics.total), resourceDisplayLabel),
                perStand: Object.fromEntries(STAND_IDS.map(sid => [
                    sid,
                    positiveLabels(withTokenResource(resources.perStand?.[sid], aiMetrics.perStand?.[sid]), resourceDisplayLabel)
                ]))
            },
            ai: {
                total: positiveLabels(aiMetrics.total, aiDisplayLabel),
                perStand: Object.fromEntries(STAND_IDS.map(sid => [
                    sid,
                    positiveLabels(aiMetrics.perStand?.[sid], aiDisplayLabel)
                ]))
            },
            qtyItems
        };
    });
}

function dashboardResourceBlock(page, scope, standId = null) {
    if (scope === 'total') {
        return page.locator('.dash-card-hero .dash-resources')
            .filter({ hasText: 'Объёмы ресурсов · ИТОГО' })
            .first();
    }
    return page.getByTestId(`dashboard-stand-${standId}`)
        .locator('.dash-resources')
        .filter({ hasText: 'Объёмы ресурсов' })
        .first();
}

function dashboardAiBlock(page, scope, standId = null) {
    if (scope === 'total') {
        return page.locator('.dash-card-hero .dash-ai-metrics')
            .filter({ hasText: 'Объёмы AI-нагрузки · ИТОГО' })
            .first();
    }
    return page.getByTestId(`dashboard-stand-${standId}`)
        .locator('.dash-ai-metrics')
        .filter({ hasText: 'Объёмы AI-нагрузки' })
        .first();
}

async function expectResourceRowsVisible(page, block, labels) {
    for (const label of labels) {
        const row = block.locator('.dash-resource-row').filter({ hasText: label });
        await expect(row, `Dashboard resource row "${label}" must be visible`).toBeVisible();
        await expect(row.locator('.dash-resource-row-qty-empty'), `Dashboard resource row "${label}" must not be empty`)
            .toHaveCount(0);
    }
}

async function expectAiRowsVisible(page, block, labels) {
    for (const label of labels) {
        const row = block.locator('.dash-ai-metric-row').filter({ hasText: label });
        await expect(row, `Dashboard AI row "${label}" must be visible`).toBeVisible();
        await expect(row.locator('.dash-ai-metric-row-qty-empty'), `Dashboard AI row "${label}" must not be empty`)
            .toHaveCount(0);
    }
}

async function expectDashboardPositiveRowsVisible(page) {
    const expected = await getExpectedPositiveVisibility(page);

    await expectResourceRowsVisible(page, dashboardResourceBlock(page, 'total'), expected.resources.total);
    await expectAiRowsVisible(page, dashboardAiBlock(page, 'total'), expected.ai.total);

    for (const [standId, labels] of Object.entries(expected.resources.perStand)) {
        await expectResourceRowsVisible(page, dashboardResourceBlock(page, 'stand', standId), labels);
    }
    for (const [standId, labels] of Object.entries(expected.ai.perStand)) {
        if (labels.length === 0) continue;
        await expectAiRowsVisible(page, dashboardAiBlock(page, 'stand', standId), labels);
    }
}

async function expectDetailsPositiveQtyRowsVisible(page) {
    const expected = await getExpectedPositiveVisibility(page);

    await clickSidebarTab(page, 'details');
    await page.getByRole('button', { name: 'Объём (qty)' }).click();
    await page.evaluate(async () => {
        const { store } = await import(new URL('js/state/store.js', document.baseURI).href);
        store.setUi({ detailsCollapsedCats: [] });
    });
    await expect(page.locator('.details-table-qty')).toBeVisible();

    for (const item of expected.qtyItems) {
        const row = page.locator(`.details-table-qty tbody tr.item-row[data-item-id="${item.id}"]`);
        await expect(row, `Details qty row "${item.name}" must be visible`).toBeVisible();
        await expect(row.locator('td.col-total').first(), `Details qty row "${item.name}" must have total qty`)
            .not.toHaveText('—');
    }
}

test('Quick Start renders every positive Dashboard resource and Details qty row', async ({ page }) => {
    const consoleErrors = await bootCleanApp(page);

    await createCalculationFromQuickStart(page, {
        name: 'Quick Start visibility contract',
        presetId: 'high_ai'
    });

    await expectDashboardDetailsConsistency(page);
    await expectDashboardPositiveRowsVisible(page);
    await expectDetailsPositiveQtyRowsVisible(page);
    await expectDashboardDetailsConsistency(page);

    expect(consoleErrors).toEqual([]);
});

test('Quick Start on-prem GPU renders every positive Dashboard resource and Details qty row', async ({ page }) => {
    const consoleErrors = await bootCleanApp(page);

    await createCalculationFromQuickStart(page, {
        name: 'Quick Start GPU visibility contract',
        presetId: 'high_ai'
    });
    await page.evaluate(async () => {
        const { store } = await import(new URL('js/state/store.js', document.baseURI).href);
        store.updateActiveCalc(calc => ({
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

    await expectDashboardDetailsConsistency(page);
    await expectDashboardPositiveRowsVisible(page);
    await expectDetailsPositiveQtyRowsVisible(page);
    await expectDashboardDetailsConsistency(page);

    expect(consoleErrors).toEqual([]);
});
