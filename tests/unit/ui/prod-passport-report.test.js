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

    it('плитка «Прочее» кликабельна и раскрывает все ЭК (regression: клик не срабатывал)', async () => {
        const { renderProdPassportReport } = await import('../../../js/ui/prodPassportReport.js');
        const calc = makeCalc();
        const patchCalls = [];
        const collapsed = renderProdPassportReport(calc, calculate(calc), {}, {
            patchModal: (...args) => patchCalls.push(args)
        });

        const other = byTestId(collapsed, 'prod-passport-tile-other');
        assert.ok(other, 'плитка «Прочее» присутствует при свёрнутой карте');
        assert.equal(other.tagName, 'BUTTON', 'плитка «Прочее» должна быть кликабельной кнопкой');
        other.click();
        assert.equal(patchCalls.length, 1);
        assert.equal(patchCalls[0][0], 'prodPassport');
        assert.equal(patchCalls[0][1].treemapExpanded, true);

        // Развёрнутая карта: все ЭК отдельными плитками, «Прочее» нет, есть «Свернуть»
        const result = calculate(calc);
        const model = buildProdPassport(calc, { result, stand: 'PROD', limit: Number.MAX_SAFE_INTEGER, topFactorsLimit: 6 });
        const expanded = renderProdPassportReport(calc, result, { treemapExpanded: true }, { patchModal() {} });
        const tilesExpanded = allByClass(expanded, 'pp-tile').filter(t => t.dataset.itemId);
        assert.equal(tilesExpanded.length, model.items.length, 'развёрнутая карта показывает все ЭК');
        assert.equal(byTestId(expanded, 'prod-passport-tile-other'), null, 'в развёрнутой карте нет «Прочее»');

        // развёрнутая карта — uniform-сетка (не взвешенный treemap → не «винегрет»)
        const grid = byTestId(expanded, 'prod-passport-treemap');
        assert.ok(grid.classList.contains('pp-grid'), 'развёрнутая карта рендерится сеткой .pp-grid');
        assert.equal(allByClass(expanded, 'pp-tm-col').length, 0, 'в сетке нет взвешенных колонок treemap');
        // карточки строго по убыванию бюджета
        const costs = tilesExpanded.map(t => Number(t.dataset.monthlyCost));
        assert.deepEqual(costs, [...costs].sort((a, b) => b - a), 'карточки отсортированы по убыванию бюджета');

        // Кнопка «Свернуть карту» патчит treemapExpanded:false
        const collapseCalls = [];
        const expanded2 = renderProdPassportReport(calc, result, { treemapExpanded: true }, {
            patchModal: (...a) => collapseCalls.push(a)
        });
        const collapseBtn = byTestId(expanded2, 'prod-passport-treemap-collapse');
        assert.ok(collapseBtn, 'есть кнопка «Свернуть карту»');
        collapseBtn.click();
        assert.equal(collapseCalls[0][1].treemapExpanded, false);
    });

    it('плитки treemap не сжимаются ниже контента — анти-обрезка имени (flex-shrink:0 + flex-basis:auto)', async () => {
        const { renderProdPassportReport } = await import('../../../js/ui/prodPassportReport.js');
        const calc = makeCalc();
        const rendered = renderProdPassportReport(calc, calculate(calc), {}, { patchModal() {} });
        // свёрнутая карта: и плитки ЭК, и «Прочее» должны иметь контентный пол высоты
        const tiles = allByClass(rendered, 'pp-tile').filter(t => t.dataset.itemId || t.dataset.other);
        assert.ok(tiles.length > 0, 'есть взвешенные плитки treemap');
        for (const t of tiles) {
            const id = t.dataset.itemId || 'other';
            // flex-shrink:0 → плитка не сожмётся ниже своего контента → имя не обрежется сверху.
            // Регрессия: возврат к style={flex:weight} даст flex-shrink:1 и этот assert упадёт.
            assert.equal(t.style.flexShrink, '0', `плитка ${id}: flex-shrink должен быть 0`);
            assert.equal(t.style.flexBasis, 'auto', `плитка ${id}: flex-basis должен быть auto (пол = высота контента)`);
            assert.ok(Number(t.style.flexGrow) >= 1, `плитка ${id}: flex-grow ∝ бюджету (>=1)`);
        }
    });

    it('рендерит легенду категорий и факторы Вариантом 3 (полоса + легенда сумм)', async () => {
        const { renderProdPassportReport } = await import('../../../js/ui/prodPassportReport.js');
        const calc = makeCalc();
        const rendered = renderProdPassportReport(calc, calculate(calc), {}, { patchModal() {} });

        const legend = allByClass(rendered, 'pp-legend-card');
        assert.equal(legend.length, 1);
        assert.match(collectText(legend[0]), /Категории/);
        assert.ok(allByClass(legend[0], 'pp-lg').length > 0);

        // 2.22.6: цвет swatch легенды берётся из того же источника, что плитки карты —
        // класс .pp-c-<suffix> (renderItemTile), а НЕ var(--cat-*). Иначе в светлой теме
        // яркие плитки ≠ muted-легенда (--cat-* перетемизированы в base.css:253-259).
        // makeCalc имеет HW-ЭК → swatch HW обязан нести класс .pp-c-hw (как плитка).
        assert.ok(allByClass(legend[0], 'pp-c-hw').length >= 1,
            'swatch легенды должен нести класс .pp-c-hw (тот же, что плитка), не var(--cat-*)');

        // Раздел «Факторы влияния» удалён из Паспорта (2.22.5) — карта затрат as-is,
        // без what-if sensitivity.
        assert.ok(!byTestId(rendered, 'prod-passport-top-factors'),
            'раздел «Факторы влияния» должен отсутствовать в Паспорте');
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

    it('в столбце «Параметр» выводится единица измерения там, где короткая метка её потеряла', async () => {
        const { renderProdPassportReport } = await import('../../../js/ui/prodPassportReport.js');
        const calc = makeCalc();
        const result = calculate(calc);
        const model = buildProdPassport(calc, { result, stand: 'PROD', topFactorsLimit: 6 });
        const target = model.items.find(row => row.inputs.questions.some(q => q.id === 'cache_size_gb'));
        assert.ok(target, 'есть ЭК с параметром cache_size_gb (метка «Кэш» без единицы)');

        const rendered = renderProdPassportReport(calc, result, { selectedItemId: target.itemId }, { patchModal() {} });
        const params = byTestId(rendered, 'prod-passport-detail-params');
        assert.ok(params, 'таблица входных параметров отрендерена');
        const units = allByClass(params, 'pp-p-unit').map(collectText);
        assert.ok(units.includes('ГБ'), `ожидали единицу «ГБ» среди ${JSON.stringify(units)}`);
    });

    it('CSV выгружает полный Паспорт ПРОМ независимо от фильтра поиска (regression: терялись строки)', async () => {
        const { buildProdPassportCsvModel, buildProdPassportCsv } = await import('../../../js/ui/prodPassportReport.js');
        const calc = makeCalc();
        const result = calculate(calc);
        const full = buildProdPassportCsvModel(calc, result);
        const filtered = buildProdPassport(calc, { result, stand: 'PROD', search: 'оперативная' });
        assert.ok(filtered.items.length > 0 && filtered.items.length < full.items.length,
            'фильтр поиска действительно сужает набор ЭК');
        const dataLines = buildProdPassportCsv(full).split('\r\n').slice(1).filter(Boolean);
        assert.equal(dataLines.length, full.items.length,
            'CSV содержит все ЭК Паспорта, а не отфильтрованные');
    });
});
