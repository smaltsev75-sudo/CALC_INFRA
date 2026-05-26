/**
 * Регрессия пользовательского кейса (2026-05-26): JSON-импорт с очень низкой
 * долей DAU (0.7% от 500 = 3.5 активных), heavy LLM, external_api hosting.
 *
 * До фикса token-fallback-on-NaN-formula: если в кэше браузера у пользователя
 * жила старая версия calculator (без `S.aiModelTierFactor` в context), формула
 * llm-tokens-input-1m возвращала 0 (или потенциально NaN при будущих ревизиях
 * formula-engine'а), что обнуляло токеновую нагрузку во всех трёх местах:
 *   1. Dashboard → «Объёмы AI-нагрузки» (ИТОГО и per-stand)
 *   2. Details → «Сводка AI-метрик» → строка «Токены»
 *   3. Details → раскрытый аккордеон «AI / LLM» → строки «Входящие/Исходящие
 *      токены LLM»
 *
 * Этот тест защищает все три места одной волной — фикс одного места без
 * остальных недостаточен, см. CLAUDE.md §Current Project Lessons «Token
 * visibility must be checked in the exact user-facing block» и «Dashboard
 * and Details must reconcile by construction».
 */

import { expect, test } from '@playwright/test';
import { bootCleanApp, clickSidebarTab, createCalculationFromQuickStart } from './helpers.js';

test.describe.configure({ mode: 'parallel' });

async function importLowDauHighAiCalc(page) {
    // Используем тот же путь, что и реальный пользователь: Quick Start + ручная подстановка.
    await createCalculationFromQuickStart(page, {
        name: 'Low DAU heavy AI regression',
        presetId: 'high_ai'
    });
    // Подстраиваем ответы под точный сценарий пользователя: very low DAU, heavy модель.
    await page.evaluate(async () => {
        const { store } = await import(new URL('js/state/store.js', document.baseURI).href);
        store.updateActiveCalc(calc => ({
            answers: {
                ...calc.answers,
                ai_llm_used: true,
                ai_hosting_mode: 'external_api',
                ai_model_tier: 'heavy',
                registered_users_total: 500,
                dau_share_of_registered_percent: 0.7,
                ai_users_share: 75,
                ai_requests_per_user_day: 30,
                ai_avg_input_tokens: 3000,
                ai_avg_output_tokens: 500,
                ai_caching_share: 30,
                ai_agent_mode: false,
                rag_needed: false,
                ai_safety_layer: false,
                ai_finetune_needed: false
            }
        }));
    });
}

test('Dashboard, AI summary и Details token rows показывают данные при low-DAU + heavy LLM', async ({ page }) => {
    const consoleErrors = await bootCleanApp(page);
    await importLowDauHighAiCalc(page);

    // 1. Dashboard «Объёмы AI-нагрузки» (ИТОГО): TOKENS > 0
    await expect(page.locator('.dash-card-hero .dash-ai-metric-row').filter({ hasText: 'Токены' }))
        .toBeVisible();
    await expect(page.locator('.dash-card-hero .dash-ai-metric-row').filter({ hasText: 'Токены' })
        .locator('.dash-ai-metric-row-qty-empty')).toHaveCount(0);

    // 2. Dashboard per-stand cards: TOKENS видимы для PROD/LOAD (стенды с aiStandFactor=1)
    for (const sid of ['PROD', 'LOAD']) {
        const row = page.getByTestId(`dashboard-stand-${sid}`)
            .locator('.dash-ai-metric-row').filter({ hasText: 'Токены' });
        await expect(row, `${sid}: Токены должны быть видны в стенд-карте`).toBeVisible();
        await expect(row.locator('.dash-ai-metric-row-qty-empty'),
            `${sid}: значение токенов не должно быть «—»`).toHaveCount(0);
    }

    // 3. Details «Сводка AI-метрик»: Токены > 0 ₽
    await clickSidebarTab(page, 'details');
    await expect(page.locator('.details-ai-summary')).toBeVisible();
    const tokensSummaryRow = page.locator('.details-ai-summary-table tbody tr')
        .filter({ hasText: 'Токены' });
    await expect(tokensSummaryRow).toBeVisible();
    const tokensTotal = tokensSummaryRow.locator('.details-ai-cell-total');
    await expect(tokensTotal).toContainText('₽');
    await expect(tokensTotal).toHaveText(/[1-9]/);
    await expect(tokensTotal).not.toHaveText(/^\s*—\s*$/);

    // 4. Details main table — после раскрытия AI / LLM строки токенов с данными
    const aiCategoryRow = page.locator('.details-table-cost tbody tr.category-row[data-category="AI"]');
    await expect(aiCategoryRow).toBeVisible();
    await aiCategoryRow.click();

    for (const itemId of ['llm-tokens-input-1m', 'llm-tokens-output-1m']) {
        const row = page.locator(`.details-table-cost tbody tr[data-item-id="${itemId}"]`);
        await expect(row, `Строка ${itemId} должна появиться после раскрытия AI / LLM`).toBeVisible();
        const total = row.locator('td.col-total').first();
        await expect(total, `${itemId}: ИТОГО / мес должен содержать ₽-значение`).toContainText('₽');
        await expect(total).toHaveText(/[1-9]/);
        await expect(total).not.toHaveText(/^\s*(?:—|0\s*₽)\s*$/);
    }

    expect(consoleErrors).toEqual([]);
});
