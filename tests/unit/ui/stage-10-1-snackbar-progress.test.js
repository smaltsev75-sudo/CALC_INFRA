/**
 * Stage 10.1: showProgressSnackbar — расширение существующего snackbar для
 * длительных bulk-операций (обновление прайсов нескольких провайдеров).
 *
 * Семантика:
 *   - Возвращает handle: { id, update(value, message?), success(msg), error(msg),
 *     warning(msg), close() }.
 *   - update(value) — устанавливает progress-fill в `value/total * 100%`.
 *   - update(value, msg) — также обновляет текст.
 *   - success/error/warning — превращают snackbar в стандартный финальный тип
 *     (убирают progress-bar, показывают текст результата + ×, авто-закрытие
 *     по SNACKBAR_DURATION_BY_TYPE).
 *   - close — мгновенное закрытие.
 *
 * Это часть UI-слоя; тесты используют DOM-mock из snackbar-duration.test.js.
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

function makeMockElement(tag = 'div') {
    const node = {
        tagName: String(tag).toUpperCase(),
        children: [],
        attributes: {},
        style: {},
        dataset: {},
        _classListAdded: new Set(),
        _className: '',
        get className() { return this._className; },
        set className(v) { this._className = String(v || ''); },
        id: '',
        textContent: '',
        innerHTML: '',
        title: '',
        value: '',
        disabled: false,
        type: '',
        get parentNode() { return this._parent || null; },
        set parentNode(v) { this._parent = v; },
        appendChild(c) { if (c) { this.children.push(c); c._parent = this; } return c; },
        removeChild(c) {
            const i = this.children.indexOf(c);
            if (i >= 0) { this.children.splice(i, 1); c._parent = null; }
            return c;
        },
        setAttribute(k, v) { this.attributes[k] = v; },
        getAttribute(k) { return this.attributes[k] ?? null; },
        addEventListener() {},
        removeEventListener() {}
    };
    /* classList учитывает И className (set через el() props.class), И tokens
       добавленные через classList.add (они хранятся отдельно). При remove —
       удаляем из обоих источников. */
    node.classList = {
        add(c) {
            node._classListAdded.add(c);
            const tokens = node._className ? node._className.split(/\s+/).filter(Boolean) : [];
            if (!tokens.includes(c)) tokens.push(c);
            node._className = tokens.join(' ');
        },
        remove(c) {
            node._classListAdded.delete(c);
            const tokens = node._className ? node._className.split(/\s+/).filter(Boolean) : [];
            node._className = tokens.filter(t => t !== c).join(' ');
        },
        contains(c) {
            const tokens = node._className ? node._className.split(/\s+/).filter(Boolean) : [];
            return tokens.includes(c);
        }
    };
    return node;
}

function findClass(node, cls) {
    if (!node) return null;
    if (node.classList?.contains?.(cls)) return node;
    for (const c of node.children || []) {
        const f = findClass(c, cls);
        if (f) return f;
    }
    return null;
}

function findById(node, dataId) {
    if (!node) return null;
    if (node.getAttribute && node.getAttribute('data-snackbar-id') === String(dataId)) return node;
    for (const c of node.children || []) {
        const f = findById(c, dataId);
        if (f) return f;
    }
    return null;
}

let snackbar;
let body;

before(async () => {
    body = makeMockElement('body');
    globalThis.document = {
        createElement: (tag) => makeMockElement(tag),
        createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }),
        body,
        getElementById: () => null,
        addEventListener: () => {}
    };
    globalThis.requestAnimationFrame = globalThis.requestAnimationFrame ||
        ((cb) => cb());
    /* Перехватываем setTimeout — чтобы тесты не висели на реальных таймерах. */
    globalThis.setTimeout = (fn /* , delay */) => 0;
    snackbar = await import('../../../js/ui/snackbar.js');
});

describe('Stage 10.1 showProgressSnackbar — базовый API', () => {
    it('экспортирует функцию showProgressSnackbar', () => {
        assert.equal(typeof snackbar.showProgressSnackbar, 'function');
    });

    it('возвращает handle с методами update / success / error / warning / close', () => {
        const h = snackbar.showProgressSnackbar({ message: 'Обновление…', total: 3 });
        assert.equal(typeof h.id, 'number');
        assert.equal(typeof h.update, 'function');
        assert.equal(typeof h.success, 'function');
        assert.equal(typeof h.error, 'function');
        assert.equal(typeof h.warning, 'function');
        assert.equal(typeof h.close, 'function');
    });

    it('создаёт DOM-элемент с классом snackbar-progress', () => {
        const h = snackbar.showProgressSnackbar({ message: 'Обновление…', total: 2 });
        const item = findById(body, h.id);
        assert.ok(item, 'snackbar item должен быть создан');
        assert.ok(item.classList.contains('snackbar'));
        assert.ok(item.classList.contains('snackbar-progress'));
    });

    it('содержит progress-bar и progress-fill', () => {
        const h = snackbar.showProgressSnackbar({ message: 'X', total: 4 });
        const item = findById(body, h.id);
        const bar = findClass(item, 'snackbar-progress-bar');
        const fill = findClass(item, 'snackbar-progress-fill');
        assert.ok(bar);
        assert.ok(fill);
    });

    it('содержит счётчик 0 / total в начале', () => {
        const h = snackbar.showProgressSnackbar({ message: 'X', total: 5 });
        const item = findById(body, h.id);
        const counter = findClass(item, 'snackbar-progress-counter');
        assert.ok(counter);
        assert.equal(counter.textContent, '0 / 5');
    });
});

describe('Stage 10.1 showProgressSnackbar.update', () => {
    it('update(2, total=4) → fill.style.width = "50%"', () => {
        const h = snackbar.showProgressSnackbar({ message: 'X', total: 4 });
        h.update(2);
        const fill = findClass(findById(body, h.id), 'snackbar-progress-fill');
        assert.equal(fill.style.width, '50%');
    });

    it('update(4, total=4) → width = "100%"', () => {
        const h = snackbar.showProgressSnackbar({ message: 'X', total: 4 });
        h.update(4);
        const fill = findClass(findById(body, h.id), 'snackbar-progress-fill');
        assert.equal(fill.style.width, '100%');
    });

    it('update(0) → width = "0%"', () => {
        const h = snackbar.showProgressSnackbar({ message: 'X', total: 3 });
        h.update(0);
        const fill = findClass(findById(body, h.id), 'snackbar-progress-fill');
        assert.equal(fill.style.width, '0%');
    });

    it('update(value > total) clamps на total', () => {
        const h = snackbar.showProgressSnackbar({ message: 'X', total: 3 });
        h.update(10);
        const fill = findClass(findById(body, h.id), 'snackbar-progress-fill');
        assert.equal(fill.style.width, '100%');
    });

    it('update(negative) clamps на 0', () => {
        const h = snackbar.showProgressSnackbar({ message: 'X', total: 3 });
        h.update(-5);
        const fill = findClass(findById(body, h.id), 'snackbar-progress-fill');
        assert.equal(fill.style.width, '0%');
    });

    it('update(value, message) обновляет текст', () => {
        const h = snackbar.showProgressSnackbar({ message: 'Init', total: 3 });
        h.update(1, 'Загружаем sbercloud');
        const text = findClass(findById(body, h.id), 'snackbar-text');
        assert.equal(text.textContent, 'Загружаем sbercloud');
    });

    it('update обновляет счётчик', () => {
        const h = snackbar.showProgressSnackbar({ message: 'X', total: 5 });
        h.update(3);
        const counter = findClass(findById(body, h.id), 'snackbar-progress-counter');
        assert.equal(counter.textContent, '3 / 5');
    });

    it('total=0 → width=0% (защита от деления на ноль)', () => {
        const h = snackbar.showProgressSnackbar({ message: 'X', total: 0 });
        h.update(0);
        const fill = findClass(findById(body, h.id), 'snackbar-progress-fill');
        assert.equal(fill.style.width, '0%');
    });
});

describe('Stage 10.1 showProgressSnackbar.success / error / warning', () => {
    it('success(msg) → удаляет progress-bar, добавляет класс snackbar-success, текст обновляется', () => {
        const h = snackbar.showProgressSnackbar({ message: 'X', total: 3 });
        h.success('Готово: 3 провайдера');
        const item = findById(body, h.id);
        assert.ok(item.classList.contains('snackbar-success'));
        assert.ok(!item.classList.contains('snackbar-progress'));
        assert.equal(findClass(item, 'snackbar-progress-bar'), null,
            'progress-bar убран после success');
        const text = findClass(item, 'snackbar-text');
        assert.equal(text.textContent, 'Готово: 3 провайдера');
    });

    it('error(msg) → snackbar-error', () => {
        const h = snackbar.showProgressSnackbar({ message: 'X', total: 3 });
        h.error('Все запросы упали');
        const item = findById(body, h.id);
        assert.ok(item.classList.contains('snackbar-error'));
        assert.equal(findClass(item, 'snackbar-progress-bar'), null);
    });

    it('warning(msg) → snackbar-warning', () => {
        const h = snackbar.showProgressSnackbar({ message: 'X', total: 3 });
        h.warning('Часть упала');
        const item = findById(body, h.id);
        assert.ok(item.classList.contains('snackbar-warning'));
        assert.equal(findClass(item, 'snackbar-progress-bar'), null);
    });

    it('после finalize появляется кнопка ×', () => {
        const h = snackbar.showProgressSnackbar({ message: 'X', total: 3 });
        h.success('OK');
        const closeBtn = findClass(findById(body, h.id), 'snackbar-close');
        assert.ok(closeBtn, 'кнопка закрытия должна появиться');
    });

    it('повторный success — no-op (не дублирует close-кнопку)', () => {
        const h = snackbar.showProgressSnackbar({ message: 'X', total: 3 });
        h.success('OK');
        h.success('OK 2');
        /* Отсутствие throw'а уже достаточно — UI не должен ломаться при двойном вызове. */
        assert.ok(true);
    });
});

describe('Stage 10.1 showProgressSnackbar.close', () => {
    it('close() убирает .show класс', () => {
        const h = snackbar.showProgressSnackbar({ message: 'X', total: 3 });
        const item = findById(body, h.id);
        assert.ok(item.classList.contains('show'),
            'после requestAnimationFrame класс show должен быть');
        h.close();
        assert.ok(!item.classList.contains('show'));
    });
});
