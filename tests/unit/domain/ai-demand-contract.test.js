import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    demandNumber,
    getEffectiveLlmTokenDemand,
    hasLlmTokenVisibilityContract,
    hasPositiveTokenDemandInputs,
    hasPositiveTokenDemandSignal,
    isExternalLlmHosting
} from '../../../js/domain/aiDemand.js';

const positiveAnswers = Object.freeze({
    ai_llm_used: true,
    ai_hosting_mode: 'external_api',
    registered_users_total: 500,
    dau_share_of_registered_percent: 0.7,
    ai_users_share: 75,
    ai_requests_per_user_day: 30,
    ai_avg_input_tokens: 3000,
    ai_avg_output_tokens: 500,
    ai_caching_share: 30
});

describe('aiDemand shared contract', () => {
    it('works with calculation.answers shape', () => {
        const calc = { answers: { ...positiveAnswers } };
        assert.equal(hasPositiveTokenDemandSignal(calc), true);
        assert.equal(hasPositiveTokenDemandInputs(calc), true);
        assert.equal(hasLlmTokenVisibilityContract(calc, { externalOnly: true }), true);
    });

    it('works with formula context Q/questionDefaults shape', () => {
        const context = { Q: { ...positiveAnswers } };
        assert.equal(hasPositiveTokenDemandSignal(context), true);
        assert.equal(hasPositiveTokenDemandInputs(context), true);
    });

    it('normalizes localized numeric strings', () => {
        assert.equal(demandNumber({ answers: { x: '1 234,5%' } }, 'x'), 1234.5);
    });

    it('repairs degenerate user-base from acknowledged values, not from global seed defaults', () => {
        const context = {
            Q: {
                ...positiveAnswers,
                registered_users_total: 0,
                dau_share_of_registered_percent: 0
            },
            answersMeta: {
                registered_users_total: { source: 'manual' },
                dau_share_of_registered_percent: { source: 'manual' }
            },
            questionDefaults: {
                registered_users_total: 500_000,
                dau_share_of_registered_percent: 5
            },
            healthAcknowledgements: {
                'confirmed-low-dau': {
                    values: {
                        registered_users_total: 500,
                        dau_share_of_registered_percent: 0.7
                    }
                }
            }
        };

        assert.equal(hasPositiveTokenDemandInputs(context), false);
        assert.equal(hasPositiveTokenDemandInputs(context, { repairDegenerate: true }), true);

        const demand = getEffectiveLlmTokenDemand(context, { repairDegenerate: true });
        assert.equal(demand.registered, 500);
        assert.equal(demand.dauShare, 0.7);
        assert.deepEqual(demand.repairedFields, [
            'registered_users_total',
            'dau_share_of_registered_percent'
        ]);
    });

    it('does not turn explicit registered=0 into 500k without a recovery trace', () => {
        const context = {
            Q: {
                ...positiveAnswers,
                registered_users_total: 0,
                dau_share_of_registered_percent: 5
            },
            answersMeta: {
                registered_users_total: { source: 'manual' }
            },
            questionDefaults: {
                registered_users_total: 500_000,
                dau_share_of_registered_percent: 5
            }
        };

        const demand = getEffectiveLlmTokenDemand(context, { repairDegenerate: true });
        assert.equal(demand.positive, false);
        assert.equal(demand.registered, 0);
        assert.deepEqual(demand.repairedFields, []);
    });

    it('does not claim visibility contract for AI off or on-prem external-only checks', () => {
        assert.equal(hasLlmTokenVisibilityContract({
            answers: { ...positiveAnswers, ai_llm_used: false }
        }, { externalOnly: true }), false);

        const onPrem = { answers: { ...positiveAnswers, ai_hosting_mode: 'on_prem_gpu' } };
        assert.equal(isExternalLlmHosting(onPrem), false);
        assert.equal(hasLlmTokenVisibilityContract(onPrem, { externalOnly: true }), false);
    });
});
