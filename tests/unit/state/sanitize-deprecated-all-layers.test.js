/**
 * PATCH 2.18.3 (внешний аудит #10, 2026-05-19, P1.2 + P2.1):
 * `sanitizeDeprecatedQuestions` обязан чистить ВСЕ 5 слоёв, где может
 * храниться deprecated id, не только root.answers + dictionaries.questions.
 *
 * Пропущенные слои в 2.18.2 (моя ошибка scope §5.bis):
 *   - root.answersMeta — orphan «manual»-source без вопроса/ответа
 *   - scenarios[*].answers — switchScenario возвращает stale id в root
 *   - scenarios[*].answersMeta — то же для UI source-badge
 *
 * Forcing function — symmetric invariant: что чистится в root, чистится
 * и в каждом scenario.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeDeprecatedQuestions, DEPRECATED_QUESTION_IDS } from '../../../js/domain/deprecatedQuestions.js';

const STALE = 'mau_growth_rate_percent';

function makeCalcWithStaleAcrossLayers() {
    return {
        id: 'c1',
        schemaVersion: 19,
        settings: {},
        wizard: null,
        // P2.1: orphan meta-key
        answers: { [STALE]: 25, registered_users_total: 1000 },
        answersMeta: { [STALE]: { source: 'manual' }, registered_users_total: { source: 'profile' } },
        dictionaries: {
            items: [],
            questions: [
                { id: STALE, section: 'business', order: 1, type: 'number', title: 'Stale', defaultValue: 10 },
                { id: 'registered_users_total', section: 'business', order: 2, type: 'number', title: 'L', defaultValue: 1000 }
            ]
        },
        // P1.2: scenarios слой
        activeScenarioId: 's1',
        scenarios: [
            {
                id: 's1', label: 'Базовый',
                wizard: null,
                answers: { [STALE]: 30, foo: 'bar' },
                answersMeta: { [STALE]: { source: 'wizard' }, foo: { source: 'manual' } }
            },
            {
                id: 's2', label: 'Альтернатива',
                wizard: null,
                answers: { [STALE]: 40 },
                answersMeta: { [STALE]: { source: 'wizard' } }
            }
        ]
    };
}

describe('sanitizeDeprecatedQuestions: all-layers symmetry', () => {
    it('P2.1 — root.answersMeta очищается от deprecated keys', () => {
        const out = sanitizeDeprecatedQuestions(makeCalcWithStaleAcrossLayers());
        assert.equal(out.answersMeta[STALE], undefined, 'stale id из answersMeta удалён');
        assert.deepEqual(out.answersMeta.registered_users_total, { source: 'profile' }, 'живой meta сохранён');
    });

    it('P1.2 — scenarios[*].answers очищается от deprecated keys', () => {
        const out = sanitizeDeprecatedQuestions(makeCalcWithStaleAcrossLayers());
        assert.equal(out.scenarios.length, 2);
        for (const sc of out.scenarios) {
            assert.equal(sc.answers[STALE], undefined,
                `scenario ${sc.id}: stale id из answers удалён`);
        }
        // Остальные ответы сохранены.
        assert.equal(out.scenarios[0].answers.foo, 'bar', 'живой ответ s1.foo сохранён');
    });

    it('P1.2-meta — scenarios[*].answersMeta очищается от deprecated keys', () => {
        const out = sanitizeDeprecatedQuestions(makeCalcWithStaleAcrossLayers());
        for (const sc of out.scenarios) {
            assert.equal(sc.answersMeta[STALE], undefined,
                `scenario ${sc.id}: stale id из answersMeta удалён`);
        }
        assert.deepEqual(out.scenarios[0].answersMeta.foo, { source: 'manual' }, 'живой meta s1.foo сохранён');
    });

    it('symmetric invariant — если root.answers очищен, то и каждый scenarios[*].answers тоже', () => {
        const calc = makeCalcWithStaleAcrossLayers();
        const out = sanitizeDeprecatedQuestions(calc);
        const rootHasStale = Object.keys(out.answers).some(k => DEPRECATED_QUESTION_IDS.has(k));
        assert.equal(rootHasStale, false, 'root.answers свободен от deprecated');
        for (const sc of out.scenarios) {
            const scHasStale = Object.keys(sc.answers).some(k => DEPRECATED_QUESTION_IDS.has(k));
            assert.equal(scHasStale, false, `scenario ${sc.id}.answers свободен от deprecated`);
            const scMetaHasStale = Object.keys(sc.answersMeta).some(k => DEPRECATED_QUESTION_IDS.has(k));
            assert.equal(scMetaHasStale, false, `scenario ${sc.id}.answersMeta свободен от deprecated`);
        }
    });

    it('идемпотентен на calc без scenarios (legacy compatibility)', () => {
        const legacyCalc = {
            id: 'legacy', schemaVersion: 19, settings: {},
            answers: { [STALE]: 25 },
            answersMeta: { [STALE]: { source: 'manual' } },
            dictionaries: { items: [], questions: [] }
        };
        const out = sanitizeDeprecatedQuestions(legacyCalc);
        assert.equal(out.answers[STALE], undefined);
        assert.equal(out.answersMeta[STALE], undefined);
        assert.equal(out.scenarios, undefined, 'не создаём scenarios на legacy-calc');
    });

    it('reference equality — если calc уже чист во всех слоях, возвращается тот же объект', () => {
        const clean = {
            id: 'c', schemaVersion: 19, settings: {},
            answers: { registered_users_total: 1000 },
            answersMeta: { registered_users_total: { source: 'profile' } },
            dictionaries: { items: [], questions: [] },
            activeScenarioId: 's1',
            scenarios: [{ id: 's1', label: 'A', answers: { foo: 1 }, answersMeta: {} }]
        };
        const out = sanitizeDeprecatedQuestions(clean);
        assert.equal(out, clean, 'тот же reference (no-op для уже-чистого calc)');
    });
});
