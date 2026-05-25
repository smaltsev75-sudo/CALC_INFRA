import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    aggregateAiMetrics,
    aggregateResources,
    distributeRoundingPreservingSum,
    formatResourceQty
} from '../../../js/ui/dashboardAggregates.js';
import { calculate } from '../../../js/domain/calculator.js';
import { buildSeedDictionaries, defaultAnswersFrom } from '../../../js/domain/seed.js';

function makeOnPremAiCalc(overrides = {}) {
    const dictionaries = buildSeedDictionaries();
    return {
        dictionaries,
        settings: {
            applyRiskFactors: false
        },
        view: { disabledStands: [] },
        answers: {
            ...defaultAnswersFrom(dictionaries.questions),
            registered_users_total: 10_000,
            dau_share_of_registered_percent: 20,
            ai_llm_used: true,
            ai_hosting_mode: 'on_prem_gpu',
            ai_users_share: 50,
            ai_requests_per_user_day: 10,
            ai_avg_input_tokens: 2_000,
            ai_avg_output_tokens: 500,
            ai_caching_share: 0,
            rag_needed: true,
            rag_corpus_size_gb: 2,
            rag_refresh_frequency: 'monthly',
            ...overrides
        }
    };
}

describe('dashboardAggregates', () => {
    it('aggregateResources uses SEED fallback and excludes disabled stands from total', () => {
        const result = {
            items: {
                'cpu-vm': {
                    stands: {
                        DEV: { qty: 2 },
                        PROD: { qty: 10 }
                    }
                }
            }
        };
        const dictionaryItems = [{
            id: 'cpu-vm',
            unit: 'vCPU',
            dashboardResource: 'CPU',
            applicableStands: ['DEV', 'PROD']
        }];

        const resources = aggregateResources(result, dictionaryItems, ['DEV'], false);

        assert.equal(resources.perStand.DEV.CPU.qty, 2);
        assert.equal(resources.perStand.PROD.CPU.qty, 10);
        assert.equal(resources.total.CPU.qty, 10);
        assert.equal(resources.total.CPU.applicable, true);
    });

    it('aggregateResources applies capacity risks but not inflation or VAT', () => {
        const result = {
            items: {
                cpu: {
                    stands: {
                        PROD: {
                            qty: 10,
                            riskBreakdown: {
                                bufferFactor: 1.2,
                                seasonalMul: 1.5,
                                scheduleMul: 2,
                                contingencyMul: 1.1,
                                inflationMul: 9,
                                vatMul: 9
                            }
                        }
                    }
                }
            }
        };
        const dictionaryItems = [{
            id: 'cpu',
            unit: 'vCPU',
            dashboardResource: 'CPU',
            applicableStands: ['PROD']
        }];

        const resources = aggregateResources(result, dictionaryItems, [], true);

        assert.equal(resources.total.CPU.qty, 10 * 1.2 * 1.5 * 2 * 1.1);
    });

    it('distributeRoundingPreservingSum keeps active stand sum equal to rounded total', () => {
        const resources = {
            total: { CPU: { qty: 2 } },
            perStand: {
                DEV: { CPU: { qty: 0.4 } },
                IFT: { CPU: { qty: 0.4 } },
                PSI: { CPU: { qty: 0.4 } },
                LOAD: { CPU: { qty: 0.4 } },
                PROD: { CPU: { qty: 0.4 } }
            }
        };

        distributeRoundingPreservingSum(resources, ['DEV', 'IFT', 'PSI', 'LOAD', 'PROD']);

        const sum = ['DEV', 'IFT', 'PSI', 'LOAD', 'PROD']
            .reduce((acc, sid) => acc + resources.perStand[sid].CPU.qty, 0);
        assert.equal(resources.total.CPU.qty, 2);
        assert.equal(sum, 2);
    });

    it('formatResourceQty returns null for empty values and integer text otherwise', () => {
        assert.equal(formatResourceQty(0, 'vCPU'), null);
        assert.equal(formatResourceQty(12.6, 'vCPU'), '13');
    });

    it('aggregateAiMetrics shows token workload for on-prem LLM without charging external token items', () => {
        const calc = makeOnPremAiCalc();
        const result = calculate(calc);

        assert.equal(result.items['llm-tokens-input-1m'].stands.PROD.qty, 0);
        assert.equal(result.items['llm-tokens-output-1m'].stands.PROD.qty, 0);

        const metrics = aggregateAiMetrics(result, calc.dictionaries.items, [], false, calc);

        assert.equal(metrics.perStand.PROD.TOKENS.qty, 750);
        assert.equal(metrics.perStand.LOAD.TOKENS.qty, 750);
        assert.equal(metrics.perStand.PSI.TOKENS.qty, 375);
        assert.equal(metrics.perStand.IFT.TOKENS.qty, 150);
        assert.equal(metrics.perStand.DEV.TOKENS.qty, 15);
        assert.equal(metrics.total.TOKENS.qty, 2040);
        assert.equal(metrics.total.TOKENS.unit, 'млн токенов');
    });

    it('aggregateAiMetrics shows RAG embedding workload for on-prem RAG', () => {
        const calc = makeOnPremAiCalc();
        const result = calculate(calc);

        assert.equal(result.items['rag-embeddings-1m'].stands.PROD.qty, 0);

        const metrics = aggregateAiMetrics(result, calc.dictionaries.items, [], false, calc);

        assert.equal(metrics.perStand.PROD.EMBEDDINGS.qty, 400);
        assert.equal(metrics.perStand.LOAD.EMBEDDINGS.qty, 400);
        assert.equal(metrics.perStand.PSI.EMBEDDINGS.qty, 200);
        assert.equal(metrics.perStand.IFT.EMBEDDINGS.qty, 80);
        assert.equal(metrics.perStand.DEV.EMBEDDINGS.qty, 8);
        assert.equal(metrics.total.EMBEDDINGS.qty, 1088);
    });
});
