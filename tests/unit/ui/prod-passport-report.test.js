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
        const rendered = renderProdPassportReport(calc, calculate(calc), { offset: 0 }, {
            patchModal() {}
        });

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
    });

    it('рендерит факторы как пересекающийся охват, а не аддитивную долю бюджета', async () => {
        const { renderProdPassportReport } = await import('../../../js/ui/prodPassportReport.js');
        const calc = makeCalc();
        const rendered = renderProdPassportReport(calc, calculate(calc), { offset: 0 }, {
            patchModal() {}
        });

        const factorHead = allByClass(rendered, 'prod-passport-factor-head')[0];
        assert.ok(factorHead);
        assert.deepEqual(
            Array.from(factorHead.children).map(collectText),
            ['Фактор', 'Связанные ЭК, тыс.руб./мес.', 'Охват бюджета']
        );
        assert.doesNotMatch(collectText(factorHead), /% бюджета/);
    });

    it('показывает расшифровку выбранного ЭК и скрывает техническую ссылку под раскрытием', async () => {
        const { renderProdPassportReport } = await import('../../../js/ui/prodPassportReport.js');
        const calc = makeCalc();
        const rendered = renderProdPassportReport(calc, calculate(calc), { offset: 0 }, {
            patchModal() {}
        });

        const detail = byTestId(rendered, 'prod-passport-detail');
        const text = collectText(detail);
        assert.match(text, /Как получено количество/);
        assert.match(text, /Подстановка/);
        assert.match(text, /Техническая формула/);
        assert.match(text, /Что повлияло/);
        assert.match(text, /Формула стоимости/);
        assert.match(text, /≈/);
    });

});
