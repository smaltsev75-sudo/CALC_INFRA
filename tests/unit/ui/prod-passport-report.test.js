import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { calculate } from '../../../js/domain/calculator.js';
import { buildProdPassport } from '../../../js/domain/prodPassport.js';
import { buildSeedDictionaries, defaultAnswersFrom, SEED_SETTINGS } from '../../../js/domain/seed.js';

let activeDom = null;
let previousGlobals = new Map();

function setGlobal(name, value) {
    if (!previousGlobals.has(name)) {
        previousGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    }
    Object.defineProperty(globalThis, name, {
        configurable: true,
        writable: true,
        value
    });
}

function installJSDom() {
    activeDom = new JSDOM('<!doctype html><html><body></body></html>', {
        url: 'http://localhost/'
    });
    setGlobal('window', activeDom.window);
    setGlobal('document', activeDom.window.document);
    setGlobal('HTMLElement', activeDom.window.HTMLElement);
    setGlobal('Node', activeDom.window.Node);
    setGlobal('Blob', activeDom.window.Blob);
    setGlobal('requestAnimationFrame', cb => setTimeout(() => cb(Date.now()), 0));
}

function restoreJSDom() {
    const entries = [...previousGlobals.entries()].reverse();
    for (const [name, descriptor] of entries) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
    }
    previousGlobals = new Map();
    activeDom?.window.close();
    activeDom = null;
}

function collectText(node) {
    if (!node) return '';
    return String(node.textContent || '').replace(/\s+/g, ' ').trim();
}

function byTestId(root, testId) {
    return root.querySelector(`[data-testid="${testId}"]`);
}

function allByClass(root, className) {
    return [...root.querySelectorAll(`.${className}`)];
}

function makeCalc() {
    const dictionaries = buildSeedDictionaries();
    return {
        id: 'prod-passport-ui-test',
        name: 'Prod passport UI test',
        schemaVersion: 20,
        settings: { ...SEED_SETTINGS, applyRiskFactors: false, vatEnabled: true, vatRate: 0.22 },
        answers: {
            ...defaultAnswersFrom(dictionaries.questions || []),
            registered_users_total: 500,
            dau_share_of_registered_percent: 0.7,
            ai_users_share: 30,
            ai_requests_per_user_day: 30,
            ai_avg_input_tokens: 3000,
            ai_avg_output_tokens: 500,
            ai_llm_used: true,
            rag_needed: true,
            rag_managed_used: false,
            rag_embeddings_million: 1,
            peak_rps: 50,
            microservices_count: 5,
            async_workers_count: 3,
            ram_per_vcpu_ratio: 4,
            cache_size_gb: 8
        },
        answersMeta: {
            peak_rps: { source: 'manual' },
            microservices_count: { source: 'manual' }
        },
        dictionaries,
        view: {}
    };
}

describe('Паспорт ПРОМ: DOM-контракт отчёта (treemap-раскладка драфта)', () => {
    beforeEach(() => installJSDom());
    afterEach(() => restoreJSDom());

    it('рендерит шапку-сводку (элементы/бюджет/год) и поиск без чипов качества', async () => {
        const { renderProdPassportReport } = await import('../../../js/ui/prodPassportReport.js');
        const calc = makeCalc();
        const rendered = renderProdPassportReport(calc, calculate(calc), {}, { patchModal() {} });

        const items = byTestId(rendered, 'prod-passport-summary-items');
        const month = byTestId(rendered, 'prod-passport-summary-month');
        const year = byTestId(rendered, 'prod-passport-summary-year');
        assert.ok(items && month && year);

        const model = buildProdPassport(calc, {
            result: calculate(calc), stand: 'PROD', limit: Number.MAX_SAFE_INTEGER, topFactorsLimit: 6
        });
        assert.match(collectText(items), new RegExp(String(model.summary.itemsCount)));
        assert.match(collectText(month), /тыс\.руб\.\/мес\./);
        assert.match(collectText(year), /тыс\.руб\.\/год/);

        // в шапке-сводке НЕТ чипов качества (по умолчанию/автоисправлено/предупреждения)
        assert.equal(byTestId(rendered, 'prod-passport-summary-defaults'), null);
        assert.equal(byTestId(rendered, 'prod-passport-summary-repaired'), null);
        assert.equal(byTestId(rendered, 'prod-passport-summary-warnings'), null);
        assert.doesNotMatch(collectText(byTestId(rendered, 'prod-passport-summary')), /Проверка данных|По умолчанию/);

        assert.ok(byTestId(rendered, 'prod-passport-search'));
    });

    it('рендерит карту бюджета: плитки с itemId/monthlyCost + плитку «Прочее», без списка/пагинации', async () => {
        const { renderProdPassportReport } = await import('../../../js/ui/prodPassportReport.js');
        const calc = makeCalc();
        const rendered = renderProdPassportReport(calc, calculate(calc), {}, { patchModal() {} });

        const treemap = byTestId(rendered, 'prod-passport-treemap');
        assert.ok(treemap, 'карта бюджета должна присутствовать');

        const tiles = allByClass(treemap, 'pp-tile').filter(t => t.dataset.itemId);
        assert.ok(tiles.length > 0, 'на карте должны быть плитки ЭК');
        for (const tile of tiles) {
            assert.ok(tile.dataset.itemId);
            assert.ok(Number.isFinite(Number(tile.dataset.monthlyCost)));
            assert.ok(Number.isFinite(Number(tile.dataset.budgetShare)));
            // плитка несёт категорийный CSS-класс цвета
            assert.ok([...tile.classList].some(c => c.startsWith('pp-c-')));
        }

        // более 9 ЭК → есть свёрнутая плитка «Прочее (N ЭК)»
        assert.ok(byTestId(rendered, 'prod-passport-tile-other'), 'мелкие ЭК свёрнуты в «Прочее»');
        assert.match(collectText(byTestId(rendered, 'prod-passport-tile-other')), /Прочее/);

        // старой структуры списка/пагинации нет
        assert.equal(byTestId(rendered, 'prod-passport-item-list'), null);
        assert.equal(byTestId(rendered, 'prod-passport-list-head'), null);
        assert.equal(allByClass(rendered, 'prod-passport-row').length, 0);
        assert.equal(allByClass(rendered, 'prod-passport-page-button').length, 0);
        assert.equal(byTestId(rendered, 'prod-passport-prev-page'), null);
        assert.equal(byTestId(rendered, 'prod-passport-next-page'), null);
    });

    it('сходимость: dataset плитки строго совпадает с buildProdPassport', async () => {
        const { renderProdPassportReport } = await import('../../../js/ui/prodPassportReport.js');
        const calc = makeCalc();
        const result = calculate(calc);
        const rendered = renderProdPassportReport(calc, result, {}, { patchModal() {} });
        const model = buildProdPassport(calc, {
            result, stand: 'PROD', limit: Number.MAX_SAFE_INTEGER, topFactorsLimit: 6
        });
        const byId = new Map(model.items.map(row => [row.itemId, row]));

        const tiles = allByClass(rendered, 'pp-tile').filter(t => t.dataset.itemId);
        for (const tile of tiles) {
            const row = byId.get(tile.dataset.itemId);
            assert.ok(row, `плитка ${tile.dataset.itemId} должна быть в модели`);
            assert.equal(Number(tile.dataset.monthlyCost), row.monthlyCost);
            assert.equal(Number(tile.dataset.budgetShare), row.budgetSharePercent);
        }
    });

    it('клик по плитке патчит selectedItemId выбранного ЭК', async () => {
        const { renderProdPassportReport } = await import('../../../js/ui/prodPassportReport.js');
        const calc = makeCalc();
        const patchCalls = [];
        const rendered = renderProdPassportReport(calc, calculate(calc), {}, {
            patchModal: (...args) => patchCalls.push(args)
        });

        const tiles = allByClass(rendered, 'pp-tile').filter(t => t.dataset.itemId);
        const target = tiles[1] || tiles[0];
        target.click();
        assert.equal(patchCalls.length, 1);
        assert.equal(patchCalls[0][0], 'prodPassport');
        assert.equal(patchCalls[0][1].selectedItemId, target.dataset.itemId);
    });

    it('рендерит легенду категорий и факторы Вариантом 3 (полоса + легенда сумм)', async () => {
        const { renderProdPassportReport } = await import('../../../js/ui/prodPassportReport.js');
        const calc = makeCalc();
        const rendered = renderProdPassportReport(calc, calculate(calc), {}, { patchModal() {} });

        const legend = allByClass(rendered, 'pp-legend-card');
        assert.equal(legend.length, 1);
        assert.match(collectText(legend[0]), /Категории/);
        assert.ok(allByClass(legend[0], 'pp-lg').length > 0);

        const factors = byTestId(rendered, 'prod-passport-top-factors');
        assert.ok(factors);
        assert.match(collectText(factors), /Факторы влияния/);
        assert.equal(allByClass(factors, 'pp-fct3-bar').length, 1);
        const segments = allByClass(factors, 'pp-fct3-seg');
        const legendItems = allByClass(factors, 'pp-fct3-item');
        assert.ok(legendItems.length > 0);
        assert.ok(legendItems.length <= 6);
        assert.equal(segments.length, legendItems.length);
        // единица измерения один раз
        assert.equal(allByClass(factors, 'pp-factors-unit').length, 1);
        assert.match(collectText(factors), /тыс\.руб\.\/мес\./);
        // дисклеймер про пересечение охватов одной строкой / ⓘ
        assert.ok(allByClass(factors, 'pp-factors-info').length === 1);
    });

    it('детализация: иконка категории, KPI с ед.изм. под значением, подстановка, параметры с ⓘ, стоимость', async () => {
        const { renderProdPassportReport } = await import('../../../js/ui/prodPassportReport.js');
        const calc = makeCalc();
        const rendered = renderProdPassportReport(calc, calculate(calc), { selectedItemId: 'ram-gb' }, {
            patchModal() {}
        });

        const detail = byTestId(rendered, 'prod-passport-detail');
        assert.ok(detail);
        assert.equal(detail.dataset.itemId, 'ram-gb');

        // иконка категории
        assert.equal(allByClass(detail, 'pp-detail-icon').length, 1);

        // KPI: 4 карточки, у бюджета ед.изм. отдельным узлом ПОД значением
        const kpis = allByClass(detail, 'pp-dk');
        assert.equal(kpis.length, 4);
        const budgetKpi = allByClass(detail, 'pp-dk-hl')[0];
        assert.ok(budgetKpi);
        assert.equal(allByClass(budgetKpi, 'pp-dk-u').length, 1);
        assert.match(collectText(allByClass(budgetKpi, 'pp-dk-u')[0]), /тыс\.руб\.\/мес\./);

        // подстановка реальных значений (шаг 2), без жаргона Q./S.
        const calculation = byTestId(detail, 'prod-passport-quantity-calculation');
        assert.ok(calculation);
        assert.match(collectText(detail), /Как получено количество/);
        assert.match(collectText(detail), /Подстановка реальных значений/);
        assert.doesNotMatch(collectText(calculation), /Q\.|S\./);

        // входные параметры: таблица с заголовками и ⓘ источника
        const params = byTestId(detail, 'prod-passport-detail-params');
        assert.ok(params);
        const head = allByClass(params, 'pp-params-head')[0];
        assert.deepEqual(
            [...head.querySelectorAll('.pp-p-head')].map(collectText),
            ['Параметр', 'Значение', 'Источник']
        );
        const srcCells = allByClass(params, 'pp-src');
        assert.ok(srcCells.length > 0);
        assert.ok(srcCells.every(cell => allByClass(cell, 'pp-src-info').length === 1), 'у каждого источника ⓘ-хинт');
        // классы заголовков НЕ конфликтуют с колонками (.left/.right запрещены)
        assert.equal(allByClass(params, 'left').length, 0);
        assert.equal(allByClass(params, 'right').length, 0);

        // стоимость: чипы множителей + итог один раз, без $
        const cost = allByClass(detail, 'pp-cost')[0];
        assert.ok(cost);
        assert.match(collectText(detail), /Как получена стоимость/);
        assert.ok(allByClass(cost, 'pp-mchip').length > 0);
        assert.equal(allByClass(cost, 'pp-cost-total').length, 1);
        assert.doesNotMatch(collectText(cost), /\$/);
    });

    it('поиск: ввод дебаунсится и патчит модалку (search + сброс выбора), без offset', async () => {
        const { renderProdPassportReport } = await import('../../../js/ui/prodPassportReport.js');
        const calc = makeCalc();
        const patchCalls = [];
        const rendered = renderProdPassportReport(calc, calculate(calc), { search: 'ram' }, {
            patchModal: (...args) => patchCalls.push(args)
        });

        const search = byTestId(rendered, 'prod-passport-search');
        assert.ok(search);
        assert.equal(search.value, 'ram');
        search.value = 'ssd';
        search.dispatchEvent(new activeDom.window.Event('input', { bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 170));

        assert.equal(patchCalls.length, 1);
        assert.equal(patchCalls[0][0], 'prodPassport');
        assert.deepEqual(patchCalls[0][1], { search: 'ssd', selectedItemId: null });
    });

    it('поиск без совпадений показывает пустое состояние карты вместо плиток', async () => {
        const { renderProdPassportReport } = await import('../../../js/ui/prodPassportReport.js');
        const calc = makeCalc();
        const rendered = renderProdPassportReport(calc, calculate(calc), { search: 'zzz-нет-такого' }, {
            patchModal() {}
        });
        assert.equal(byTestId(rendered, 'prod-passport-treemap'), null);
        assert.match(collectText(rendered), /не найдены/);
    });
});
