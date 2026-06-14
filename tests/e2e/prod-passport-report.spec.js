import { expect, test } from '@playwright/test';
import {
    bootCleanApp,
    clickSidebarTab,
    createCalculationFromQuickStart
} from './helpers.js';

test.describe.configure({ mode: 'parallel' });

async function buildExpectedPassport(page, search = '') {
    return page.evaluate(async ({ searchText }) => {
        const { store } = await import(new URL('js/state/store.js', document.baseURI).href);
        const { calculate } = await import(new URL('js/domain/calculator.js', document.baseURI).href);
        const { buildProdPassport } = await import(new URL('js/domain/prodPassport.js', document.baseURI).href);
        const state = store.getState();
        const calc = state.activeCalc;
        const result = calculate(calc, state.calcRevision);
        const model = buildProdPassport(calc, {
            result,
            stand: 'PROD',
            limit: Number.MAX_SAFE_INTEGER,
            topFactorsLimit: 6,
            search: searchText
        });
        return {
            summary: {
                totalMonthly: model.summary.totalMonthly,
                totalAnnual: model.summary.totalAnnual,
                itemsCount: model.summary.itemsCount
            },
            items: model.items.map(row => ({
                itemId: row.itemId,
                monthlyCost: row.monthlyCost,
                budgetSharePercent: row.budgetSharePercent
            }))
        };
    }, { searchText: search });
}

async function readTiles(page) {
    return page.locator('.pp-tile[data-id], .pp-tile[data-item-id]').evaluateAll(tiles => tiles
        .filter(tile => tile.dataset.itemId)
        .map(tile => ({
            itemId: tile.dataset.itemId,
            monthlyCost: Number(tile.dataset.monthlyCost),
            budgetSharePercent: Number(tile.dataset.budgetShare)
        })));
}

test('Паспорт ПРОМ открывается из Детализации картой бюджета и сходится с calculate()', async ({ page }) => {
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

    // нет чипов качества в шапке-сводке
    await expect(page.getByTestId('prod-passport-summary-defaults')).toHaveCount(0);
    await expect(page.getByTestId('prod-passport-summary-repaired')).toHaveCount(0);
    await expect(page.getByTestId('prod-passport-summary-warnings')).toHaveCount(0);

    // карта бюджета видна; старого списка/пагинации нет
    const treemap = page.getByTestId('prod-passport-treemap');
    await expect(treemap).toBeVisible();
    await expect(page.getByTestId('prod-passport-list-head')).toHaveCount(0);
    await expect(page.locator('.prod-passport-row')).toHaveCount(0);
    await expect(page.locator('.prod-passport-page-button')).toHaveCount(0);
    await expect(page.getByTestId('prod-passport-prev-page')).toHaveCount(0);
    await expect(page.getByTestId('prod-passport-next-page')).toHaveCount(0);

    // сходимость dataset плиток с buildProdPassport
    const expected = await buildExpectedPassport(page);
    const byId = new Map(expected.items.map(row => [row.itemId, row]));
    const tiles = await readTiles(page);
    expect(tiles.length).toBeGreaterThan(0);
    for (const tile of tiles) {
        const row = byId.get(tile.itemId);
        expect(row, `плитка ${tile.itemId} есть в модели`).toBeTruthy();
        expect(tile.monthlyCost).toBeCloseTo(row.monthlyCost, 2);
        expect(tile.budgetSharePercent).toBeCloseTo(row.budgetSharePercent, 2);
    }

    // категории + факторы под картой
    await expect(page.locator('.pp-legend-card')).toBeVisible();
    const factors = page.getByTestId('prod-passport-top-factors');
    await expect(factors).toBeVisible();
    await expect(factors).toContainText('Факторы влияния');
    await expect(factors.locator('.pp-fct3-bar')).toHaveCount(1);
    const factorItems = factors.locator('.pp-fct3-item');
    expect(await factorItems.count()).toBeGreaterThan(0);
    expect(await factorItems.count()).toBeLessThanOrEqual(6);
    await expect(factors.locator('.pp-fct3-seg')).toHaveCount(await factorItems.count());

    // детализация выбранного ЭК; клик по другой плитке меняет деталь
    const detail = page.getByTestId('prod-passport-detail');
    await expect(detail).toBeVisible();
    await expect(detail).toContainText('Как получено количество');
    await expect(detail).toContainText('Подстановка реальных значений');
    await expect(detail).toContainText('Входные параметры расчёта');
    await expect(detail).toContainText('Как получена стоимость');
    // в детализацию не должны протекать технические имена настроек
    await expect(detail).not.toContainText('Параметр расчёта ');

    const firstSelected = await detail.evaluate(node => node.dataset.itemId);
    const otherTile = page.locator(`.pp-tile[data-item-id]:not([data-item-id="${firstSelected}"])`).first();
    const otherId = await otherTile.getAttribute('data-item-id');
    await otherTile.click();
    await page.waitForFunction(
        id => document.querySelector('[data-testid="prod-passport-detail"]')?.dataset.itemId === id,
        otherId
    );
    await expect(detail).toHaveAttribute('data-item-id', otherId);

    // Ctrl+Alt+F внутри модалки фокусирует поиск Паспорта ПРОМ, а не скрытый поиск вкладки под overlay.
    const search = page.getByTestId('prod-passport-search');
    await expect(search).toBeVisible();
    await detail.click();
    await page.keyboard.press('Control+Alt+F');
    await expect(search).toBeFocused();

    // поиск оставляет на карте только совпавшие плитки и не теряет фокус при перерендере
    await page.keyboard.type('w', { delay: 25 });
    await page.waitForTimeout(180);
    await expect(page.getByTestId('prod-passport-search')).toBeFocused();
    await page.keyboard.type('af', { delay: 25 });
    await expect(page.getByTestId('prod-passport-search')).toHaveValue('waf');
    await page.waitForTimeout(180);
    const expectedSearch = await buildExpectedPassport(page, 'waf');
    if (expectedSearch.items.length > 0) {
        const searchTiles = await readTiles(page);
        const searchIds = new Set(searchTiles.map(tile => tile.itemId));
        for (const row of expectedSearch.items) {
            expect(searchIds.has(row.itemId)).toBe(true);
        }
    }

    // CSV-кнопка в шапке модалки
    await expect(page.getByTestId('prod-passport-export-csv')).toBeVisible();

    expect(consoleErrors).toEqual([]);
});

test('Паспорт ПРОМ в светлой теме не просвечивает тёмный backdrop', async ({ page }) => {
    const consoleErrors = await bootCleanApp(page);

    await createCalculationFromQuickStart(page, {
        name: 'Паспорт ПРОМ light theme',
        presetId: 'high_ai'
    });

    await page.evaluate(async () => {
        const { store } = await import(new URL('js/state/store.js', document.baseURI).href);
        store.setUi({ theme: 'light' });
        document.documentElement.setAttribute('data-theme', 'light');
    });

    await clickSidebarTab(page, 'details');
    await page.getByTestId('details-prod-passport-open').click();
    await expect(page.getByTestId('prod-passport-report')).toBeVisible();

    const surfaces = await page.evaluate(() => {
        const selectors = ['.pp-modal', '.pp-left', '.pp-right'];
        return selectors.map(selector => {
            const node = document.querySelector(selector);
            const style = getComputedStyle(node);
            return {
                selector,
                backgroundColor: style.backgroundColor,
                backgroundImage: style.backgroundImage
            };
        });
    });

    for (const surface of surfaces) {
        expect(surface.backgroundColor, `${surface.selector} backgroundColor`).not.toBe('rgba(0, 0, 0, 0)');
        expect(surface.backgroundColor, `${surface.selector} backgroundColor`).not.toBe('transparent');
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
    await expect(page.locator('.pp-tile')).toHaveCount(0);

    expect(consoleErrors).toEqual([]);
});

test('Паспорт ПРОМ закрывается по ✕ и по клику на фон', async ({ page }) => {
    const consoleErrors = await bootCleanApp(page);

    await createCalculationFromQuickStart(page, {
        name: 'Паспорт ПРОМ закрытие',
        presetId: 'high_ai'
    });

    await clickSidebarTab(page, 'details');

    // закрытие по ✕
    await page.getByTestId('details-prod-passport-open').click();
    await expect(page.getByTestId('prod-passport-report')).toBeVisible();
    await page.locator('.pp-head-btn-close').click();
    await expect(page.getByTestId('prod-passport-report')).toHaveCount(0);

    // закрытие по клику на фон (overlay)
    await page.getByTestId('details-prod-passport-open').click();
    await expect(page.getByTestId('prod-passport-report')).toBeVisible();
    await page.locator('.pp-overlay').click({ position: { x: 5, y: 5 } });
    await expect(page.getByTestId('prod-passport-report')).toHaveCount(0);

    expect(consoleErrors).toEqual([]);
});
