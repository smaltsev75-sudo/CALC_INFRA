/**
 * Regression-тест к 12.U31 (Code Review Followup, Subagent C P1-003):
 * input в модалке с draft-flow должен иметь `data-focus-key` — иначе при
 * изменении соседнего поля (`patchModal('quickStart', { draft: ... })`)
 * полная пересборка DOM роняет фокус на body, и пользователь, набирая текст,
 * теряет каретку при первом же касании select'а / chip'а.
 *
 * Stage 4.9/4.14: newCalcModal удалён, тест переключён на quickStartModal —
 * там тоже input («Название расчёта») рядом с select'ами, тот же сценарий.
 *
 * Механика focus-restore (см. js/ui/focus.js):
 *   1. captureFocus() читает activeElement.getAttribute('data-focus-key').
 *   2. Если key нет — снимок = null → restoreFocus(null) → no-op.
 *   3. Если key есть — после rerender'а document.querySelector ищет
 *      [data-focus-key="..."] и восстанавливает фокус + позицию каретки.
 *
 * Тест функциональный (не regex по исходнику): рендерит модалку под минимальным
 * DOM-mock'ом, обходит дерево и находит input с классом `input` — проверяет
 * атрибут.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

/* Минимальный DOM-mock — копия из ui-modules-smoke.test.js. */
function makeMockElement(tag = 'div') {
    const node = {
        tagName: tag.toUpperCase(),
        nodeName: tag.toUpperCase(),
        children: [],
        childNodes: [],
        attributes: {},
        style: {},
        dataset: {},
        classList: {
            _list: new Set(),
            add(c) { this._list.add(c); },
            remove(c) { this._list.delete(c); },
            toggle(c) { this._list.has(c) ? this._list.delete(c) : this._list.add(c); },
            contains(c) { return this._list.has(c); }
        },
        className: '',
        id: '', textContent: '', innerHTML: '', title: '', value: '', checked: false,
        disabled: false, placeholder: '', type: '',
        get firstChild() { return this.children[0] || null; },
        get parentNode() { return null; },
        appendChild(c) { if (c) { this.children.push(c); this.childNodes.push(c); } return c; },
        removeChild(c) {
            const i = this.children.indexOf(c);
            if (i >= 0) { this.children.splice(i, 1); this.childNodes.splice(i, 1); }
            return c;
        },
        replaceChild(neu, old) {
            const i = this.children.indexOf(old);
            if (i >= 0) { this.children[i] = neu; this.childNodes[i] = neu; }
            return old;
        },
        insertBefore(neu, ref) {
            const i = this.children.indexOf(ref);
            if (i >= 0) { this.children.splice(i, 0, neu); this.childNodes.splice(i, 0, neu); }
            else { this.children.push(neu); this.childNodes.push(neu); }
            return neu;
        },
        setAttribute(k, v) { this.attributes[k] = v; },
        getAttribute(k) { return this.attributes[k] ?? null; },
        removeAttribute(k) { delete this.attributes[k]; },
        hasAttribute(k) { return k in this.attributes; },
        addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
        querySelector() { return null; }, querySelectorAll() { return []; },
        getElementsByClassName() { return []; }, getElementsByTagName() { return []; },
        focus() {}, blur() {}, click() {}, scrollIntoView() {},
        getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; },
        contains() { return false; }, closest() { return null; }
    };
    return node;
}

before(() => {
    globalThis.document = {
        createElement: (tag) => makeMockElement(tag),
        createTextNode: (t) => ({ nodeType: 3, textContent: String(t), nodeValue: String(t) }),
        createDocumentFragment: () => makeMockElement('fragment'),
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener: () => {}, removeEventListener: () => {},
        body: makeMockElement('body'), head: makeMockElement('head'),
        documentElement: makeMockElement('html'), activeElement: null,
        title: '', readyState: 'complete', hidden: false, visibilityState: 'visible'
    };
    globalThis.window = {
        addEventListener: () => {}, removeEventListener: () => {},
        location: { hash: '', pathname: '/', search: '', href: 'http://localhost/', reload: () => {} },
        requestAnimationFrame: (fn) => setTimeout(fn, 0),
        cancelAnimationFrame: (id) => clearTimeout(id),
        innerWidth: 1280, innerHeight: 720,
        matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
        getComputedStyle: () => ({ getPropertyValue: () => '' })
    };
    const _store = new Map();
    globalThis.localStorage = {
        getItem: (k) => _store.has(k) ? _store.get(k) : null,
        setItem: (k, v) => _store.set(k, String(v)),
        removeItem: (k) => _store.delete(k),
        clear: () => _store.clear(),
        get length() { return _store.size; },
        key: (i) => Array.from(_store.keys())[i] ?? null
    };
    globalThis.requestAnimationFrame = globalThis.window.requestAnimationFrame;
    globalThis.cancelAnimationFrame = globalThis.window.cancelAnimationFrame;
    globalThis.HTMLElement = function() {};
});

/** Рекурсивно обойти дерево mock-узлов, найти первый удовлетворяющий predicate. */
function findDescendant(root, predicate) {
    if (!root || !root.children) return null;
    for (const child of root.children) {
        if (!child) continue;
        if (predicate(child)) return child;
        const deep = findDescendant(child, predicate);
        if (deep) return deep;
    }
    return null;
}

describe('quickStartModal: input получает data-focus-key (фокус не теряется при patchModal)', () => {
    it('input.input в quickStartModal имеет attrs[data-focus-key]', async () => {
        const { renderQuickStartModal } = await import('../../../js/ui/modals/quickStartModal.js');
        const state = {
            modals: {
                quickStart: {
                    open: true,
                    /* draft пустой → модалка возьмёт defaultDraft (Стандартный B2B) */
                    draft: null
                }
            }
        };
        const ctx = {
            closeModal: () => {},
            patchModal: () => {},
            createCalc: () => {},
            createCalcFromWizard: () => {}
        };

        const overlay = renderQuickStartModal(state, ctx);
        assert.ok(overlay, 'модалка должна вернуть overlay');

        const input = findDescendant(overlay, n => n.tagName === 'INPUT');
        assert.ok(input, 'в модалке должен быть <input> для названия расчёта');

        const focusKey = input.getAttribute('data-focus-key');
        assert.ok(focusKey,
            'input в quickStartModal должен иметь data-focus-key, иначе captureFocus возвращает null ' +
            'и фокус теряется при изменении select/chip-а соседнего поля (см. js/ui/focus.js).');
    });
});
