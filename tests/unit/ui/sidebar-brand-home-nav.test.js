/**
 * По требованию пользователя (2026-06-18): клик по иконке приложения в sidebar
 * открывает экран «Расчёты» (вкладка id='calculations', requiresActive:false).
 *
 * Тест ДОКАЗЫВАЕТ поведение (не наличие строки): рендерит sidebar под DOM-mock,
 * захватывающим onClick, находит кнопку-логотип по data-testid и «кликает» —
 * проверяя, что ctx.setActiveTab('calculations') вызван. Плюс a11y-инвариант:
 * логотип — нативный <button> (не вложен в другую кнопку), версия v<...> на месте.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

/* DOM-mock без jsdom: захватывает event-listeners и parent-связи, чтобы можно
 * было «выстрелить» click и пройти по дереву (см. dom-option-value.test.js). */
function makeMockElement(tag = 'div') {
    return {
        tagName: String(tag).toUpperCase(),
        children: [], attributes: {}, style: {}, dataset: {},
        classList: {
            _l: new Set(),
            add(c) { this._l.add(c); }, remove(c) { this._l.delete(c); },
            contains(c) { return this._l.has(c); }
        },
        className: '', id: '', textContent: '', innerHTML: '', title: '', disabled: false,
        _listeners: {},
        _parent: null,
        get parentNode() { return this._parent; },
        appendChild(c) { if (c && typeof c === 'object') { this.children.push(c); c._parent = this; } return c; },
        setAttribute(k, v) { this.attributes[k] = v; },
        getAttribute(k) { return this.attributes[k] ?? null; },
        addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); },
        removeEventListener() {},
        get value() { return this._v; }, set value(v) { this._v = v; }
    };
}

function fire(node, type) {
    for (const fn of node?._listeners?.[type] || []) {
        fn({ preventDefault() {}, stopPropagation() {}, target: node });
    }
}
function findByTestId(node, id) {
    if (!node || typeof node !== 'object') return null;
    if (node.attributes && node.attributes['data-testid'] === id) return node;
    for (const c of node.children || []) { const r = findByTestId(c, id); if (r) return r; }
    return null;
}
function findByClass(node, cls) {
    if (!node || typeof node !== 'object') return null;
    if (node.className && String(node.className).split(/\s+/).includes(cls)) return node;
    for (const c of node.children || []) { const r = findByClass(c, cls); if (r) return r; }
    return null;
}

describe('Sidebar: клик по иконке приложения → экран «Расчёты»', () => {
    let renderSidebar;

    before(async () => {
        globalThis.document = {
            createElement: (t) => makeMockElement(t),
            createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }),
            body: makeMockElement('body'),
            getElementById: () => null,
            addEventListener: () => {}
        };
        ({ renderSidebar } = await import('../../../js/ui/sidebar.js'));
    });

    function render(setActiveTabCalls = []) {
        const ctx = { setActiveTab: (id) => setActiveTabCalls.push(id) };
        const state = { activeCalc: null, activeTab: 'dashboard', ui: { theme: 'dark', advancedModeEnabled: false } };
        return renderSidebar(state, ctx);
    }

    it('логотип приложения — нативная кнопка с data-testid и aria-label', () => {
        const aside = render();
        const btn = findByTestId(aside, 'sidebar-brand-home');
        assert.ok(btn, 'кнопка-логотип sidebar-brand-home должна существовать');
        assert.equal(btn.tagName, 'BUTTON', 'логотип должен быть нативной <button>');
        assert.equal(btn.attributes.type, 'button');
        assert.ok(btn.attributes['aria-label'] && btn.attributes['aria-label'].length > 0,
            'нужен aria-label для screen-reader');
    });

    it('клик по логотипу вызывает ctx.setActiveTab("calculations")', () => {
        const calls = [];
        const aside = render(calls);
        fire(findByTestId(aside, 'sidebar-brand-home'), 'click');
        assert.deepEqual(calls, ['calculations']);
    });

    it('работает без активного расчёта (Расчёты — requiresActive:false)', () => {
        const calls = [];
        const aside = render(calls);
        // activeCalc=null в render() — навигация всё равно должна сработать.
        fire(findByTestId(aside, 'sidebar-brand-home'), 'click');
        assert.deepEqual(calls, ['calculations']);
    });

    it('кнопка-логотип НЕ вложена в другую интерактивную кнопку (WCAG 4.1.2)', () => {
        const aside = render();
        const btn = findByTestId(aside, 'sidebar-brand-home');
        let p = btn._parent;
        while (p) {
            assert.notEqual(p.tagName, 'BUTTON', 'логотип не должен быть вложен в <button>');
            p = p._parent;
        }
    });

    it('подпись версии v<X.Y.Z> остаётся в бренде (контракт published-smoke)', () => {
        const aside = render();
        const ver = findByClass(aside, 'sidebar-brand-version');
        assert.ok(ver, '.sidebar-brand-version должен остаться');
        assert.match(String(ver.textContent), /^v\d+\.\d+\.\d+$/);
    });
});
