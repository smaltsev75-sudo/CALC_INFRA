import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildCalculationDiagnosticBundle } from '../../../js/app/diagnosticActions.js';
import { buildSeedDictionaries, defaultAnswersFrom, SEED_SETTINGS } from '../../../js/domain/seed.js';
import { CURRENT_SCHEMA_VERSION } from '../../../js/utils/constants.js';

function buildAiCalc() {
    const dictionaries = buildSeedDictionaries();
    return {
        id: 'diagnostic-ai',
        name: 'Diagnostic AI',
        schemaVersion: CURRENT_SCHEMA_VERSION,
        settings: { ...SEED_SETTINGS, applyRiskFactors: false },
        answers: {
            ...defaultAnswersFrom(dictionaries.questions),
            ai_llm_used: true,
            ai_hosting_mode: 'external_api',
            registered_users_total: 500,
            dau_share_of_registered_percent: 0.7,
            ai_users_share: 75,
            ai_requests_per_user_day: 30,
            ai_avg_input_tokens: 3000,
            ai_avg_output_tokens: 500,
            ai_caching_share: 30
        },
        answersMeta: {
            ai_avg_input_tokens: { source: 'manual' }
        },
        dictionaries,
        view: { disabledStands: [] }
    };
}

describe('diagnosticActions', () => {
    it('builds structured local diagnostic bundle with answers, health, AI metrics and item qty', () => {
        const bundle = buildCalculationDiagnosticBundle(buildAiCalc(), {
            now: '2026-05-26T10:00:00.000Z',
            revision: 'test-rev'
        });

        assert.equal(bundle.schema, 'calc-diagnostics-v1');
        assert.equal(bundle.generatedAt, '2026-05-26T10:00:00.000Z');
        assert.match(bundle.warning, /не отправляет/);
        assert.equal(bundle.calc.id, 'diagnostic-ai');
        assert.equal(bundle.answers.ai_llm_used, true);
        assert.equal(bundle.normalizedAnswers.ai_avg_input_tokens, 3000);
        assert.equal(bundle.answersMeta.ai_avg_input_tokens.source, 'manual');
        assert.ok(Number.isFinite(bundle.health.score));
        assert.ok(bundle.aggregateAiMetrics.total.TOKENS.qty > 0);

        const inputTokens = bundle.result.items.find(item => item.itemId === 'llm-tokens-input-1m');
        assert.ok(inputTokens);
        assert.ok(inputTokens.stands.PROD.qty > 0);
        assert.equal(typeof inputTokens.stands.PROD.costMonthly, 'number');
    });

    it('normalizes missing answers from question defaults without mutating raw answers', () => {
        const calc = buildAiCalc();
        delete calc.answers.registered_users_total;
        const bundle = buildCalculationDiagnosticBundle(calc, {
            now: '2026-05-26T10:00:00.000Z'
        });

        assert.equal(bundle.answers.registered_users_total, undefined);
        assert.ok(bundle.normalizedAnswers.registered_users_total > 0);
    });
});
