/**
 * Token-fallback ДОЛЖЕН срабатывать ТАКЖЕ когда qtyFormulas возвращает
 * не-финитное значение (NaN / Infinity), а не только когда qty ≤ 0.
 *
 * Bug repro (user-reported, v2.20.70): пользователь импортирует JSON со
 * сценарием high-AI (ai_llm_used=true, ai_hosting_mode='external_api',
 * registered=500, dau_share=0.7%, ai_users_share=75%, requests/day=30,
 * input/output токены 3000/500, heavy-модель). Калькулятор в его кэше
 * (старая версия) не инжектирует `S.aiModelTierFactor`, формула
 * llm-tokens-input-1m вычисляется как `... × undefined × ... = NaN`.
 *
 * В calculate() ДО фикса:
 *   const fallbackQty = !formulaError && Number.isFinite(formulaQty) && formulaQty <= 0
 *       ? deriveExternalLlmTokenQtyFallback(item, stand, ctx) : 0;
 *
 * `Number.isFinite(NaN) === false` → fallback НЕ запускается → rawQty = NaN
 * → overflow-guard ставит qty = 0 → в Dashboard «Объёмы AI-нагрузки», в Сводке
 * AI-метрик и в Details строках «Входящие/Исходящие токены LLM» все ячейки
 * показывают «—».
 *
 * Project lesson (CLAUDE.md §Current Project Lessons): «If `ai_llm_used` is
 * true and token workload inputs are positive, the model must produce either
 * visible token workload or an explicit on-prem operational derivation.» NaN
 * из устаревшей формулы должен лечиться тем же fallback'ом, что и явный 0.
 *
 * Fix: триггерить fallback при `formulaQty <= 0 || !Number.isFinite(formulaQty)`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { calculate } from '../../../js/domain/calculator.js';
import { buildSeedDictionaries } from '../../../js/domain/seed.js';

function buildHighAiCalc(overrides = {}) {
    const dict = buildSeedDictionaries();
    return {
        id: 'test-token-fallback-nan',
        name: 'NaN fallback contract',
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
            registered_users_total: 500,
            dau_share_of_registered_percent: 0.7,
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

describe('Token qty fallback: NaN-resilient', () => {
    it('fallback срабатывает когда qtyFormulas даёт NaN (устаревший контекст без S.aiModelTierFactor)', () => {
        const calc = buildHighAiCalc();
        // Симулируем "устаревший" контекст: подменяем формулы токенов на такие,
        // что ссылаются на несуществующий S.unknownVariable — даст NaN при
        // умножении. Это покрывает реальный кейс старого кэшированного JS,
        // где новая формула из импортированного JSON ссылается на S-переменную,
        // которой нет в старом calculator.buildContext.
        const tokenItem = calc.dictionaries.items.find(i => i.id === 'llm-tokens-input-1m');
        assert.ok(tokenItem, 'seed must have llm-tokens-input-1m');
        for (const stand of ['DEV','IFT','PSI','PROD','LOAD']) {
            // formula с * S.unknownVariable вернёт * undefined = NaN
            tokenItem.qtyFormulas[stand] = '1 * S.unknownVariable';
        }

        const result = calculate(calc);
        const tok = result.items['llm-tokens-input-1m'];

        // Контракт: ВСЕ активные стенды должны получить положительный qty через fallback,
        // несмотря на то что формула вернула NaN.
        for (const stand of ['DEV','IFT','PSI','PROD','LOAD']) {
            const cell = tok.stands[stand];
            assert.ok(cell, `stand ${stand}: cell должен существовать`);
            assert.ok(Number.isFinite(cell.qty), `stand ${stand}: qty должен быть финитным, получено ${cell.qty}`);
            assert.ok(cell.qty > 0,
                `stand ${stand}: qty должен быть > 0 (fallback rescue), получено ${cell.qty}`);
        }
        assert.ok(tok.totalMonthly > 0,
            `totalMonthly должен быть > 0, получено ${tok.totalMonthly}`);
    });

    it('output-токены тоже rescue через fallback при NaN-формуле', () => {
        const calc = buildHighAiCalc();
        const tokenItem = calc.dictionaries.items.find(i => i.id === 'llm-tokens-output-1m');
        for (const stand of ['DEV','IFT','PSI','PROD','LOAD']) {
            tokenItem.qtyFormulas[stand] = '1 * S.unknownVariable';
        }

        const result = calculate(calc);
        const tok = result.items['llm-tokens-output-1m'];
        for (const stand of ['DEV','IFT','PSI','PROD','LOAD']) {
            assert.ok(tok.stands[stand].qty > 0,
                `output qty for ${stand} должен быть > 0, получено ${tok.stands[stand].qty}`);
        }
    });

    it('положительный formula qty не подменяется fallback\'ом', () => {
        // Sanity: если формула корректно вернула положительное число, fallback не должен
        // переопределять его. Это защита от регрессии «fallback всегда выигрывает».
        const calc = buildHighAiCalc();
        const result = calculate(calc);
        const tokIn = result.items['llm-tokens-input-1m'];
        // Базовая формула на user-данных даёт PROD = ceil(...) > 0 — не должен сломаться.
        assert.ok(tokIn.stands.PROD.qty > 0, 'нормальная формула даёт PROD > 0');
    });
});
