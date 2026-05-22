/**
 * Stage 19 (2026-05-19, MINOR 2.19.0): инвариант «LOAD ≤ PROD по qty/cost»
 * СНЯТ. Нагрузочный стенд под stress'ом теперь может иметь capacity-запас
 * сверх PROD до 1.20 (см. [STAND_RATIO_RANGES.LOAD][js/utils/constants.js]).
 *
 * Историческое обоснование (13.U10): «нагрузочный стенд имитирует прод».
 * Stage 19 обоснование: нагрузочное тестирование под stress'ом требует
 * мощности выше предполагаемой прод-нагрузки чтобы найти пределы.
 *
 * Сохранённая проверка: LOAD ≤ STAND_RATIO_RANGES.LOAD.max × PROD по qty/cost
 * для recurring-ЭК. Защита от случайного breach потолка (например,
 * kScheduleShift применённый к LOAD дополнительно к standSizeRatio).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSeedDictionaries, defaultAnswersFrom, SEED_SETTINGS, SEED_QUESTIONS } from '../../../js/domain/seed.js';
import { calculate } from '../../../js/domain/calculator.js';
import { STAND_RATIO_RANGES } from '../../../js/utils/constants.js';

function fullCalc() {
    const dict = buildSeedDictionaries();
    const answers = defaultAnswersFrom(SEED_QUESTIONS);
    answers.ai_llm_used = true;
    answers.ai_hosting_mode = 'external_api';
    answers.rag_needed = true;
    answers.ai_agent_mode = true;
    answers.agent_tool_use_share = 50;
    answers.agent_tool_avg_seconds = 3;
    return { schemaVersion: 11, settings: { ...SEED_SETTINGS }, answers, dictionaries: dict };
}

const LOAD_MAX_RATIO = STAND_RATIO_RANGES.LOAD.max;  // 1.20 после Stage 19

describe('LOAD ratio bound (Stage 19: LOAD ≤ STAND_RATIO_RANGES.LOAD.max × PROD)', () => {
    it('для recurring-ЭК: qty(LOAD) ≤ LOAD.max × qty(PROD)', () => {
        const calc = fullCalc();
        const r = calculate(calc);
        const violations = [];
        for (const item of calc.dictionaries.items) {
            if (item.billingInterval === 'oneTime') continue;
            const stands = (item.applicableStands || []);
            if (!stands.includes('LOAD') || !stands.includes('PROD')) continue;
            const ld = r.items[item.id]?.stands?.LOAD?.qty ?? 0;
            const pr = r.items[item.id]?.stands?.PROD?.qty ?? 0;
            /* Допустимо LOAD ≤ LOAD.max × PROD. ceil/round могут сдвинуть на 1
             * единицу — даём tolerance 1.01 × LOAD.max. */
            const ceiling = pr * LOAD_MAX_RATIO * 1.01 + 1;
            if (ld > ceiling) {
                violations.push(`${item.id}: LOAD qty ${ld} > ceiling ${ceiling.toFixed(2)} (PROD ${pr})`);
            }
        }
        assert.equal(violations.length, 0,
            `нарушения LOAD ≤ ${LOAD_MAX_RATIO} × PROD по qty:\n` + violations.join('\n'));
    });

    it('для recurring-ЭК: costFinal(LOAD) ≤ LOAD.max × resource-mul × costFinal(PROD)', () => {
        /* costFinal включает риск-коэффициенты (kSeasonal/kScheduleShift и т.д.),
         * которые могут применяться к LOAD дополнительно (например, network-traffic
         * получает kSeasonal только на LOAD/PROD). Tolerance 1.40 учитывает это.
         * Главное — поймать абсурд «LOAD в 5× больше PROD». */
        const calc = fullCalc();
        const r = calculate(calc);
        const ceilingMul = LOAD_MAX_RATIO * 1.40;  // 1.20 * 1.40 ≈ 1.68
        const violations = [];
        for (const item of calc.dictionaries.items) {
            if (item.billingInterval === 'oneTime') continue;
            const stands = (item.applicableStands || []);
            if (!stands.includes('LOAD') || !stands.includes('PROD')) continue;
            const ld = r.items[item.id]?.stands?.LOAD?.costFinal ?? 0;
            const pr = r.items[item.id]?.stands?.PROD?.costFinal ?? 0;
            const ceiling = pr * ceilingMul + 1e-3;
            if (ld > ceiling) {
                violations.push(`${item.id}: LOAD cost ${ld.toFixed(2)} > ceiling ${ceiling.toFixed(2)} (PROD ${pr.toFixed(2)})`);
            }
        }
        assert.equal(violations.length, 0,
            `нарушения LOAD ≤ ${ceilingMul.toFixed(2)} × PROD по costFinal (sanity):\n` + violations.join('\n'));
    });
});
