/**
 * Stage 5A — ekClass (классификатор «драйвер количества» для всех ЭК).
 *
 * Решения (DECISIONS.md, Stage 5A):
 *   - ekClass = ЧТО определяет qty ЭК (load/data/ai/prod-derived/flag/count/constant).
 *     Это ортогональная ось к category (UI-группа) и resourceClass (тип ресурса).
 *   - getEkClass — total-function: для legacy-словарей без поля ekClass деривирует
 *     fallback по resourceClass. Fallback НИКОГДА не возвращает 'prod-derived'
 *     (иначе legacy DR-ЭК получили бы пере-расчёт от S.prod*, которого в их
 *     сохранённых формулах нет) — backward-compat сохранён.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { EKCLASS_IDS, EKCLASS_LABELS } from '../../../js/utils/constants.js';
import { getEkClass } from '../../../js/domain/ekClass.js';

describe('Stage 5A ekClass — контракт констант', () => {
    it('EKCLASS_IDS = ровно 7 драйверов', () => {
        assert.deepEqual([...EKCLASS_IDS].sort(), [
            'ai-driven', 'constant', 'count-driven', 'data-driven',
            'flag-fixed', 'load-driven', 'prod-derived'
        ]);
    });
    it('у каждого id есть человеко-читаемый label', () => {
        for (const id of EKCLASS_IDS) {
            assert.equal(typeof EKCLASS_LABELS[id], 'string');
            assert.ok(EKCLASS_LABELS[id].length > 0, `label для ${id}`);
        }
    });
});

describe('Stage 5A ekClass — getEkClass passthrough', () => {
    for (const id of ['load-driven', 'data-driven', 'ai-driven', 'prod-derived',
        'flag-fixed', 'count-driven', 'constant']) {
        it(`валидный ekClass='${id}' проходит как есть`, () => {
            assert.equal(getEkClass({ ekClass: id, resourceClass: 'STORAGE' }), id);
        });
    }
});

describe('Stage 5A ekClass — getEkClass fallback (legacy без поля)', () => {
    it('AI_LLM → ai-driven', () => {
        assert.equal(getEkClass({ resourceClass: 'AI_LLM' }), 'ai-driven');
    });
    it('CPU → load-driven', () => {
        assert.equal(getEkClass({ resourceClass: 'CPU' }), 'load-driven');
    });
    it('RAM → load-driven', () => {
        assert.equal(getEkClass({ resourceClass: 'RAM' }), 'load-driven');
    });
    it('STORAGE → data-driven', () => {
        assert.equal(getEkClass({ resourceClass: 'STORAGE' }), 'data-driven');
    });
    it('RESERVE → flag-fixed (НЕ prod-derived: legacy DR сохраняет старое поведение)', () => {
        assert.equal(getEkClass({ resourceClass: 'RESERVE' }), 'flag-fixed');
    });
    it('невалидный ekClass → fallback по resourceClass', () => {
        assert.equal(getEkClass({ ekClass: 'bogus', resourceClass: 'STORAGE' }), 'data-driven');
    });
    it('total-function: null / {} / undefined не бросают', () => {
        assert.equal(getEkClass(null), 'flag-fixed');
        assert.equal(getEkClass(undefined), 'flag-fixed');
        assert.equal(getEkClass({}), 'flag-fixed');
    });
    it('fallback никогда не возвращает prod-derived/constant/count-driven', () => {
        for (const rc of ['CPU', 'RAM', 'STORAGE', 'NETWORK', 'LICENSE',
            'TRAFFIC', 'SERVICE', 'AI_LLM', 'ONE_TIME', 'RESERVE']) {
            const cls = getEkClass({ resourceClass: rc });
            assert.ok(!['prod-derived', 'constant', 'count-driven'].includes(cls),
                `fallback для ${rc} не должен быть ${cls}`);
        }
    });
});
