import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { SEED_ITEMS, SEED_QUESTIONS, DEPRECATED_QUESTION_IDS } from '../../../js/domain/seed.js';

const DERIVED_CALCULATION_QUESTION_IDS = new Set([
    'ai_model_tier',
    'ai_agent_type',
    'agent_complexity',
    'agent_parallel_specialists',
    'agent_tool_use_share'
]);

const NON_EK_CONTROL_QUESTION_IDS = new Set([
    'target_capex_rub',
    'target_opex_monthly_rub',
    'launch_year'
]);

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formulasJoined() {
    return SEED_ITEMS
        .flatMap(item => Object.values(item.qtyFormulas || {}))
        .filter(Boolean)
        .join('\n');
}

describe('questionnaire field impact coverage', () => {
    it('every active questionnaire field either affects EK formulas or is an explicit non-EK control', () => {
        const formulas = formulasJoined();
        const missing = [];

        for (const q of SEED_QUESTIONS) {
            if (!q || DEPRECATED_QUESTION_IDS.has(q.id)) continue;
            const direct = new RegExp(`\\bQ\\.${escapeRegExp(q.id)}\\b`).test(formulas);
            const derived = DERIVED_CALCULATION_QUESTION_IDS.has(q.id);
            const control = NON_EK_CONTROL_QUESTION_IDS.has(q.id);
            if (!direct && !derived && !control) missing.push(`${q.section}.${q.id}`);
        }

        assert.deepEqual(missing, [], 'No active question may be decorative without an explicit control status');
    });
});
