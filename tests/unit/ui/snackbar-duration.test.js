/**
 * Snackbar duration по типу (Этап 12.1.4):
 *   success / info → 4 с (default).
 *   warning        → 6 с.
 *   error          → 8 с — чтобы пользователь успел прочитать ошибку.
 *
 * Тест проверяет:
 *   1. Константа SNACKBAR_DURATION_BY_TYPE экспортируется и содержит все 4 типа.
 *   2. error.duration > warning.duration > success.duration === info.duration.
 *   3. snackbar.js использует setTimeout с правильной длительностью по типу.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

/* ---------- DOM-mock (минимум для snackbar.js) ---------- */

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
    return node;
}

describe('SNACKBAR_DURATION_BY_TYPE (Этап 12.1.4)', () => {
    let SNACKBAR_DURATION_BY_TYPE;

    before(async () => {
        const mod = await import('../../../js/utils/constants.js');
        SNACKBAR_DURATION_BY_TYPE = mod.SNACKBAR_DURATION_BY_TYPE;
    });

    it('экспортируется и содержит 4 типа', () => {
        assert.ok(SNACKBAR_DURATION_BY_TYPE);
        for (const t of ['success', 'info', 'warning', 'error']) {
            assert.equal(typeof SNACKBAR_DURATION_BY_TYPE[t], 'number',
                `тип ${t} должен иметь числовую duration`);
        }
    });

    it('error длиннее warning длиннее success/info', () => {
        const t = SNACKBAR_DURATION_BY_TYPE;
        assert.ok(t.error >= 7000, 'error duration должен быть ≥7c для прочтения');
        assert.ok(t.warning >= 5000, 'warning duration должен быть ≥5c');
        assert.ok(t.error > t.warning, 'error дольше warning');
        assert.ok(t.warning > t.success, 'warning дольше success');
        assert.equal(t.success, t.info, 'success и info одинаковой длительности');
    });

    it('замороженный объект (Object.freeze)', () => {
        assert.ok(Object.isFrozen(SNACKBAR_DURATION_BY_TYPE));
    });
});

describe('snackbar.showSnackbar выбирает duration по типу', () => {
    let showSnackbar;
    const calls = [];

    before(async () => {
        // DOM-mock с поддержкой setAttribute/appendChild/parentNode.
        const body = makeMockElement('body');
        globalThis.document = {
            createElement: (tag) => makeMockElement(tag),
            createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }),
            body,
            getElementById: () => null,
            addEventListener: () => {}
        };
        globalThis.requestAnimationFrame = globalThis.requestAnimationFrame || (cb => cb());

        // Перехватываем setTimeout — записываем delay каждого вызова.
        const realSetTimeout = globalThis.setTimeout;
        globalThis.setTimeout = (fn, delay) => {
            calls.push(delay);
            return 0;
        };
        // Восстанавливаем после загрузки модуля, чтобы node:test после теста не сломался.
        const mod = await import('../../../js/ui/snackbar.js');
        globalThis.setTimeout = realSetTimeout;
        // Подменяем setTimeout снова перед каждым кейсом — через локальную обёртку showSnackbar.
        showSnackbar = (opts) => {
            const prev = globalThis.setTimeout;
            globalThis.setTimeout = (fn, delay) => { calls.push(delay); return 0; };
            try {
                return mod.showSnackbar(opts);
            } finally {
                globalThis.setTimeout = prev;
            }
        };
    });

    function lastDelay() { return calls[calls.length - 1]; }

    it('error → 8000 мс', () => {
        showSnackbar({ message: 'err', type: 'error' });
        assert.equal(lastDelay(), 8000);
    });

    it('warning → 6000 мс', () => {
        showSnackbar({ message: 'warn', type: 'warning' });
        assert.equal(lastDelay(), 6000);
    });

    it('success → 4000 мс', () => {
        showSnackbar({ message: 'ok', type: 'success' });
        assert.equal(lastDelay(), 4000);
    });

    it('info → 4000 мс', () => {
        showSnackbar({ message: 'info', type: 'info' });
        assert.equal(lastDelay(), 4000);
    });

    it('явный duration переопределяет таблицу', () => {
        showSnackbar({ message: 'custom', type: 'error', duration: 1234 });
        assert.equal(lastDelay(), 1234);
    });
});
