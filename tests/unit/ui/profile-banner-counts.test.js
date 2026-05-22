/**
 * 14.U3: тесты на helper countAnswerSources(answersMeta) из dashboard.js.
 *
 * Контракт:
 *   - Группирует source'ы из answersMeta в 4 ведра:
 *       manual  — ручные правки
 *       profile — wizard / profile / product_type / geography / activity
 *       scale   — масштаб
 *       auto    — derived / sla_preset / compliance
 *   - Неизвестные source'ы НЕ учитываются (не падают тесты, просто 0).
 *   - null / undefined / not-object → все нули.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/* dashboard.js использует document/window — для node-теста делаем минимальный
   no-op mock ДО импорта. Сами рендер-функции мы не вызываем, нужен только
   countAnswerSources. */
globalThis.document = globalThis.document || {
    createElement: () => ({ appendChild() {}, setAttribute() {}, addEventListener() {}, style: {}, classList: { add() {}, remove() {} } }),
    createElementNS: () => ({ appendChild() {}, setAttribute() {} }),
    createTextNode: t => ({ nodeValue: t }),
    body: { appendChild() {} }
};
globalThis.window = globalThis.window || globalThis;

const { countAnswerSources } = await import('../../../js/ui/dashboard.js');

describe('14.U3 countAnswerSources', () => {
    it('null / undefined / not-object → все нули', () => {
        assert.deepEqual(countAnswerSources(null),      { manual: 0, profile: 0, scale: 0, auto: 0 });
        assert.deepEqual(countAnswerSources(undefined), { manual: 0, profile: 0, scale: 0, auto: 0 });
        assert.deepEqual(countAnswerSources('foo'),     { manual: 0, profile: 0, scale: 0, auto: 0 });
        assert.deepEqual(countAnswerSources([]),        { manual: 0, profile: 0, scale: 0, auto: 0 });
    });

    it('пустой объект → все нули', () => {
        assert.deepEqual(countAnswerSources({}), { manual: 0, profile: 0, scale: 0, auto: 0 });
    });

    it('manual считается отдельно', () => {
        const meta = {
            a: { source: 'manual' },
            b: { source: 'manual' },
            c: { source: 'manual' }
        };
        assert.deepEqual(countAnswerSources(meta), { manual: 3, profile: 0, scale: 0, auto: 0 });
    });

    it('scale считается отдельно', () => {
        const meta = {
            a: { source: 'scale' },
            b: { source: 'scale' }
        };
        assert.deepEqual(countAnswerSources(meta), { manual: 0, profile: 0, scale: 2, auto: 0 });
    });

    it('profile / wizard / product_type / geography / activity → общая группа "profile"', () => {
        const meta = {
            a: { source: 'profile' },
            b: { source: 'wizard' },
            c: { source: 'product_type' },
            d: { source: 'geography' },
            e: { source: 'activity' }
        };
        assert.deepEqual(countAnswerSources(meta), { manual: 0, profile: 5, scale: 0, auto: 0 });
    });

    it('derived / sla_preset / compliance → общая группа "auto"', () => {
        const meta = {
            a: { source: 'derived' },
            b: { source: 'sla_preset' },
            c: { source: 'compliance' }
        };
        assert.deepEqual(countAnswerSources(meta), { manual: 0, profile: 0, scale: 0, auto: 3 });
    });

    it('смешанный набор — все ведра подсчитаны корректно', () => {
        const meta = {
            f1: { source: 'manual' },
            f2: { source: 'profile' },
            f3: { source: 'profile' },
            f4: { source: 'wizard' },
            f5: { source: 'scale' },
            f6: { source: 'scale' },
            f7: { source: 'scale' },
            f8: { source: 'derived' },
            f9: { source: 'compliance' }
        };
        assert.deepEqual(countAnswerSources(meta), { manual: 1, profile: 3, scale: 3, auto: 2 });
    });

    it('запись без source / с неизвестным source — игнорируется', () => {
        const meta = {
            a: { source: 'manual' },
            b: {},
            c: { source: 'unknown_xxx' },
            d: null,
            e: { source: 'profile' }
        };
        assert.deepEqual(countAnswerSources(meta), { manual: 1, profile: 1, scale: 0, auto: 0 });
    });
});
