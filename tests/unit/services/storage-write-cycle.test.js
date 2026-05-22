/**
 * Regression-тест к 12.U31 (Code Review Followup, Subagent A P2-1):
 * `writeJson(key, value)` должен возвращать `false` при попытке записи объекта
 * с циклической ссылкой, а НЕ бросать TypeError из JSON.stringify.
 *
 * Раньше внешний throw поднимался выше (calcPersistence._atomicCalcAndListWrite
 * не оборачивал JSON.stringify), и вместо graceful-fallback в snackbar
 * пользователь видел raw uncaught error в консоли.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeJson } from '../../../js/services/storage.js';

describe('writeJson: graceful fallback при циклической ссылке (12.U31 E.3)', () => {
    let originalLs;
    before(() => {
        originalLs = globalThis.localStorage;
        const store = new Map();
        globalThis.localStorage = {
            getItem: k => store.has(k) ? store.get(k) : null,
            setItem: (k, v) => store.set(k, String(v)),
            removeItem: k => store.delete(k),
            key: i => Array.from(store.keys())[i] ?? null,
            get length() { return store.size; }
        };
    });
    after(() => { globalThis.localStorage = originalLs; });

    it('циклическая ссылка → false (не throw)', () => {
        const obj = { a: 1 };
        obj.self = obj;  // цикл → JSON.stringify TypeError
        const result = writeJson('cycle-test', obj);
        assert.equal(result, false, 'writeJson должна вернуть false, а не бросить');
    });

    it('кастомный toJSON, который throws → false', () => {
        const obj = { toJSON() { throw new Error('boom'); } };
        const result = writeJson('toJSON-throw', obj);
        assert.equal(result, false);
    });

    it('обычный объект — true', () => {
        const result = writeJson('ok', { x: 1 });
        assert.equal(result, true);
    });
});
