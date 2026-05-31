/**
 * UX-ревью (2026-05-31, #9): при пустом списке расчётов toolbar рендерился
 * безусловно, а empty-state hero добавлял ВТОРУЮ кнопку «Quick Start» и «Импорт
 * JSON» — на первом экране пользователь видел 2× Quick Start. Фикс: в empty-state
 * дублирующий Quick Start и бессмысленный «Полный экспорт» (экспортировать нечего)
 * из toolbar убираются; «Полный импорт» остаётся (восстановление бэкапа на чистой
 * установке должно быть доступно).
 *
 * Поведенческий тест под DOM-stub'ом: считает кнопки в дереве renderCalcList.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

function makeNode(tag) {
    return {
        tagName: tag, id: '', style: {}, dataset: {}, attributes: {}, childNodes: [],
        _class: '', _text: undefined,
        set className(v) { this._class = v; }, get className() { return this._class; },
        setAttribute(k, v) { this.attributes[k] = v; },
        addEventListener() {},
        appendChild(c) { this.childNodes.push(c); return c; },
        set textContent(v) { this._text = String(v); this.childNodes = []; },
        get textContent() {
            if (this._text !== undefined) return this._text;
            return this.childNodes.map(c => (typeof c === 'string' ? c : (c.textContent || ''))).join('');
        },
    };
}
globalThis.document = {
    createElement: t => makeNode(t),
    createTextNode: t => ({ textContent: String(t), nodeType: 3 }),
};

const { renderCalcList } = await import('../../../js/ui/calcList.js');

function buttons(node, acc = []) {
    if (!node || typeof node !== 'object') return acc;
    if (node.tagName === 'button') acc.push(node);
    for (const c of (node.childNodes || [])) buttons(c, acc);
    return acc;
}

const ctx = {
    openQuickStart() {}, exportStateBundle() {}, importStateBundle() {},
    importCalc() {}, createCalc() {},
};

describe('Расчёты: пустое состояние без дубля CTA (#9)', () => {
    it('при 0 расчётов — ровно одна кнопка «Quick Start» (только hero)', () => {
        const tree = renderCalcList({ calcList: [] }, ctx);
        const qs = buttons(tree).filter(b => /Quick Start/.test(b.textContent));
        assert.equal(qs.length, 1,
            `ожидалась 1 кнопка «Quick Start» в empty-state, найдено ${qs.length} (дубль toolbar+hero)`);
    });

    it('при 0 расчётов «Полный экспорт» не показывается (экспортировать нечего)', () => {
        const tree = renderCalcList({ calcList: [] }, ctx);
        const exp = buttons(tree).filter(b => /Полный экспорт/.test(b.textContent));
        assert.equal(exp.length, 0, '«Полный экспорт» не нужен при пустом списке');
    });

    it('при 0 расчётов «Полный импорт» остаётся доступен (восстановление бэкапа)', () => {
        const tree = renderCalcList({ calcList: [] }, ctx);
        const imp = buttons(tree).filter(b => /Полный импорт/.test(b.textContent));
        assert.equal(imp.length, 1, '«Полный импорт» должен оставаться для восстановления резервной копии');
    });
});
