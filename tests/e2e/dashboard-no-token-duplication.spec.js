/**
 * Регрессия: строка «Токены» НЕ должна дублироваться в одной карточке Дашборда.
 *
 * Bug repro (пользовательский скриншот v2.20.73, ПРОМ-карточка):
 * блок «Объёмы ресурсов» внизу карточки повторно показывал «ТОКЕНЫ 131 626 млн
 * токенов / мес», и тут же ниже блок «Объёмы AI-нагрузки» показывал то же
 * самое число. Это нарушение CLAUDE.md §11 «DRY ВНУТРИ scope: один индикатор
 * глобального состояния — на одну карточку».
 *
 * Причина: `resourcesWithTokenMetric()` инжектировал TOKENS в resourceMap, а
 * `renderAiMetricsBlock` рендерил TOKENS отдельным блоком на той же карточке.
 *
 * Контракт после фикса:
 *   - «Объёмы ресурсов» содержит ТОЛЬКО hardware: CPU/GPU/RAM/SSD/HDD/S3.
 *   - «Объёмы AI-нагрузки» (sub-block ниже) содержит TOKENS / RAG / EMBEDDINGS /
 *     CPU агентов.
 *   - В каждом scope (итого + 5 стенд-карточек) строка «Токены» встречается
 *     ровно 1 раз.
 */

import { expect, test } from '@playwright/test';
import { bootCleanApp, clickSidebarTab } from './helpers.js';

test.describe.configure({ mode: 'parallel' });

const HIGH_AI_CALC = {
    id: 'no-token-dup-fixture',
    name: 'No-duplication fixture',
    schemaVersion: 20,
    settings: {
        period: 'monthly',
        phaseDurationMonths: 12,
        kInflation: 0.1,
        kSeasonal: 0,
        kScheduleShift: 0.05,
        kContingency: 0.05,
        bufferTask: 0.1,
        bufferProject: 0.1,
        vatEnabled: true,
        vatRate: 0.22,
        planningHorizonYears: 1,
        daysPerMonth: 30,
        standSizeRatio: { DEV: 0.2, IFT: 0.4, PSI: 0.5, LOAD: 1, PROD: 1 },
        aiStandFactor: { DEV: 0.02, IFT: 0.05, PSI: 0.1, LOAD: 1, PROD: 1 },
        applyRiskFactors: false,
        provider: 'sbercloud'
    },
    answers: {
        ai_llm_used: true,
        ai_hosting_mode: 'external_api',
        ai_model_tier: 'heavy',
        registered_users_total: 500000,
        dau_share_of_registered_percent: 20,
        ai_users_share: 75,
        ai_requests_per_user_day: 30,
        ai_avg_input_tokens: 3000,
        ai_avg_output_tokens: 500,
        ai_caching_share: 30
    },
    view: { disabledStands: [] }
};

async function importHighAiCalc(page) {
    await page.evaluate(async (data) => {
        const calcList = await import(new URL('js/controllers/calcListController.js', document.baseURI).href);
        await calcList.importCalcFromFile({
            _pickFile: async () => ({ name: 'high-ai.json' }),
            _readJsonFile: async () => ({ data })
        });
    }, HIGH_AI_CALC);
}

test('Итого-объёмы и стенд-карточки: «Токены» появляется ровно один раз на scope', async ({ page }) => {
    const consoleErrors = await bootCleanApp(page);
    await importHighAiCalc(page);
    await clickSidebarTab(page, 'dashboard');

    // Total scope: считаем сколько раз строка с label «Токены» / «ТОКЕНЫ» встречается
    const totalMetrics = page.locator('.dash-dashboard-metrics');
    await expect(totalMetrics).toBeVisible();
    // Считаем по label-элементам (а не по тексту «Токены» где он может быть в tooltip)
    const totalTokenLabels = await totalMetrics
        .locator('.dash-resource-row-label, .dash-ai-metric-row-label')
        .filter({ hasText: /^токены$/i })
        .count();
    expect(totalTokenLabels,
        `Total metrics: «Токены» должно быть ровно один раз (получено ${totalTokenLabels})`)
        .toBe(1);

    // Per-stand cards
    for (const sid of ['PROD', 'LOAD', 'PSI', 'IFT', 'DEV']) {
        const card = page.getByTestId(`dashboard-stand-${sid}`);
        await expect(card).toBeVisible();
        const standTokenLabels = await card
            .locator('.dash-resource-row-label, .dash-ai-metric-row-label')
            .filter({ hasText: /^токены$/i })
            .count();
        expect(standTokenLabels,
            `Stand ${sid} card: «Токены» должно быть ровно один раз (получено ${standTokenLabels})`)
            .toBe(1);
    }

    expect(consoleErrors).toEqual([]);
});

test('«Токены» живёт ТОЛЬКО в блоке «Объёмы AI-нагрузки», не в «Объёмы ресурсов»', async ({ page }) => {
    const consoleErrors = await bootCleanApp(page);
    await importHighAiCalc(page);
    await clickSidebarTab(page, 'dashboard');

    const totalMetrics = page.locator('.dash-dashboard-metrics');

    // В resources-блоке (.dash-resources) НЕ должно быть строки Токены
    const tokensInResources = await totalMetrics
        .locator('.dash-resources .dash-resource-row-label')
        .filter({ hasText: /^токены$/i })
        .count();
    expect(tokensInResources,
        'Блок «Объёмы ресурсов» не должен содержать строку «Токены» — она дублирует «Объёмы AI-нагрузки»')
        .toBe(0);

    // Зато в ai-metrics блоке должен быть
    const tokensInAi = await totalMetrics
        .locator('.dash-ai-metrics .dash-ai-metric-row-label, .dash-ai-metric-row-label')
        .filter({ hasText: /^токены$/i })
        .count();
    expect(tokensInAi,
        'Блок «Объёмы AI-нагрузки» должен содержать строку «Токены»')
        .toBeGreaterThanOrEqual(1);

    expect(consoleErrors).toEqual([]);
});
