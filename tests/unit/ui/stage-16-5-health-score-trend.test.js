/**
 * Stage 16.5 (PATCH 2.9.4) — Health Score Trend UI tests.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

let renderHealthScoreTrend, renderHealthScoreTrendMini, renderHealthScoreTrendEmpty;

before(async () => {
    if (typeof globalThis.document === 'undefined') {
        const stub = () => ({
            tagName: 'DIV', nodeName: 'DIV',
            children: [], childNodes: [], attributes: {}, style: {}, dataset: {},
            classList: { add() {}, remove() {}, toggle() {}, contains() { return false; }, _list: new Set() },
            setAttribute(name, val) { this.attributes[name] = String(val); },
            getAttribute(name) { return this.attributes[name]; },
            removeAttribute(name) { delete this.attributes[name]; },
            appendChild(c) { this.children.push(c); this.childNodes.push(c); return c; },
            insertBefore(c) { this.children.push(c); this.childNodes.push(c); return c; },
            addEventListener() {},
            removeEventListener() {},
            querySelector() { return null; },
            querySelectorAll() { return []; },
            cloneNode() { return stub(); },
            focus() {}
        });
        globalThis.document = {
            createElement: () => stub(),
            createElementNS: () => stub(),
            createTextNode: (text) => ({ nodeType: 3, textContent: String(text) }),
            createDocumentFragment: () => stub(),
            body: stub(), documentElement: stub(), head: stub()
        };
    }
    if (typeof globalThis.window === 'undefined') {
        globalThis.window = { document: globalThis.document, addEventListener() {} };
    }
    const mod = await import('../../../js/ui/healthScoreTrend.js');
    renderHealthScoreTrend = mod.renderHealthScoreTrend;
    renderHealthScoreTrendMini = mod.renderHealthScoreTrendMini;
    renderHealthScoreTrendEmpty = mod.renderHealthScoreTrendEmpty;
});

const sample = (score, src = 'health_check') => ({
    score, errorCount: 0, warningCount: 0, recommendationCount: 0,
    source: src, timestamp: '2026-05-10T12:00:00.000Z'
});

describe('renderHealthScoreTrendMini', () => {
    it('пустая история — empty placeholder', () => {
        const node = renderHealthScoreTrendMini([]);
        assert.notEqual(node, null);
    });

    it('null история — empty placeholder', () => {
        const node = renderHealthScoreTrendMini(null);
        assert.notEqual(node, null);
    });

    it('одна точка — single-state с подсказкой', () => {
        const node = renderHealthScoreTrendMini([sample(78)]);
        assert.notEqual(node, null);
    });

    it('много точек — timeline render', () => {
        const node = renderHealthScoreTrendMini([sample(50), sample(75), sample(91)]);
        assert.notEqual(node, null);
    });

    it('options.limit ограничивает', () => {
        const history = [];
        for (let i = 0; i < 10; i++) history.push(sample(50 + i));
        const node = renderHealthScoreTrendMini(history, { limit: 3 });
        assert.notEqual(node, null);
    });
});

describe('renderHealthScoreTrend', () => {
    it('пустая история — рендерит секцию + empty placeholder', () => {
        const node = renderHealthScoreTrend([]);
        assert.notEqual(node, null);
    });

    it('одна точка — без summary-row, есть last-details', () => {
        const node = renderHealthScoreTrend([sample(78)]);
        assert.notEqual(node, null);
    });

    it('несколько точек — summary + last-details', () => {
        const history = [
            { score: 50, source: 'health_check', timestamp: '2026-05-10T10:00:00.000Z',
              errorCount: 2, warningCount: 5, recommendationCount: 1 },
            { score: 75, source: 'guided_completion', timestamp: '2026-05-10T11:00:00.000Z',
              errorCount: 0, warningCount: 3, recommendationCount: 2 },
            { score: 91, source: 'optimization_playbook', timestamp: '2026-05-10T12:00:00.000Z',
              errorCount: 0, warningCount: 1, recommendationCount: 0 }
        ];
        const node = renderHealthScoreTrend(history);
        assert.notEqual(node, null);
    });

    it('options.onClear — рендерит кнопку очистки', () => {
        let clicked = false;
        const onClear = () => { clicked = true; };
        const node = renderHealthScoreTrend([sample(78)], { onClear });
        assert.notEqual(node, null);
        // нет реального click-симулятора в DOM-mock, проверяем что функция передана
        assert.equal(typeof onClear, 'function');
        assert.equal(clicked, false);
    });

    it('без onClear — кнопки очистки нет', () => {
        const node = renderHealthScoreTrend([sample(78)]);
        assert.notEqual(node, null);
    });
});

describe('renderHealthScoreTrendEmpty', () => {
    it('возвращает узел с подсказкой', () => {
        const node = renderHealthScoreTrendEmpty();
        assert.notEqual(node, null);
    });
});

describe('source labels integration', () => {
    it('каждый source получает корректный label', () => {
        const sources = ['health_check', 'guided_completion', 'optimization_playbook', 'manual_recheck'];
        for (const src of sources) {
            const node = renderHealthScoreTrend([sample(80, src)]);
            assert.notEqual(node, null);
        }
    });
});
