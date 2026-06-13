import { expect, test } from '@playwright/test';
import {
    bootCleanApp,
    clickSidebarTab,
    createCalculationFromQuickStart
} from './helpers.js';

test.describe.configure({ mode: 'parallel' });

async function buildExpectedPassport(page, offset = 0) {
    return page.evaluate(async (pageOffset) => {
        const { store } = await import(new URL('js/state/store.js', document.baseURI).href);
        const { calculate } = await import(new URL('js/domain/calculator.js', document.baseURI).href);
        const { buildProdPassport } = await import(new URL('js/domain/prodPassport.js', document.baseURI).href);
        const state = store.getState();
        const calc = state.activeCalc;
        const result = calculate(calc, state.calcRevision);
        const model = buildProdPassport(calc, {
            result,
            stand: 'PROD',
            offset: pageOffset,
            limit: 10,
            topFactorsLimit: 6
        });
        return {
            summary: {
                totalMonthly: model.summary.totalMonthly,
                totalAnnual: model.summary.totalAnnual,
                itemsCount: model.summary.itemsCount
            },
            page: {
                offset: model.page.offset,
                limit: model.page.limit,
                total: model.page.total,
                hasNext: model.page.hasNext,
                items: model.page.items.map(row => ({
                    itemId: row.itemId,
                    quantity: row.quantity,
                    monthlyCost: row.monthlyCost,
                    budgetSharePercent: row.budgetSharePercent
                }))
            }
        };
    }, offset);
}

async function readPassportRows(page) {
    return page.locator('.prod-passport-row').evaluateAll(rows => rows.map(row => ({
        itemId: row.dataset.itemId,
        quantity: Number(row.dataset.quantity),
        monthlyCost: Number(row.dataset.monthlyCost),
        budgetSharePercent: Number(row.dataset.budgetShare)
    })));
}

function expectRowsMatchModel(uiRows, modelRows) {
    expect(uiRows).toHaveLength(modelRows.length);
    for (let i = 0; i < modelRows.length; i += 1) {
        expect(uiRows[i].itemId).toBe(modelRows[i].itemId);
        expect(uiRows[i].quantity).toBeCloseTo(modelRows[i].quantity, 6);
        expect(uiRows[i].monthlyCost).toBeCloseTo(modelRows[i].monthlyCost, 2);
        expect(uiRows[i].budgetSharePercent).toBeCloseTo(modelRows[i].budgetSharePercent, 2);
    }
}

test('Паспорт ПРОМ открывается из Детализации и сходится с calculate()', async ({ page }) => {
    const consoleErrors = await bootCleanApp(page);

    await createCalculationFromQuickStart(page, {
        name: 'Паспорт ПРОМ e2e',
        presetId: 'high_ai'
    });

    await clickSidebarTab(page, 'details');
    await page.getByTestId('details-prod-passport-open').click();
    await expect(page.getByTestId('prod-passport-report')).toBeVisible();

    const headers = await page.getByTestId('prod-passport-list-head').locator('span').allTextContents();
    expect(headers).toEqual(['ЭК', 'Количество', 'Бюджет/мес.', '% бюджета']);
    await expect(page.getByTestId('prod-passport-list-head')).not.toContainText('Статус');
    await expect(page.getByTestId('prod-passport-list-head')).not.toContainText('Бюджет/год');

    const expectedFirstPage = await buildExpectedPassport(page, 0);
    const firstPageRows = await readPassportRows(page);
    expectRowsMatchModel(firstPageRows, expectedFirstPage.page.items);

    for (let i = 1; i < firstPageRows.length; i += 1) {
        expect(firstPageRows[i - 1].monthlyCost).toBeGreaterThanOrEqual(firstPageRows[i].monthlyCost);
    }

    const detail = page.getByTestId('prod-passport-detail');
    await expect(detail).toBeVisible();
    await expect(detail).toContainText('Как получено количество');
    await expect(detail).toContainText('Подстановка');
    await expect(detail).toContainText('Техническая формула');
    await expect(detail).toContainText('Что повлияло');
    await expect(detail).toContainText('Формула стоимости');
    await expect(detail).toContainText('Стоимость = количество × цена × тариф × риски × НДС');
    await expect(page.getByText('зацикливания нет')).toHaveCount(0);

    await expect(page.getByTestId('prod-passport-export-csv')).toBeVisible();
    const factorHeaders = await page.locator('.prod-passport-factor-head span').allTextContents();
    expect(factorHeaders).toEqual(['Фактор', 'Связанные ЭК, тыс.руб./мес.', 'Охват бюджета']);

    if (expectedFirstPage.page.hasNext) {
        await page.getByTestId('prod-passport-next-page').click();
        const expectedSecondPage = await buildExpectedPassport(page, 10);
        const secondPageRows = await readPassportRows(page);
        expectRowsMatchModel(secondPageRows, expectedSecondPage.page.items);
    }

    expect(consoleErrors).toEqual([]);
});

test('Паспорт ПРОМ не называет ошибку парсинга зацикливанием расчёта', async ({ page }) => {
    const consoleErrors = await bootCleanApp(page);

    await page.evaluate(async () => {
        const { store } = await import(new URL('js/state/store.js', document.baseURI).href);
        const { SEED_SETTINGS } = await import(new URL('js/domain/seed.js', document.baseURI).href);
        store.setActiveCalc({
            id: 'prod-passport-cycle-e2e',
            name: 'Паспорт ПРОМ: цикл',
            schemaVersion: 20,
            settings: { ...SEED_SETTINGS, applyRiskFactors: false },
            answers: {},
            answersMeta: {},
            dictionaries: {
                questions: [],
                settings: {},
                items: [{
                    id: 'ram-gb',
                    name: 'RAM',
                    unit: 'ГБ',
                    pricePerUnit: 1000,
                    billingInterval: 'monthly',
                    category: 'HW',
                    resourceClass: 'RAM',
                    applicableStands: ['PROD'],
                    qtyFormulas: { PROD: 'ram-gb + 1' },
                    formulaHelp: 'Количество RAM для проверки ошибки формулы.'
                }]
            },
            view: {}
        });
        store.setActiveTab('details');
    });

    await expect(page.getByTestId('details-prod-passport-open')).toBeVisible();
    await page.getByTestId('details-prod-passport-open').click();
    await expect(page.getByTestId('prod-passport-report')).toBeVisible();
    await expect(page.getByTestId('prod-passport-formula-error')).toContainText('Неизвестный идентификатор');
    await expect(page.getByTestId('prod-passport-formula-error')).not.toContainText('зацикливание расчёта');
    await expect(page.getByText('зацикливания нет')).toHaveCount(0);

    expect(consoleErrors).toEqual([]);
});

test('Паспорт ПРОМ показывает empty-state, если стенд ПРОМ скрыт в Детализации', async ({ page }) => {
    const consoleErrors = await bootCleanApp(page);

    await createCalculationFromQuickStart(page, {
        name: 'Паспорт ПРОМ hidden stand',
        presetId: 'high_ai'
    });

    await page.evaluate(async () => {
        const { store } = await import(new URL('js/state/store.js', document.baseURI).href);
        store.updateActiveCalc(calc => ({
            view: {
                ...(calc.view || {}),
                disabledStands: ['PROD']
            }
        }));
    });

    await clickSidebarTab(page, 'details');
    await page.getByTestId('details-prod-passport-open').click();
    await expect(page.getByTestId('prod-passport-report')).toBeVisible();
    await expect(page.getByTestId('prod-passport-stand-disabled')).toContainText('Стенд ПРОМ скрыт');
    await expect(page.locator('.prod-passport-row')).toHaveCount(0);

    expect(consoleErrors).toEqual([]);
});
