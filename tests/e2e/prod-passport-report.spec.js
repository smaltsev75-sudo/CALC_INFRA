import { expect, test } from '@playwright/test';
import {
    bootCleanApp,
    clickSidebarTab,
    createCalculationFromQuickStart
} from './helpers.js';

test.describe.configure({ mode: 'parallel' });

async function buildExpectedPassport(page, offset = 0, search = '') {
    return page.evaluate(async ({ pageOffset, searchText }) => {
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
            topFactorsLimit: 6,
            search: searchText
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
                    name: row.name,
                    quantity: row.quantity,
                    monthlyCost: row.monthlyCost,
                    budgetSharePercent: row.budgetSharePercent
                }))
            }
        };
    }, { pageOffset: offset, searchText: search });
}

async function readPassportRows(page) {
    return page.locator('.prod-passport-row').evaluateAll(rows => rows.map(row => ({
        itemId: row.dataset.itemId,
        quantity: Number(row.dataset.quantity),
        monthlyCost: Number(row.dataset.monthlyCost),
        budgetSharePercent: Number(row.dataset.budgetShare)
    })));
}

async function waitForPassportFirstRow(page, expectedItemId) {
    await page.waitForFunction(
        itemId => document.querySelector('.prod-passport-row')?.dataset.itemId === itemId,
        expectedItemId
    );
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

async function expectPassportListColumnsAligned(page) {
    const alignments = await page.evaluate(() => {
        const head = [...document.querySelector('[data-testid="prod-passport-list-head"]').children];
        const rows = [...document.querySelectorAll('.prod-passport-row')].map(row => [...row.children]);
        return rows.map(row => head.map((cell, index) => {
            const headBox = cell.getBoundingClientRect();
            const rowBox = row[index].getBoundingClientRect();
            return {
                leftDelta: Math.abs(headBox.left - rowBox.left),
                rightDelta: Math.abs(headBox.right - rowBox.right),
                textAlign: getComputedStyle(cell).textAlign
            };
        }));
    });
    expect(alignments.length).toBeGreaterThan(0);
    for (const rowAlignment of alignments) {
        for (const column of rowAlignment) {
            expect(column.leftDelta).toBeLessThan(1);
            expect(column.rightDelta).toBeLessThan(1);
        }
        expect(rowAlignment.slice(1).every(column => column.textAlign === 'right')).toBe(true);
    }
}

async function expectNoHorizontalOverflow(page, selector) {
    const overflow = await page.locator(selector).evaluate(node => ({
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
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
    await expect(page.getByTestId('prod-passport-summary-items')).toBeVisible();
    await expect(page.getByTestId('prod-passport-summary-month')).toBeVisible();
    await expect(page.getByTestId('prod-passport-summary-year')).toBeVisible();
    await expect(page.getByTestId('prod-passport-summary-defaults')).toHaveCount(0);
    await expect(page.getByTestId('prod-passport-summary-repaired')).toHaveCount(0);
    await expect(page.getByTestId('prod-passport-summary-warnings')).toHaveCount(0);

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
    await expectPassportListColumnsAligned(page);
    const rowEmphasis = await page.locator('.prod-passport-row').first().evaluate(row => {
        const name = row.querySelector('.prod-passport-row-name strong');
        const money = row.querySelector('.prod-passport-row-money');
        const share = row.querySelector('.prod-passport-row-share');
        return {
            nameWeight: Number.parseInt(getComputedStyle(name).fontWeight, 10),
            moneyWeight: Number.parseInt(getComputedStyle(money).fontWeight, 10),
            shareWeight: Number.parseInt(getComputedStyle(share).fontWeight, 10)
        };
    });
    expect(rowEmphasis.nameWeight).toBeGreaterThan(rowEmphasis.moneyWeight);
    expect(rowEmphasis.nameWeight).toBeGreaterThan(rowEmphasis.shareWeight);

    const detail = page.getByTestId('prod-passport-detail');
    await expect(detail).toBeVisible();
    await expect(detail).toContainText('Как получено количество');
    await expect(page.locator('.prod-passport-detail-result')).toHaveCount(0);
    await expect(page.locator('.prod-passport-cost-component-total')).toHaveCount(0);
    await expect(page.locator('.prod-passport-cost-component').filter({ hasText: /^Итог/ })).toHaveCount(0);
    const quantityDetails = page.getByTestId('prod-passport-quantity-details');
    await expect(quantityDetails).toHaveJSProperty('tagName', 'SECTION');
    await expect(page.getByTestId('prod-passport-quantity-calculation')).toBeVisible();
    await expect(page.locator('.prod-passport-quantity-values')).toBeVisible();
    await expect(page.locator('.prod-passport-quantity-value').first()).toBeVisible();
    await expect(quantityDetails).toContainText('Подставленные значения');
    await expect(detail).not.toContainText('Подстановка');
    await expect(detail).not.toContainText('Техническая формула');
    await expect(detail).not.toContainText('В формуле нет ссылок');
    await expect(detail).toContainText('Формула стоимости');
    await expect(detail).toContainText('Стоимость = количество × цена × тариф × риски × НДС');
    await expect(page.getByText('зацикливания нет')).toHaveCount(0);

    await expect(page.getByTestId('prod-passport-export-csv')).toBeVisible();
    const factorsBlock = page.getByTestId('prod-passport-top-factors');
    await expect(factorsBlock).toBeVisible();
    await expect(factorsBlock).toContainText('Проценты показывают долю от общего бюджета ПРОМ');
    await expect(factorsBlock).toContainText('не суммируются к 100%');
    await expect(page.locator('.prod-passport-factor-table')).toHaveCount(0);
    await expect(page.locator('.prod-passport-factor-head')).toHaveCount(0);
    await expect(page.locator('.prod-passport-factor-row')).toHaveCount(0);
    await expect(page.locator('.prod-passport-factor-card')).toHaveCount(0);
    await expect(factorsBlock).not.toContainText('Связанные ЭК');
    await expect(factorsBlock).not.toContainText('Охват бюджета');
    await expect(factorsBlock).toContainText(/\d+\s*%/);
    await expect(page.locator('.prod-passport-factor-panel')).toBeVisible();
    await expect(page.locator('.prod-passport-factor-gradient')).toHaveCount(1);
    const factorItems = page.locator('.prod-passport-factor-item');
    await expect(factorItems.first()).toBeVisible();
    await expect(factorItems.first()).toContainText('тыс.руб./мес.');
    await expect(factorItems.first().locator('.prod-passport-factor-swatch')).toBeVisible();
    await expect(factorItems.first().locator('.prod-passport-factor-percent')).toContainText('%');
    await expect(page.locator('.prod-passport-factor-segment')).toHaveCount(await factorItems.count());
    expect(await factorItems.count()).toBeLessThanOrEqual(6);
    await expectNoHorizontalOverflow(page, '.prod-passport-factor-panel');
    await expectNoHorizontalOverflow(page, '.prod-passport-pager');

    const searchInput = page.getByTestId('prod-passport-search');
    await expect(searchInput).toBeVisible();
    const searchText = 'waf';
    await searchInput.click();
    await page.keyboard.type('w', { delay: 25 });
    await page.waitForTimeout(180);
    await expect(page.getByTestId('prod-passport-search')).toBeFocused();
    await page.keyboard.type('af', { delay: 25 });
    await expect(page.getByTestId('prod-passport-search')).toHaveValue(searchText);
    const expectedSearchPage = await buildExpectedPassport(page, 0, searchText);
    await waitForPassportFirstRow(page, expectedSearchPage.page.items[0].itemId);
    const filteredRows = await readPassportRows(page);
    expect(filteredRows.length).toBeLessThan(firstPageRows.length);
    expectRowsMatchModel(filteredRows, expectedSearchPage.page.items);
    await searchInput.clear();
    await waitForPassportFirstRow(page, expectedFirstPage.page.items[0].itemId);

    if (expectedFirstPage.page.hasNext) {
        await page.getByTestId('prod-passport-page-button').nth(1).click();
        const expectedSecondPage = await buildExpectedPassport(page, 10);
        await waitForPassportFirstRow(page, expectedSecondPage.page.items[0].itemId);
        const secondPageRows = await readPassportRows(page);
        expectRowsMatchModel(secondPageRows, expectedSecondPage.page.items);
        await expectPassportListColumnsAligned(page);

        if (expectedFirstPage.page.total > 20) {
            await page.getByTestId('prod-passport-page-button').filter({ hasText: '3' }).click();
            const expectedThirdPage = await buildExpectedPassport(page, 20);
            await waitForPassportFirstRow(page, expectedThirdPage.page.items[0].itemId);
            const thirdPageRows = await readPassportRows(page);
            expectRowsMatchModel(thirdPageRows, expectedThirdPage.page.items);
            await expectPassportListColumnsAligned(page);
            await expect(detail).not.toContainText('Что повлияло');
            await expect(page.locator('.prod-passport-input-card')).toHaveCount(0);
            await expect(page.locator('.prod-passport-input-table')).toHaveCount(0);
        }

        await page.getByTestId('prod-passport-page-button').filter({ hasText: '1' }).click();
        await waitForPassportFirstRow(page, expectedFirstPage.page.items[0].itemId);
        const returnedRows = await readPassportRows(page);
        expectRowsMatchModel(returnedRows, expectedFirstPage.page.items);
        await expectPassportListColumnsAligned(page);
    }

    await expect(page.getByTestId('prod-passport-page-input')).toHaveCount(0);
    await expect(page.getByTestId('prod-passport-page-go')).toHaveCount(0);
    await expect(page.locator('.prod-passport-input-table')).toHaveCount(0);
    await expect(page.locator('.prod-passport-input-card')).toHaveCount(0);

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
