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

        const resourceDisplayLabel = (label) => label;
        const aiDisplayLabel = (label) => DASHBOARD_AI_METRIC_TITLES[label] || label;
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
                total: positiveLabels(resources.total, resourceDisplayLabel),
                perStand: Object.fromEntries(STAND_IDS.map(sid => [
                    sid,
                    positiveLabels(resources.perStand?.[sid], resourceDisplayLabel)
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
        return page.locator('.dash-dashboard-metrics .dash-resources')
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
        return page.locator('.dash-dashboard-metrics .dash-ai-metrics')
            .filter({ hasText: 'Объёмы AI-нагрузки · ИТОГО' })
            .first();
    }
    return page.getByTestId(`dashboard-stand-${standId}`)
        .locator('.dash-ai-metrics')
        .filter({ hasText: 'Объёмы AI-нагрузки' })
        .first();
}

async function expectResourceRowsVisible(page, block, labels) {
    await Promise.all(labels.map(async label => {
        const row = block.locator('.dash-resource-row').filter({ hasText: label });
        await expect(row, `Dashboard resource row "${label}" must be visible`).toBeVisible();
        await expect(row.locator('.dash-resource-row-qty-empty'), `Dashboard resource row "${label}" must not be empty`)
            .toHaveCount(0);
    }));
}

async function expectAiRowsVisible(page, block, labels) {
    await Promise.all(labels.map(async label => {
        const row = block.locator('.dash-ai-metric-row').filter({ hasText: label });
        await expect(row, `Dashboard AI row "${label}" must be visible`).toBeVisible();
        await expect(row.locator('.dash-ai-metric-row-qty-empty'), `Dashboard AI row "${label}" must not be empty`)
            .toHaveCount(0);
    }));
}

async function expectDashboardPositiveRowsVisible(page) {
    const expected = await getExpectedPositiveVisibility(page);

    await expectResourceRowsVisible(page, dashboardResourceBlock(page, 'total'), expected.resources.total);
    await expectAiRowsVisible(page, dashboardAiBlock(page, 'total'), expected.ai.total);

    await Promise.all(Object.entries(expected.resources.perStand).map(async ([standId, labels]) => {
        await expectResourceRowsVisible(page, dashboardResourceBlock(page, 'stand', standId), labels);
    }));
    await Promise.all(Object.entries(expected.ai.perStand).map(async ([standId, labels]) => {
        if (labels.length === 0) return;
        await expectAiRowsVisible(page, dashboardAiBlock(page, 'stand', standId), labels);
    }));
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

    await Promise.all(expected.qtyItems.map(async item => {
        const row = page.locator(`.details-table-qty tbody tr.item-row[data-item-id="${item.id}"]`);
        await expect(row, `Details qty row "${item.name}" must be visible`).toBeVisible();
        await expect(row.locator('td.col-total').first(), `Details qty row "${item.name}" must have total qty`)
            .not.toHaveText('—');
    }));
}

function parseRuNumber(text) {
    const normalized = String(text || '')
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, '')
        .replace(',', '.');
    const match = normalized.match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : NaN;
}

async function standResourceQty(page, standId, label) {
    const row = dashboardResourceBlock(page, 'stand', standId)
        .locator('.dash-resource-row')
        .filter({ hasText: label })
        .first();
    await expect(row, `${standId} ${label} resource row`).toBeVisible();
    await expect(row.locator('.dash-resource-row-qty-empty')).toHaveCount(0);
    const text = await row.locator('.dash-resource-row-value').innerText();
    const qty = parseRuNumber(text);
    expect(Number.isFinite(qty), `${standId} ${label} qty from "${text}"`).toBe(true);
    return qty;
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

test('Dashboard stand cards show LOAD storage and RAM above PROD when ratio is 120%', async ({ page }) => {
    const consoleErrors = await bootCleanApp(page);

    await createCalculationFromQuickStart(page, {
        name: 'LOAD HDD ratio contract',
        presetId: 'high_ai'
    });
    await page.evaluate(async () => {
        const { store } = await import(new URL('js/state/store.js', document.baseURI).href);
        store.updateActiveCalc(calc => ({
            settings: {
                ...calc.settings,
                applyRiskFactors: false,
                vatEnabled: false,
                vatRate: 0,
                resourceRatio: {
                    ...calc.settings.resourceRatio,
                    PROD: {
                        ...calc.settings.resourceRatio?.PROD,
                        CPU: 1, GPU: 1, RAM: 1, SSD: 1, HDD: 1, S3: 1
                    },
                    LOAD: {
                        ...calc.settings.resourceRatio?.LOAD,
                        CPU: 1.2, GPU: 1.2, RAM: 1.2, SSD: 1.2, HDD: 1.2, S3: 1.2
                    }
                }
            },
            answers: {
                ...calc.answers,
                users_total: 55000,
                db_size_initial_gb: 100,
                db_growth_gb_month: 10,
                db_count: 2,
                backup_retention_days: 90,
                file_storage_volume_tb: 5,
                file_storage_growth_tb_year: 1,
                hot_data_share_percent: 30,
                peak_rps: 100,
                pcu_target: 0,
                microservices_count: 6,
                async_workers_count: 3,
                realtime_required: true,
                ram_per_vcpu_ratio: 4,
                cache_size_gb: 8
            }
        }));
    });

    const prodHdd = await standResourceQty(page, 'PROD', 'HDD');
    const loadHdd = await standResourceQty(page, 'LOAD', 'HDD');
    const prodRam = await standResourceQty(page, 'PROD', 'RAM');
    const loadRam = await standResourceQty(page, 'LOAD', 'RAM');

    expect(loadHdd, `LOAD HDD must be above PROD HDD: PROD=${prodHdd}, LOAD=${loadHdd}`)
        .toBeGreaterThan(prodHdd);
    expect(loadHdd, `LOAD HDD must be PROD HDD × 1.2: PROD=${prodHdd}, LOAD=${loadHdd}`)
        .toBeCloseTo(prodHdd * 1.2, 1);
    expect(loadRam, `LOAD RAM must be above PROD RAM: PROD=${prodRam}, LOAD=${loadRam}`)
        .toBeGreaterThan(prodRam);
    expect(prodRam, 'fixture must keep the user-visible PROD RAM anchor at 56 GB')
        .toBe(56);
    expect(loadRam, `LOAD RAM must be ceil(PROD RAM × 1.2): PROD=${prodRam}, LOAD=${loadRam}`)
        .toBe(Math.ceil(prodRam * 1.2));

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
