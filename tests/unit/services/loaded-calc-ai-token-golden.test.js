/**
 * Golden loaded-calc AI token contracts.
 *
 * These fixtures run through prepareLoadedCalc() before calculate(). They pin
 * token qty and dashboard AI aggregation, not ruble totals, because price
 * refreshes should not create noisy failures for this UI-visibility contract.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { calculate, clearCalculationCache } from '../../../js/domain/calculator.js';
import {
    buildSeedDictionaries,
    defaultAnswersFrom,
    SEED_SETTINGS
} from '../../../js/domain/seed.js';
import { wizardToAnswers } from '../../../js/domain/wizardProfiles.js';
import { prepareLoadedCalc } from '../../../js/services/loadedCalc.js';
import { aggregateAiMetrics } from '../../../js/ui/dashboardAggregates.js';
import { CURRENT_SCHEMA_VERSION, STAND_IDS } from '../../../js/utils/constants.js';

const CREATED_AT = '2026-05-26T00:00:00Z';

const SCENARIOS = Object.freeze([
    {
        id: 'low-dau-heavy',
        wizard: {
            product_type: 'b2c', industry: 'edtech', scale: 'm',
            geography: 'ru', pdn: true, activity: 'high', ai_used: true
        },
        answers: {
            registered_users_total: 500,
            dau_share_of_registered_percent: 0.7,
            ai_users_share: 75,
            ai_requests_per_user_day: 30,
            ai_avg_input_tokens: 3000,
            ai_avg_output_tokens: 500,
            ai_model_tier: 'heavy',
            ai_hosting_mode: 'external_api',
            ai_caching_share: 30
        },
        expected: {
            tokenTotalQty: 54,
            tokenStandQty: { DEV: 2, IFT: 4, PSI: 10, PROD: 19, LOAD: 19 },
            inputQty: { DEV: 1, IFT: 3, PSI: 8, PROD: 15, LOAD: 15 },
            outputQty: { DEV: 1, IFT: 1, PSI: 2, PROD: 4, LOAD: 4 }
        }
    },
    {
        id: 'high-dau-light',
        wizard: {
            product_type: 'b2c', industry: 'consumer', scale: 'l',
            geography: 'ru', pdn: true, activity: 'medium', ai_used: true
        },
        answers: {
            registered_users_total: 500_000,
            dau_share_of_registered_percent: 25,
            ai_users_share: 20,
            ai_requests_per_user_day: 3,
            ai_avg_input_tokens: 800,
            ai_avg_output_tokens: 200,
            ai_model_tier: 'light',
            ai_hosting_mode: 'external_api',
            ai_caching_share: 50
        },
        expected: {
            tokenTotalQty: 1618,
            tokenStandQty: { DEV: 14, IFT: 119, PSI: 297, PROD: 594, LOAD: 594 },
            inputQty: { DEV: 8, IFT: 72, PSI: 180, PROD: 360, LOAD: 360 },
            outputQty: { DEV: 4, IFT: 36, PSI: 90, PROD: 180, LOAD: 180 }
        }
    },
    {
        id: 'on-prem-gpu',
        wizard: {
            product_type: 'b2c', industry: 'edtech', scale: 'm',
            geography: 'ru', pdn: true, activity: 'high', ai_used: true
        },
        answers: {
            ai_hosting_mode: 'on_prem_gpu',
            registered_users_total: 100_000,
            dau_share_of_registered_percent: 20,
            ai_users_share: 40,
            ai_requests_per_user_day: 5,
            ai_avg_input_tokens: 1500,
            ai_avg_output_tokens: 500,
            ai_caching_share: 0,
            rag_needed: true,
            rag_corpus_size_gb: 20,
            rag_embeddings_million: 3
        },
        expected: {
            tokenTotalQty: 6528,
            tokenStandQty: { DEV: 48, IFT: 480, PSI: 1200, PROD: 2400, LOAD: 2400 },
            inputQty: { DEV: 0, IFT: 0, PSI: 0, PROD: 0, LOAD: 0 },
            outputQty: { DEV: 0, IFT: 0, PSI: 0, PROD: 0, LOAD: 0 }
        }
    },
    {
        id: 'rag-only-legacy',
        wizard: {
            product_type: 'b2b', industry: 'corporate', scale: 'm',
            geography: 'ru', pdn: true, activity: 'medium', ai_used: false
        },
        answers: {
            ai_llm_used: false,
            rag_needed: true,
            ai_hosting_mode: 'external_api',
            registered_users_total: 100_000,
            dau_share_of_registered_percent: 10,
            ai_users_share: 25,
            ai_requests_per_user_day: 2,
            ai_avg_input_tokens: 1200,
            ai_avg_output_tokens: 300,
            ai_caching_share: 25
        },
        answersMeta: { rag_needed: { source: 'manual' } },
        expected: {
            tokenTotalQty: 541,
            tokenStandQty: { DEV: 5, IFT: 40, PSI: 100, PROD: 198, LOAD: 198 },
            inputQty: { DEV: 3, IFT: 27, PSI: 68, PROD: 135, LOAD: 135 },
            outputQty: { DEV: 1, IFT: 9, PSI: 23, PROD: 45, LOAD: 45 }
        }
    },
    {
        id: 'ai-off',
        wizard: {
            product_type: 'b2b', industry: 'corporate', scale: 'm',
            geography: 'ru', pdn: true, activity: 'medium', ai_used: false
        },
        answers: {
            ai_llm_used: false,
            rag_needed: false,
            ai_agent_mode: false,
            ai_users_share: 0,
            ai_requests_per_user_day: 0,
            ai_avg_input_tokens: 0,
            ai_avg_output_tokens: 0
        },
        expected: {
            tokenTotalQty: 0,
            tokenStandQty: { DEV: 0, IFT: 0, PSI: 0, PROD: 0, LOAD: 0 },
            inputQty: { DEV: 0, IFT: 0, PSI: 0, PROD: 0, LOAD: 0 },
            outputQty: { DEV: 0, IFT: 0, PSI: 0, PROD: 0, LOAD: 0 }
        }
    },
    {
        id: 'degenerate-userbase',
        wizard: {
            product_type: 'b2c', industry: 'edtech', scale: 'm',
            geography: 'ru', pdn: true, activity: 'high', ai_used: true
        },
        answers: {
            ai_llm_used: true,
            ai_hosting_mode: 'external_api',
            registered_users_total: 0,
            dau_share_of_registered_percent: 5,
            ai_users_share: 75,
            ai_requests_per_user_day: 30,
            ai_avg_input_tokens: 3000,
            ai_avg_output_tokens: 500,
            ai_model_tier: 'heavy',
            ai_caching_share: 30
        },
        healthAcknowledgements: {
            'confirmed-low-dau': {
                values: {
                    registered_users_total: 500,
                    dau_share_of_registered_percent: 0.7
                }
            }
        },
        expected: {
            tokenTotalQty: 54,
            tokenStandQty: { DEV: 2, IFT: 4, PSI: 10, PROD: 19, LOAD: 19 },
            inputQty: { DEV: 1, IFT: 3, PSI: 8, PROD: 15, LOAD: 15 },
            outputQty: { DEV: 1, IFT: 1, PSI: 2, PROD: 4, LOAD: 4 }
        }
    }
]);

function buildRawCalc(scenario) {
    const dictionaries = buildSeedDictionaries();
    const baseAnswers = defaultAnswersFrom(dictionaries.questions);
    const wizard = wizardToAnswers(scenario.wizard);
    return {
        id: `loaded-ai-token-${scenario.id}`,
        name: `Loaded AI token golden: ${scenario.id}`,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
        settings: {
            ...SEED_SETTINGS,
            applyRiskFactors: false,
            ...(scenario.settings || {})
        },
        answers: {
            ...baseAnswers,
            ...wizard.answers,
            ...(scenario.answers || {})
        },
        answersMeta: {
            ...(wizard.meta || {}),
            ...(scenario.answersMeta || {})
        },
        dictionaries,
        view: { disabledStands: [] },
        wizard: scenario.wizard,
        healthAcknowledgements: scenario.healthAcknowledgements || {}
    };
}

function loadedScenarioSummary(scenario) {
    const prepared = prepareLoadedCalc(JSON.parse(JSON.stringify(buildRawCalc(scenario))));
    assert.equal(prepared.error, null);
    clearCalculationCache();
    const calc = prepared.calc;
    const result = calculate(calc);
    const disabledStands = calc.view?.disabledStands || [];
    const ai = aggregateAiMetrics(
        result,
        calc.dictionaries.items,
        disabledStands,
        calc.settings.applyRiskFactors !== false,
        calc
    );

    const itemQtyByStand = (itemId) => Object.fromEntries(
        STAND_IDS.map(stand => [stand, Math.round(result.items[itemId]?.stands?.[stand]?.qty || 0)])
    );

    return {
        tokenTotalQty: Math.round(ai.total.TOKENS?.qty || 0),
        tokenStandQty: Object.fromEntries(
            STAND_IDS.map(stand => [stand, Math.round(ai.perStand[stand]?.TOKENS?.qty || 0)])
        ),
        inputQty: itemQtyByStand('llm-tokens-input-1m'),
        outputQty: itemQtyByStand('llm-tokens-output-1m')
    };
}

function loadedScenarioCostSummary(scenario) {
    const prepared = prepareLoadedCalc(JSON.parse(JSON.stringify(buildRawCalc(scenario))));
    assert.equal(prepared.error, null);
    clearCalculationCache();
    const result = calculate(prepared.calc);
    return {
        totalMonthly: Math.round(result.totalMonthly),
        aiMonthly: Math.round(result.byCategory.AI || 0)
    };
}

describe('loaded-calc golden: AI token visibility contract', () => {
    for (const scenario of SCENARIOS) {
        it(`${scenario.id}: prepared calc keeps expected token qty`, () => {
            assert.deepEqual(loadedScenarioSummary(scenario), scenario.expected);
        });
    }

    it('degenerate recovery keeps AI cost at the acknowledged low-DAU baseline', () => {
        const baseline = loadedScenarioCostSummary(SCENARIOS.find(s => s.id === 'low-dau-heavy'));
        const degenerate = loadedScenarioCostSummary(SCENARIOS.find(s => s.id === 'degenerate-userbase'));
        assert.equal(degenerate.aiMonthly, baseline.aiMonthly);
        assert.ok(degenerate.aiMonthly < 1_000_000,
            `degenerate recovery must not silently bill seed-scale AI costs, got ${degenerate.aiMonthly}`);
    });
});
