/**
 * Token-fallback ДОЛЖЕН использовать документированный defaultValue для
 * registered_users_total / dau_share_of_registered_percent, когда пользователь
 * явно включил AI (`ai_llm_used=true`) и задал положительные параметры
 * нагрузки (`ai_users_share`, `ai_requests_per_user_day`, токены входа/выхода),
 * но user-base параметры вырождены в 0.
 *
 * Bug repro (пользовательский кейс, v2.20.71):
 * Пользователь импортирует JSON со сценарием high-AI (registered=500, dau=0.7),
 * но в его localStorage у calc'а получилось вырожденное состояние:
 *   - registered_users_total = 0
 *   - dau_share_of_registered_percent = 5 (defaultValue, попало туда косвенно)
 *
 * Формула расчёта: registered × dau/100 × aiShare/100 × requests × tokens × ...
 * При registered=0 формула возвращает 0 → fallback тоже видит answers.registered=0
 * → тоже возвращает 0 → токены не отображаются в:
 *   1. Dashboard «Объёмы AI-нагрузки» (ИТОГО + per-stand)
 *   2. Details «Сводка AI-метрик» → строка «Токены»
 *   3. Details main table → AI/LLM → «Входящие/Исходящие токены LLM»
 *
 * Документированное поведение из seed.js (registered_users_total.description):
 * «Если ответ не указан («Нет информации») — расчёт пойдёт от 500 000 пользователей.»
 *
 * Fix: в `deriveExternalLlmTokenQtyFallback` при degenerate user-base
 * (registered<=0 OR dau<=0) + явный AI opt-in + положительные demand-params →
 * подставлять seed-default'ы для отсутствующих полей. Это документированный
 * safety-net против silently-zero токенов в инфраструктурной оценке.
 *
 * Project lesson (CLAUDE.md §Current Project Lessons): «If `ai_llm_used` is
 * true and token workload inputs are positive, the model must produce either
 * visible token workload or an explicit on-prem operational derivation.»
 * Degenerate registered=0 при включённом AI — silently-zero, нарушение контракта.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { calculate } from '../../../js/domain/calculator.js';
import { buildSeedDictionaries } from '../../../js/domain/seed.js';

function buildDegenerateUserBaseCalc(overrides = {}) {
    const dict = buildSeedDictionaries();
    return {
        id: 'test-token-fallback-degenerate-userbase',
        name: 'Degenerate user-base fallback contract',
        schemaVersion: 20,
        settings: {
            period: 'monthly',
            phaseDurationMonths: 12,
            kInflation: 0.1,
            kSeasonal: 0,
            kScheduleShift: 0.05,
            kContingency: 0.05,
            bufferTask: 0.1,
            bufferProject: 0.1,
            vatEnabled: true,
            vatRate: 0.22,
            planningHorizonYears: 1,
            daysPerMonth: 30,
            standSizeRatio: { DEV: 0.2, IFT: 0.4, PSI: 0.5, LOAD: 1, PROD: 1 },
            aiStandFactor:  { DEV: 0.02, IFT: 0.05, PSI: 0.1, LOAD: 1, PROD: 1 },
            applyRiskFactors: false,
            ...(overrides.settings || {})
        },
        answers: {
            ai_llm_used: true,
            ai_hosting_mode: 'external_api',
            ai_model_tier: 'heavy',
            registered_users_total: 0,
            dau_share_of_registered_percent: 5,
            ai_users_share: 75,
            ai_requests_per_user_day: 30,
            ai_avg_input_tokens: 3000,
            ai_avg_output_tokens: 500,
            ai_caching_share: 30,
            ai_agent_mode: false,
            rag_needed: false,
            ai_safety_layer: false,
            ai_finetune_needed: false,
            ...(overrides.answers || {})
        },
        dictionaries: dict,
        view: { disabledStands: [] }
    };
}

describe('Token qty fallback: degenerate user-base', () => {
    it('registered=0 + dau=5 + AI opt-in + положительные demand-params → fallback использует seed-default 500_000', () => {
        const calc = buildDegenerateUserBaseCalc();
        const result = calculate(calc);
        const tokIn = result.items['llm-tokens-input-1m'];
        assert.ok(tokIn, 'llm-tokens-input-1m должен быть в результате');
        // PROD и LOAD имеют aiStandFactor=1, должны видеть токены через fallback
        for (const stand of ['PROD', 'LOAD']) {
            assert.ok(tokIn.stands[stand].qty > 0,
                `${stand} input qty должен быть > 0 (degenerate-fallback rescue), получено ${tokIn.stands[stand].qty}`);
        }
        assert.ok(tokIn.totalMonthly > 0,
            `input totalMonthly должен быть > 0, получено ${tokIn.totalMonthly}`);
    });

    it('registered=0 + dau=5: output-токены тоже rescue через degenerate fallback', () => {
        const calc = buildDegenerateUserBaseCalc();
        const result = calculate(calc);
        const tokOut = result.items['llm-tokens-output-1m'];
        for (const stand of ['PROD', 'LOAD']) {
            assert.ok(tokOut.stands[stand].qty > 0,
                `${stand} output qty должен быть > 0, получено ${tokOut.stands[stand].qty}`);
        }
    });

    it('dau=0 + registered=500 → fallback использует seed-default dau=5', () => {
        // Симметрия: вырождение dau тоже триггерит rescue.
        const calc = buildDegenerateUserBaseCalc({
            answers: { registered_users_total: 500, dau_share_of_registered_percent: 0 }
        });
        const result = calculate(calc);
        const tokIn = result.items['llm-tokens-input-1m'];
        assert.ok(tokIn.stands.PROD.qty > 0,
            `PROD input qty при dau=0 должен быть > 0 (fallback rescue), получено ${tokIn.stands.PROD.qty}`);
    });

    it('registered=0 + AI выключен → НЕ запускаем fallback (legitимный 0)', () => {
        // Negative-test: пользователь намеренно отключил AI → токены должны быть 0,
        // fallback не должен искусственно их создавать.
        const calc = buildDegenerateUserBaseCalc({
            answers: { ai_llm_used: false }
        });
        const result = calculate(calc);
        const tokIn = result.items['llm-tokens-input-1m'];
        for (const stand of ['PROD', 'LOAD', 'DEV', 'IFT', 'PSI']) {
            assert.equal(tokIn.stands[stand].qty, 0,
                `${stand}: при ai_llm_used=false fallback не должен срабатывать, получено ${tokIn.stands[stand].qty}`);
        }
    });

    it('registered=0 + AI on + demand-params=0 → НЕ запускаем fallback (нет позитивного demand-сигнала)', () => {
        // Negative-test: AI включён формально, но все demand-params=0 → пользователь
        // не задал реальную нагрузку → не подставляем default'ы за него.
        const calc = buildDegenerateUserBaseCalc({
            answers: {
                ai_users_share: 0,
                ai_requests_per_user_day: 0,
                ai_avg_input_tokens: 0,
                ai_avg_output_tokens: 0
            }
        });
        const result = calculate(calc);
        const tokIn = result.items['llm-tokens-input-1m'];
        // ai_llm_used=true триггерит fallback, но без positive demand registered-default не нужен
        // → результат должен оставаться 0 (нет источника нагрузки).
        for (const stand of ['PROD', 'LOAD']) {
            assert.equal(tokIn.stands[stand].qty, 0,
                `${stand}: при отсутствии demand-сигнала fallback не должен подставлять defaults, получено ${tokIn.stands[stand].qty}`);
        }
    });

    it('Положительные registered+dau с положительным AI demand → fallback не подменяет реальные значения', () => {
        // Sanity / регрессия: при корректных positive answers fallback должен
        // возвращать тот же результат, что и обычная формула (без подмены на defaults).
        const calc = buildDegenerateUserBaseCalc({
            answers: { registered_users_total: 500, dau_share_of_registered_percent: 0.7 }
        });
        const result = calculate(calc);
        const tokIn = result.items['llm-tokens-input-1m'];
        // user's actual JSON values: PROD=15 input
        assert.equal(tokIn.stands.PROD.qty, 15,
            `PROD input qty при registered=500/dau=0.7 должен быть = 15 (user JSON values), получено ${tokIn.stands.PROD.qty}`);
    });
});
