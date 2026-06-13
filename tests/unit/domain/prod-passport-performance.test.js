import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

import { calculate } from '../../../js/domain/calculator.js';
import { buildProdPassport } from '../../../js/domain/prodPassport.js';
import { buildSeedDictionaries, defaultAnswersFrom, SEED_SETTINGS } from '../../../js/domain/seed.js';

const PERF_BUDGET_MS = 16;

function makeCalc() {
    const dictionaries = buildSeedDictionaries();
    return {
        id: 'prod-passport-performance-test',
        name: 'Prod passport performance test',
        schemaVersion: 20,
        settings: {
            ...SEED_SETTINGS,
            applyRiskFactors: false,
            vatEnabled: true,
            vatRate: 0.22
        },
        answers: {
            ...defaultAnswersFrom(dictionaries.questions || []),
            registered_users_total: 500,
            dau_share_of_registered_percent: 0.7,
            ai_users_share: 30,
            ai_requests_per_user_day: 30,
            ai_avg_input_tokens: 3000,
            ai_avg_output_tokens: 500,
            ai_llm_used: true,
            rag_needed: true,
            rag_managed_used: false,
            rag_embeddings_million: 1,
            peak_rps: 50,
            microservices_count: 5,
            async_workers_count: 3,
            ram_per_vcpu_ratio: 4,
            cache_size_gb: 8
        },
        answersMeta: {},
        dictionaries,
        view: {}
    };
}

describe('buildProdPassport: performance guard', () => {
    it(`строит Паспорт ПРОМ по полному каталогу быстрее ${PERF_BUDGET_MS} мс`, () => {
        const calc = makeCalc();
        const result = calculate(calc);
        const build = () => buildProdPassport(calc, {
            result,
            stand: 'PROD',
            limit: Number.MAX_SAFE_INTEGER,
            topFactorsLimit: 6
        });

        for (let i = 0; i < 8; i += 1) build();

        const samples = [];
        for (let i = 0; i < 15; i += 1) {
            const start = performance.now();
            build();
            samples.push(performance.now() - start);
        }

        samples.sort((a, b) => a - b);
        const median = samples[Math.floor(samples.length / 2)];

        assert.ok(
            median < PERF_BUDGET_MS,
            `median=${median.toFixed(2)} ms, budget=${PERF_BUDGET_MS} ms`
        );
    });
});
