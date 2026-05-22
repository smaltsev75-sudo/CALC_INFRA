/**
 * Модальные окна WCAG 4.1.2 (Name, Role, Value) — Этап 12.2.1.
 *
 * modalShell генерирует уникальный id для .modal-title и связывает его
 * с overlay через aria-labelledby. Screen reader при открытии диалога
 * озвучивает заголовок.
 *
 * Тест проверяет:
 *   1. overlay имеет атрибут aria-labelledby.
 *   2. Указанный id соответствует id у .modal-title.
 *   3. Уникальность id между двумя последовательно созданными модалками.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

function makeMockElement(tag = 'div') {
    const node = {
        tagName: String(tag).toUpperCase(),
        children: [],
        attributes: {},
        style: {},
        dataset: {},
        classList: {
            _list: new Set(),
            add(c) { this._list.add(c); },
            remove(c) { this._list.delete(c); },
            contains(c) { return this._list.has(c); }
        },
        className: '',
        id: '',
        textContent: '',
        innerHTML: '',
        title: '',
        get parentNode() { return this._parent || null; },
        set parentNode(v) { this._parent = v; },
        appendChild(c) { if (c) { this.children.push(c); c._parent = this; } return c; },
        setAttribute(k, v) { this.attributes[k] = v; },
        getAttribute(k) { return this.attributes[k] ?? null; },
        addEventListener() {},
        removeEventListener() {}
    };
    return node;
}

/* Рекурсивный поиск первого узла, у которого есть указанный id. */
function findById(node, id) {
    if (!node) return null;
    if (node.id === id) return node;
    for (const c of node.children || []) {
        const found = findById(c, id);
        if (found) return found;
    }
    return null;
}

describe('modalShell — aria-labelledby (Этап 12.2.1)', () => {
    let modalShell;

    before(async () => {
        globalThis.document = {
            createElement: (tag) => makeMockElement(tag),
            createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }),
            body: makeMockElement('body'),
            getElementById: () => null,
            addEventListener: () => {}
        };
        const mod = await import('../../../js/ui/modals/baseModal.js');
        modalShell = mod.modalShell;
    });

    it('overlay имеет aria-labelledby', () => {
        const overlay = modalShell({ title: 'Test', onClose: () => {}, children: [] });
        const labelId = overlay.getAttribute('aria-labelledby');
        assert.ok(labelId, 'aria-labelledby должен быть установлен');
        assert.match(labelId, /^modal-title-/, 'id должен начинаться с modal-title-');
    });

    it('aria-labelledby ссылается на существующий .modal-title с тем же id', () => {
        const overlay = modalShell({ title: 'Заголовок', onClose: () => {}, children: [] });
        const labelId = overlay.getAttribute('aria-labelledby');
        const titleNode = findById(overlay, labelId);
        assert.ok(titleNode, `узел с id="${labelId}" должен быть в DOM-дереве модалки`);
        assert.equal(titleNode.tagName, 'H3', 'это должен быть заголовок (h3.modal-title)');
        assert.equal(titleNode.textContent, 'Заголовок', 'текст должен совпадать с переданным title');
    });

    it('каждый вызов modalShell даёт уникальный id', () => {
        const a = modalShell({ title: 'A', onClose: () => {}, children: [] });
        const b = modalShell({ title: 'B', onClose: () => {}, children: [] });
        const idA = a.getAttribute('aria-labelledby');
        const idB = b.getAttribute('aria-labelledby');
        assert.ok(idA && idB, 'оба id должны быть установлены');
        assert.notEqual(idA, idB, 'id должны быть уникальными');
    });

    it('overlay имеет role=dialog и aria-modal=true', () => {
        const overlay = modalShell({ title: 'X', onClose: () => {}, children: [] });
        assert.equal(overlay.getAttribute('role'), 'dialog');
        assert.equal(overlay.getAttribute('aria-modal'), 'true');
    });
});
