/**
 * Фикс 2026-06-17: «Факторы влияния» Паспорта и «Анализ факторов» (модалка)
 * показывали РАЗНЫЙ топ-1 (ai_agent_mode ~15.6 млн vs pdn_152fz ~0.3 млн).
 * Причина: панель Паспорта ранжировала БЕЗ фильтра по 'total', а модалка имеет
 * фильтр (costType + categories), который у пользователя был не дефолтным
 * (категория AI снята) → ai_agent скрыт.
 *
 * Фикс: панель Паспорта читает те же sensitivityFilters, что модалка → топ и
 * числа ВСЕГДА совпадают. Этот тест — forcing function на эту консистентность.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildSeedDictionaries, defaultAnswersFrom } from '../../../js/domain/seed.js';
import { calculate } from '../../../js/domain/calculator.js';
import { buildProdPassport } from '../../../js/domain/prodPassport.js';
import { runSensitivityAnalysis, rankSensitivityDrivers } from '../../../js/domain/sensitivityAnalysis.js';
import { DEFAULT_SENSITIVITY_FILTERS } from '../../../js/utils/constants.js';

function aiCalc() {
    const D = buildSeedDictionaries();
    const A = defaultAnswersFrom(D.questions);
    return {
        id: 'pf', answers: { ...A,
            registered_users_total: 200000, dau_share_of_registered_percent: 30, users_total: 200000,
            ai_llm_used: true, ai_users_share: 40, ai_requests_per_user_day: 5,
            ai_avg_input_tokens: 1500, ai_avg_output_tokens: 800,
            ai_agent_mode: false, pdn_152fz: true, peak_rps: 300, microservices_count: 12 },
        settings: { ...D.settings }, dictionaries: D
    };
}

function passportTop(calc, filters) {
    const model = buildProdPassport(calc, {
        result: calculate(calc), stand: 'PROD', topFactorsLimit: 6, sensitivityFilters: filters
    });
    return model.summary.topFactors;
}
function modalRanked(calc, costType, categories) {
    const { results } = runSensitivityAnalysis(calc);
    return rankSensitivityDrivers(results, costType, categories);
}

describe('Passport «Факторы влияния» ↔ «Анализ факторов»: один фильтр, один топ', () => {
    it('дефолтный фильтр: топ-1 Паспорта == топ-1 модалки (по тем же costType+categories)', () => {
        const calc = aiCalc();
        const top = passportTop(calc, DEFAULT_SENSITIVITY_FILTERS);
        const ranked = modalRanked(calc, DEFAULT_SENSITIVITY_FILTERS.costType, DEFAULT_SENSITIVITY_FILTERS.categories);
        assert.ok(top.length > 0);
        assert.equal(top[0].fieldId, ranked[0].fieldId);
    });

    it('фильтр со снятой категорией AI: ai_agent_mode исчезает из топа Паспорта (как в модалке)', () => {
        const calc = aiCalc();
        const noAi = { costType: 'total', categories: DEFAULT_SENSITIVITY_FILTERS.categories.filter(c => c !== 'ai') };
        const top = passportTop(calc, noAi);
        assert.ok(!top.some(f => f.fieldId === 'ai_agent_mode'),
            'при снятой категории AI ai_agent_mode не должен быть в факторах Паспорта');
        const ranked = modalRanked(calc, noAi.costType, noAi.categories);
        assert.equal(top[0].fieldId, ranked[0].fieldId);
    });

    it('при включённой категории AI ai_agent_mode присутствует (крупнейший рычаг)', () => {
        const calc = aiCalc();
        const top = passportTop(calc, { costType: 'total', categories: DEFAULT_SENSITIVITY_FILTERS.categories });
        assert.equal(top[0].fieldId, 'ai_agent_mode');
    });
});
