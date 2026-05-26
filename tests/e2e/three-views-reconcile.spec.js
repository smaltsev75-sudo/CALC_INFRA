/**
 * E2E reconciliation: реально читаем числа из DOM в трёх view (Расчёты,
 * Дашборд, Детализация) и проверяем, что они бьются.
 *
 * Unit-тест tests/integration/three-views-reconcile.test.js считает то же
 * самое, что и UI — но из ОДНОЙ функции calculate(). Если render использует
 * другой path (например, calc-card читает stale meta из persist, либо
 * Dashboard применяет дополнительный фильтр), unit-тест этого не заметит.
 * Этот E2E читает РЕНДЕРЕННЫЙ TEXT.
 *
 * Сценарий — JSON пользователя «Акселератор Start» (registered=500/dau=0.7,
 * heavy LLM, external_api). disabledStands=[], значит во всех трёх view
 * должно быть одинаковое значение «Итого/мес» и «Итого/год».
 */

import { expect, test } from '@playwright/test';
import { bootCleanApp, clickSidebarTab } from './helpers.js';

test.describe.configure({ mode: 'parallel' });

const USER_JSON = {
    id: 'reconcile-user-fixture',
    name: 'Reconcile fixture (Акселератор Start)',
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
        registered_users_total: 500,
        dau_share_of_registered_percent: 0.7,
        ai_users_share: 75,
        ai_requests_per_user_day: 30,
        ai_avg_input_tokens: 3000,
        ai_avg_output_tokens: 500,
        ai_caching_share: 30
    },
    view: { disabledStands: [] }
};

/** Извлечь число из строки «2 549 тыс. ₽ / мес» или «30 592 029 ₽».
 *  Работает с «нормальными пробелами», «неразрывными пробелами» (U+00A0),
 *  «тонкими» пробелами (U+202F, U+2009) и запятыми как разделителями дробей. */
function parseRubText(text) {
    if (!text) return null;
    const cleaned = String(text)
        .replace(/[   \s]/g, '')
        .replace(/тыс\.|₽|\/мес|\/год|\/день|вгод|вмес|вдень/gi, '');
    const m = cleaned.match(/-?\d+(?:[.,]\d+)?/);
    if (!m) return null;
    return Number(m[0].replace(',', '.'));
}

/** Парсит «X тыс. ₽» — возвращает число тысяч (не умножая). */
function parseThousandsRub(text) {
    return parseRubText(text);
}

async function importUserJson(page) {
    await page.evaluate(async (data) => {
        const calcList = await import(new URL('js/controllers/calcListController.js', document.baseURI).href);
        await calcList.importCalcFromFile({
            _pickFile: async () => ({ name: 'reconcile-fixture.json' }),
            _readJsonFile: async () => ({ data })
        });
    }, USER_JSON);
}

test('Calc-card ↔ Dashboard ↔ Details: рендеренные «итого» совпадают для disabledStands=[]', async ({ page }) => {
    const consoleErrors = await bootCleanApp(page);
    await importUserJson(page);

    // ----- 1) РАСЧЁТЫ (carc-card) -----
    await clickSidebarTab(page, 'calculations');
    const cardHeroText = await page.locator('.calc-card-metric-hero').first().innerText();
    const cardSubText = await page.locator('.calc-card-metric-sub').first().innerText();
    const cardAnnualThousands = parseThousandsRub(cardHeroText);
    const cardMonthlyThousands = parseThousandsRub(cardSubText);
    expect(cardAnnualThousands, `Calc-card annual: «${cardHeroText}»`).toBeGreaterThan(0);
    expect(cardMonthlyThousands, `Calc-card monthly: «${cardSubText}»`).toBeGreaterThan(0);

    // ----- 2) ДАШБОРД (Hero «Итого по расчёту») -----
    await clickSidebarTab(page, 'dashboard');
    await expect(page.getByTestId('dashboard-hero')).toBeVisible();

    // Главное число + два альтернативных периода (день/мес/год — три значения).
    const heroAmount = await page.locator('.dash-card-hero .dash-hero-value-amount').first().innerText();
    const altValues = await page.locator('.dash-card-hero .dash-hero-alt-value').allInnerTexts();
    expect(altValues.length).toBe(2);

    // Один из трёх — «мес», один — «год», один — «день». Парсим все три.
    const heroNumbers = [heroAmount, ...altValues].map(parseThousandsRub).filter(v => v !== null);
    // Год обычно — самое большое из трёх (мес × 12). Мес — второе. День — мес/30.
    heroNumbers.sort((a, b) => b - a);
    const [dashAnnualThousands, dashMonthlyThousands] = heroNumbers;

    // Сверка месяц-в-месяц
    expect(dashMonthlyThousands, 'Dashboard месяц должен совпадать с Calc-card')
        .toBe(cardMonthlyThousands);
    // Сверка год-в-год
    expect(dashAnnualThousands, 'Dashboard год должен совпадать с Calc-card')
        .toBe(cardAnnualThousands);

    // ----- 3) ДЕТАЛИЗАЦИЯ (грэнд-row в thead-with-totals) -----
    await clickSidebarTab(page, 'details');
    await expect(page.locator('.details-table-cost')).toBeVisible();

    const grandRow = page.locator('.details-table-cost .totals-row-grand').first();
    await expect(grandRow).toBeVisible();
    const grandCells = await grandRow.locator('td.col-total').allInnerTexts();
    expect(grandCells.length).toBeGreaterThanOrEqual(2);
    // первая col-total — мес, вторая — год
    const detailsMonthlyRub = parseRubText(grandCells[0]);
    const detailsAnnualRub = parseRubText(grandCells[1]);

    // Details выводит в рублях полностью (без округления до тысяч).
    // Calc-card / Dashboard округляют до тысяч. Проверяем что:
    //   round(details_rub / 1000) == cardThousands  (±1 тыс. из-за независимого округления)
    const detailsMonthlyThousands = Math.round(detailsMonthlyRub / 1000);
    const detailsAnnualThousands = Math.round(detailsAnnualRub / 1000);

    expect(Math.abs(detailsMonthlyThousands - cardMonthlyThousands),
        `Details мес (${detailsMonthlyThousands} тыс.) vs Calc-card мес (${cardMonthlyThousands} тыс.)`)
        .toBeLessThanOrEqual(1);
    expect(Math.abs(detailsAnnualThousands - cardAnnualThousands),
        `Details год (${detailsAnnualThousands} тыс.) vs Calc-card год (${cardAnnualThousands} тыс.)`)
        .toBeLessThanOrEqual(1);
    expect(Math.abs(detailsMonthlyThousands - dashMonthlyThousands),
        `Details мес (${detailsMonthlyThousands} тыс.) vs Dashboard мес (${dashMonthlyThousands} тыс.)`)
        .toBeLessThanOrEqual(1);

    expect(consoleErrors).toEqual([]);
});

test('Per-stand «Итого» в Dashboard ↔ соответствующая колонка в Details', async ({ page }) => {
    const consoleErrors = await bootCleanApp(page);
    await importUserJson(page);

    // Dashboard: per-stand карточки с totalMonthly
    await clickSidebarTab(page, 'dashboard');
    const dashboardStandMonthly = {};
    for (const sid of ['DEV','IFT','PSI','PROD','LOAD']) {
        const standCard = page.getByTestId(`dashboard-stand-${sid}`);
        await expect(standCard).toBeVisible();
        const text = await standCard.locator('.dash-hero-value-amount, .dash-stand-card-value, .dash-stand-card-total').first().innerText().catch(() => null);
        const value = parseThousandsRub(text);
        if (value !== null && value > 0) {
            dashboardStandMonthly[sid] = value;
        }
    }

    // Details: grand-row содержит per-stand col-stand ячейки
    await clickSidebarTab(page, 'details');
    const grandRow = page.locator('.details-table-cost .totals-row-grand').first();
    await expect(grandRow).toBeVisible();
    const standCells = await grandRow.locator('td.col-stand').allInnerTexts();
    expect(standCells.length).toBe(5); // DEV, IFT, PSI, PROD, LOAD

    const standIds = ['DEV','IFT','PSI','PROD','LOAD'];
    const detailsStandMonthly = {};
    for (let i = 0; i < standIds.length; i++) {
        const rub = parseRubText(standCells[i]);
        if (rub !== null && rub > 0) {
            detailsStandMonthly[standIds[i]] = Math.round(rub / 1000);
        }
    }

    // Сверяем те стенды, что Dashboard вообще отобразил с числом > 0
    for (const sid of Object.keys(dashboardStandMonthly)) {
        if (detailsStandMonthly[sid] == null) continue;
        expect(Math.abs(dashboardStandMonthly[sid] - detailsStandMonthly[sid]),
            `Stand ${sid}: Dashboard ${dashboardStandMonthly[sid]} тыс. vs Details ${detailsStandMonthly[sid]} тыс.`)
            .toBeLessThanOrEqual(1);
    }

    expect(consoleErrors).toEqual([]);
});
