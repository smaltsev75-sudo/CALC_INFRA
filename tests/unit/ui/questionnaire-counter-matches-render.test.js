/**
 * PATCH 2.18.2 (внешний аудит #9, 2026-05-19, P2):
 * счётчик `countAnswered` обязан считать тот же набор вопросов, который
 * фактически рендерится на экране.
 *
 * До фикса: `countAnswered` читал сырой `calc.dictionaries.questions`,
 * `renderSection` мержил недостающие seed-вопросы и фильтровал deprecated —
 * итог расходился. Динамический repro аудитора: `1 / 1 вопросов · 100%`
 * при сотнях seed-вопросов на экране ниже.
 *
 * Контракт-инвариант: `getRenderableQuestions(calc).length` == сумма
 * `questions.length` по всем секциям рендера = total в шапке прогресс-бара.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { getRenderableQuestions } from '../../../js/ui/questionnaire.js';
import { SEED_QUESTIONS, SEED_ITEMS, DEPRECATED_QUESTION_IDS } from '../../../js/domain/seed.js';
import { SECTION_IDS } from '../../../js/utils/constants.js';

function makeLegacyCalc(dictQuestions, answers = {}) {
    return {
        id: 'legacy',
        schemaVersion: 1,
        settings: {},
        answers,
        dictionaries: {
            items: SEED_ITEMS,
            questions: dictQuestions
        }
    };
}

describe('questionnaire: counter matches render total', () => {
    it('legacy-snapshot с 1 живым вопросом получает merge со всеми SEED_QUESTIONS', () => {
        const calc = makeLegacyCalc([
            { id: 'registered_users_total', section: 'business', order: 1, type: 'number', title: 'L', defaultValue: 1000 }
        ]);
        const renderable = getRenderableQuestions(calc);
        assert.ok(renderable.length >= SEED_QUESTIONS.length - DEPRECATED_QUESTION_IDS.size,
            `merge должен дать ≥${SEED_QUESTIONS.length - DEPRECATED_QUESTION_IDS.size} вопросов (SEED − deprecated), получено ${renderable.length}`);
    });

    it('deprecated id из dictionary НЕ попадает в renderable список', () => {
        const calc = makeLegacyCalc([
            { id: 'mau_growth_rate_percent', section: 'business', order: 1, type: 'number', title: 'Stale', defaultValue: 10 }
        ]);
        const renderable = getRenderableQuestions(calc);
        for (const deprecatedId of DEPRECATED_QUESTION_IDS) {
            assert.ok(
                !renderable.some(q => q.id === deprecatedId),
                `renderable список не должен содержать ${deprecatedId}`
            );
        }
    });

    it('сумма getRenderableQuestions по всем секциям == общему renderable.length', () => {
        const calc = makeLegacyCalc([]);
        const total = getRenderableQuestions(calc).length;
        let sectionSum = 0;
        for (const sec of SECTION_IDS) {
            sectionSum += getRenderableQuestions(calc, { sectionId: sec }).length;
        }
        // Все вопросы должны принадлежать одной из SECTION_IDS — иначе total > sectionSum.
        assert.equal(sectionSum, total,
            `сумма по секциям (${sectionSum}) должна равняться общему (${total})`);
    });

    it('countAnswered total == getRenderableQuestions(calc).length', async () => {
        // countAnswered не экспортируется (private), проверяем через косвенный контракт:
        // renderable.length для пустого calc равен seed.length минус deprecated.
        const calc = makeLegacyCalc([]);
        const renderable = getRenderableQuestions(calc);
        const expectedTotal = SEED_QUESTIONS.filter(q => !DEPRECATED_QUESTION_IDS.has(q.id)).length;
        assert.equal(renderable.length, expectedTotal,
            'total из getRenderableQuestions должен совпадать с SEED − deprecated');
    });
});
