import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { calculate } from '../../../js/domain/calculator.js';
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

describe('Паспорт ПРОМ: DOM-контракт отчёта', () => {
    beforeEach(() => installJSDom());
    afterEach(() => restoreJSDom());

    it('рендерит согласованные колонки, страницу из 10 ЭК и числовые data-атрибуты', async () => {
        const { renderProdPassportReport } = await import('../../../js/ui/prodPassportReport.js');
        const calc = makeCalc();
        const patchCalls = [];
        const rendered = renderProdPassportReport(calc, calculate(calc), { offset: 0 }, {
            patchModal: (...args) => patchCalls.push(args)
        });

        assert.ok(byTestId(rendered, 'prod-passport-summary-items'));
        assert.ok(byTestId(rendered, 'prod-passport-summary-month'));
        assert.ok(byTestId(rendered, 'prod-passport-summary-year'));
        assert.equal(byTestId(rendered, 'prod-passport-summary-defaults'), null);
        assert.equal(byTestId(rendered, 'prod-passport-summary-repaired'), null);
        assert.equal(byTestId(rendered, 'prod-passport-summary-warnings'), null);

        const head = byTestId(rendered, 'prod-passport-list-head');
        assert.ok(head, 'должна быть шапка списка ЭК');
        assert.deepEqual(Array.from(head.children).map(collectText), ['ЭК', 'Количество', 'Бюджет/мес.', '% бюджета']);
        assert.doesNotMatch(collectText(head), /Статус|Бюджет\/год/);

        const rows = allByClass(rendered, 'prod-passport-row');
        assert.equal(rows.length, 10);
        for (const row of rows) {
            assert.ok(row.dataset.itemId);
            assert.ok(Number.isFinite(Number(row.dataset.quantity)));
            assert.ok(Number.isFinite(Number(row.dataset.monthlyCost)));
            assert.ok(Number.isFinite(Number(row.dataset.budgetShare)));
        }
        for (let i = 1; i < rows.length; i += 1) {
            assert.ok(Number(rows[i - 1].dataset.monthlyCost) >= Number(rows[i].dataset.monthlyCost));
        }

        const pageButtons = [...rendered.querySelectorAll('[data-testid="prod-passport-page-button"]')];
        assert.ok(pageButtons.length >= 2, 'pager должен показывать номера страниц');
        assert.equal(collectText(pageButtons[0]), '1');
        assert.equal(collectText(pageButtons[1]), '2');
        pageButtons[1].click();
        assert.equal(patchCalls.length, 1);
        assert.equal(patchCalls[0][0], 'prodPassport');
        assert.equal(patchCalls[0][1].offset, 10);
        assert.ok(patchCalls[0][1].selectedItemId);

        assert.equal(byTestId(rendered, 'prod-passport-page-input'), null);
        assert.equal(byTestId(rendered, 'prod-passport-page-go'), null);
    });

    it('рендерит факторы одним блоком с общим цветовым баром, процентами и легендой цветов', async () => {
        const { renderProdPassportReport } = await import('../../../js/ui/prodPassportReport.js');
        const calc = makeCalc();
        const rendered = renderProdPassportReport(calc, calculate(calc), { offset: 0 }, {
            patchModal() {}
        });

        const factorsBlock = byTestId(rendered, 'prod-passport-top-factors');
        assert.equal(factorsBlock.tagName, 'SECTION');
        assert.match(collectText(factorsBlock), /Факторы влияния/);
        assert.equal(allByClass(rendered, 'prod-passport-factor-head').length, 0);
        assert.equal(allByClass(rendered, 'prod-passport-factor-card').length, 0);

        const panels = allByClass(rendered, 'prod-passport-factor-panel');
        assert.equal(panels.length, 1, 'факторы должны быть сведены в один общий блок');
        assert.equal(allByClass(rendered, 'prod-passport-factor-gradient').length, 1);
        const segments = allByClass(rendered, 'prod-passport-factor-segment');
        const items = allByClass(rendered, 'prod-passport-factor-item');
        assert.ok(items.length > 0);
        assert.ok(items.length <= 6);
        assert.equal(segments.length, items.length);
        assert.match(collectText(factorsBlock), /Проценты показывают долю от общего бюджета ПРОМ/);
        assert.match(collectText(factorsBlock), /не суммируются к 100%/);
        assert.match(collectText(items[0]), /тыс\.руб\.\/мес\./);
        assert.match(collectText(items[0]), /\d+\s*%/);
        assert.equal(allByClass(items[0], 'prod-passport-factor-swatch').length, 1);
        assert.equal(allByClass(items[0], 'prod-passport-factor-percent').length, 1);
        const firstCoverage = Number(items[0].dataset.coverage);
        assert.equal(segments[0].style.flexBasis, `${firstCoverage}%`);
    });

    it('показывает расшифровку выбранного ЭК без дублей, с раскрытой формулой количества и без пустого блока влияния', async () => {
        const { renderProdPassportReport } = await import('../../../js/ui/prodPassportReport.js');
        const calc = makeCalc();
        const rendered = renderProdPassportReport(calc, calculate(calc), { offset: 0 }, {
            patchModal() {}
        });

        const detail = byTestId(rendered, 'prod-passport-detail');
        const text = collectText(detail);
        assert.match(text, /Как получено количество/);
        assert.match(text, /Расчёт количества/);
        assert.doesNotMatch(text, /Подстановка/);
        assert.doesNotMatch(text, /Техническая формула/);
        assert.doesNotMatch(text, /Что повлияло/);
        assert.doesNotMatch(text, /В формуле нет ссылок/);
        assert.match(text, /Формула стоимости/);
        assert.match(text, /≈/);
        assert.equal(allByClass(detail, 'prod-passport-detail-result').length, 0);
        const quantityDetails = byTestId(detail, 'prod-passport-quantity-details');
        assert.equal(quantityDetails.tagName, 'SECTION');
        assert.ok(byTestId(detail, 'prod-passport-quantity-calculation'));
        assert.equal(allByClass(detail, 'prod-passport-cost-component-total').length, 0);
        assert.ok(!allByClass(detail, 'prod-passport-cost-component').some(node => collectText(node).startsWith('Итог ')));
    });

    it('не дублирует входные параметры отдельным блоком влияния', async () => {
        const { renderProdPassportReport } = await import('../../../js/ui/prodPassportReport.js');
        const calc = makeCalc();
        const rendered = renderProdPassportReport(calc, calculate(calc), { offset: 0, selectedItemId: 'ram-gb' }, {
            patchModal() {}
        });

        const detail = byTestId(rendered, 'prod-passport-detail');
        assert.doesNotMatch(collectText(detail), /Что повлияло/);
        assert.equal(allByClass(detail, 'prod-passport-input-table').length, 0);
        assert.equal(allByClass(detail, 'prod-passport-input-card').length, 0);
        const formulaValues = allByClass(detail, 'prod-passport-quantity-value');
        assert.ok(formulaValues.length > 0, 'в формуле количества должны быть подставленные значения');
        assert.match(collectText(detail), /Подставленные значения/);
        assert.match(collectText(formulaValues[0]), /Пиковый RPS|Средний RPS|RAM на 1 vCPU|Кэш/);
    });

    it('в расчёте количества использует те же названия и значения, что в блоке подставленных значений', async () => {
        const { renderProdPassportReport } = await import('../../../js/ui/prodPassportReport.js');
        const calc = makeCalc();
        calc.answers.traffic_egress_tb_month = 15;
        calc.answers.peak_rps = 80;
        calc.answers.avg_rps = 80;
        calc.answers.peak_duration_hours = 2;
        calc.answers.avg_response_size_kb = 20;

        const rendered = renderProdPassportReport(calc, calculate(calc), {
            offset: 0,
            selectedItemId: 'traffic-egress-tb'
        }, {
            patchModal() {}
        });

        const detail = byTestId(rendered, 'prod-passport-detail');
        const calculation = byTestId(detail, 'prod-passport-quantity-calculation');
        const valueCards = allByClass(detail, 'prod-passport-quantity-value');

        assert.equal(valueCards.length, 1);
        assert.match(collectText(valueCards[0]), /Фактический исходящий трафик, ТБ\/мес/);
        assert.match(collectText(valueCards[0]), /15/);
        assert.match(collectText(detail), /Количество рассчитано по параметрам.*Фактический исходящий трафик, ТБ\/мес/);
        assert.match(collectText(calculation), /Фактический исходящий трафик, ТБ\/мес \(15\)/);
        assert.doesNotMatch(collectText(calculation), /86400|1048576|Пиковое число запросов|Среднее число запросов/);
        assert.doesNotMatch(collectText(detail), /traffic_egress_tb_month|peak_rps|avg_rps/);
    });

    it('показывает поиск по названию ЭК и сбрасывает страницу после ввода', async () => {
        const { renderProdPassportReport } = await import('../../../js/ui/prodPassportReport.js');
        const calc = makeCalc();
        const patchCalls = [];
        const rendered = renderProdPassportReport(calc, calculate(calc), { offset: 10, search: 'ram' }, {
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
        assert.deepEqual(patchCalls[0][1], {
            search: 'ssd',
            offset: 0,
            selectedItemId: null
        });
    });

});
