import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { calculate, clearCalculationCache } from '../../../js/domain/calculator.js';
import { buildSeedDictionaries, defaultAnswersFrom, SEED_ITEMS, SEED_SETTINGS } from '../../../js/domain/seed.js';

const REQUIRED_BUDGET_FLAGS = Object.freeze([
    'ddos_protection_required',
    'siem_integration_required',
    'dlp_required',
    'audit_logging_required',
    'ai_safety_layer',
    'ai_finetune_needed',
    'ai_finetune_runs_per_year'
]);

function formulasJoined() {
    return SEED_ITEMS
        .flatMap(item => Object.values(item.qtyFormulas || {}))
        .filter(Boolean)
        .join('\n');
}

function makeCalc(override = {}) {
    const dictionaries = buildSeedDictionaries();
    const answers = defaultAnswersFrom(dictionaries.questions);
    Object.assign(answers, {
        ddos_protection_required: false,
        siem_integration_required: false,
        dlp_required: false,
        audit_logging_required: false,
        ai_llm_used: false,
        ai_safety_layer: false,
        ai_finetune_needed: false,
        ai_finetune_runs_per_year: 0
    }, override);
    return {
        id: 'budget-flags-contract',
        name: 'Budget flags contract',
        schemaVersion: 20,
        createdAt: '2026-05-02T00:00:00Z',
        updatedAt: '2026-05-02T00:00:00Z',
        settings: { ...SEED_SETTINGS },
        answers,
        dictionaries
    };
}

function totalFor(override) {
    clearCalculationCache();
    return calculate(makeCalc(override)).totalMonthly;
}

describe('security/AI questionnaire flags affect budget', () => {
    it('critical security and AI flags are referenced by qtyFormulas', () => {
        const formulas = formulasJoined();
        for (const id of REQUIRED_BUDGET_FLAGS) {
            assert.match(formulas, new RegExp(`\\bQ\\.${id}\\b`),
                `${id} must be used in at least one qtyFormula`);
        }
    });

    it('turning each critical flag on changes the calculated total', () => {
        const base = totalFor({});

        assert.ok(totalFor({ ddos_protection_required: true }) > base);
        assert.ok(totalFor({ siem_integration_required: true }) > base);
        assert.ok(totalFor({ dlp_required: true }) > base);
        assert.ok(totalFor({ audit_logging_required: true }) > base);

        const aiBase = totalFor({
            ai_llm_used: true,
            ai_users_share: 20,
            ai_requests_per_user_day: 5,
            ai_avg_input_tokens: 1500,
            ai_avg_output_tokens: 500,
            ai_caching_share: 20,
            ai_safety_layer: false,
            ai_finetune_needed: false,
            ai_finetune_runs_per_year: 0
        });
        assert.ok(totalFor({
            ai_llm_used: true,
            ai_users_share: 20,
            ai_requests_per_user_day: 5,
            ai_avg_input_tokens: 1500,
            ai_avg_output_tokens: 500,
            ai_caching_share: 20,
            ai_safety_layer: true
        }) > aiBase);
        assert.ok(totalFor({
            ai_llm_used: true,
            ai_finetune_needed: true,
            ai_finetune_runs_per_year: 1
        }) > aiBase);
    });
});
