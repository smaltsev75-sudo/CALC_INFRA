import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    aggregateAiMetrics,
    aggregateResources,
    DASHBOARD_RESOURCE_ORDER,
    distributeRoundingPreservingSum,
    formatResourceQty
} from '../../../js/ui/dashboardAggregates.js';
import { calculate } from '../../../js/domain/calculator.js';
import { buildSeedDictionaries, defaultAnswersFrom, SEED_ITEMS } from '../../../js/domain/seed.js';
import { effectiveQtyForDisplay } from '../../../js/ui/detailsSections.js';
import { STAND_IDS } from '../../../js/utils/constants.js';

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
    it('DASHBOARD_RESOURCE_ORDER covers every resource label from seed', () => {
        const labels = [...new Set(SEED_ITEMS.map(item => item.dashboardResource).filter(Boolean))].sort();
        assert.deepEqual(labels, [...DASHBOARD_RESOURCE_ORDER].sort());
    });

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

    it('Dashboard resource qty and Details qty use the same capacity-risk semantics', () => {
        const calc = makeOnPremAiCalc({
            ai_hosting_mode: 'external_api',
            file_storage_tb: 8,
            db_size_gb: 300,
            db_growth_gb_month: 25,
            backup_retention_days: 30
        });
        calc.settings = {
            ...calc.settings,
            applyRiskFactors: true,
            bufferTask: 0.1,
            bufferProject: 0.1,
            kSeasonal: 0.15,
            kScheduleShift: 0.05,
            kContingency: 0.05
        };
        const result = calculate(calc);
        const dashboard = aggregateResources(result, calc.dictionaries.items, [], true);
        const details = {};

        for (const item of calc.dictionaries.items) {
            if (!item.dashboardResource) continue;
            for (const sid of STAND_IDS) {
                const cell = result.items[item.id]?.stands?.[sid];
                details[item.dashboardResource] = (details[item.dashboardResource] || 0)
                    + effectiveQtyForDisplay(cell, true);
            }
        }

        for (const [label, entry] of Object.entries(dashboard.total)) {
            assert.equal(
                Math.round((entry.qty || 0) * 1_000_000) / 1_000_000,
                Math.round((details[label] || 0) * 1_000_000) / 1_000_000,
                `${label}: Dashboard qty must match Details qty`
            );
        }
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

    it('distributeRoundingPreservingSum keeps fractional TB capacities visible per stand', () => {
        const resources = {
            total: { SSD: { qty: 0.36, unit: 'ТБ' } },
            perStand: {
                DEV: { SSD: { qty: 0.12, unit: 'ТБ' } },
                IFT: { SSD: { qty: 0.24, unit: 'ТБ' } },
                PSI: { SSD: { qty: 0, unit: 'ТБ' } },
                LOAD: { SSD: { qty: 0, unit: 'ТБ' } },
                PROD: { SSD: { qty: 0, unit: 'ТБ' } }
            }
        };

        distributeRoundingPreservingSum(resources, ['DEV', 'IFT', 'PSI', 'LOAD', 'PROD']);

        assert.equal(resources.perStand.DEV.SSD.qty, 0.12);
        assert.equal(resources.perStand.IFT.SSD.qty, 0.24);
        assert.equal(resources.total.SSD.qty, 0.36);
        assert.equal(formatResourceQty(resources.perStand.DEV.SSD.qty, 'ТБ'), '0,12');
    });

    it('formatResourceQty returns null for empty values and integer text otherwise', () => {
        assert.equal(formatResourceQty(0, 'vCPU'), null);
        assert.equal(formatResourceQty(12.6, 'vCPU'), '13');
        assert.equal(formatResourceQty(0.2578125, 'ТБ'), '0,26');
    });

    it('aggregateAiMetrics shows token workload for on-prem LLM without charging external token items', () => {
        const calc = makeOnPremAiCalc();
        const result = calculate(calc);

        assert.equal(result.items['llm-tokens-input-1m'].stands.PROD.qty, 0);
        assert.equal(result.items['llm-tokens-output-1m'].stands.PROD.qty, 0);

        const metrics = aggregateAiMetrics(result, calc.dictionaries.items, [], false, calc);

        assert.equal(metrics.perStand.PROD.TOKENS.qty, 825);
        assert.equal(metrics.perStand.LOAD.TOKENS.qty, 825);
        assert.equal(metrics.perStand.PSI.TOKENS.qty, 413);
        assert.equal(metrics.perStand.IFT.TOKENS.qty, 165);
        assert.equal(metrics.perStand.DEV.TOKENS.qty, 17);
        assert.equal(metrics.total.TOKENS.qty, 2245);
        assert.equal(metrics.total.TOKENS.unit, 'млн токенов');
    });

    it('aggregateAiMetrics restores TOKENS from filled answers when token item formulas are zero', () => {
        const calc = makeOnPremAiCalc({ ai_hosting_mode: 'external_api' });
        calc.dictionaries = {
            ...calc.dictionaries,
            items: calc.dictionaries.items.map(item => (
                item.dashboardAiMetric === 'TOKENS'
                    ? {
                        ...item,
                        qtyFormulas: Object.fromEntries(STAND_IDS.map(sid => [sid, '0']))
                    }
                    : item
            ))
        };
        const result = calculate(calc);
        assert.ok(result.items['llm-tokens-input-1m'].stands.PROD.qty > 0);
        assert.ok(result.items['llm-tokens-output-1m'].stands.PROD.qty > 0);
        assert.ok(result.items['llm-tokens-input-1m'].stands.PROD.costFinal > 0);
        assert.ok(result.items['llm-tokens-output-1m'].stands.PROD.costFinal > 0);

        const metrics = aggregateAiMetrics(result, calc.dictionaries.items, [], false, calc);

        assert.ok(metrics.perStand.PROD.TOKENS.qty > 0);
        assert.ok(metrics.perStand.LOAD.TOKENS.qty > 0);
        assert.ok(metrics.total.TOKENS.qty > 0);
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
