/**
 * Golden scenarios for the calculation engine.
 *
 * These tests intentionally pin exact rounded totals for representative
 * Quick Start profiles. When formulas, prices, VAT, or risk coefficients
 * change intentionally, update these snapshots together with release notes.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildSeedDictionaries, defaultAnswersFrom, SEED_SETTINGS } from '../../../js/domain/seed.js';
import { wizardToAnswers } from '../../../js/domain/wizardProfiles.js';
import { calculate, clearCalculationCache } from '../../../js/domain/calculator.js';
import { CATEGORY_IDS } from '../../../js/utils/constants.js';

const BASE_CALC_DATE = '2026-05-22T00:00:00Z';

const GOLDEN_SCENARIOS = Object.freeze([
    {
        id: 'internal_xs',
        wizard: { product_type: 'internal', industry: 'corporate', scale: 'xs', geography: 'ru', pdn: false, activity: 'low', ai_used: false },
        expected: {
            // Package 3A (OS license gate): internal/corporate не fintech/b2g → os=false,
            // OS-лицензия убрана (LICENSE 63_198 → 0; pdn=false → СЗИ нет).
            totalMonthly: 1_533_470,
            totalAnnual: 18_401_640,
            topCategory: 'SERVICES',
            byCategoryMonthly: { HW: 66_958, LICENSE: 0, TRAFFIC: 26_507, SERVICES: 1_440_005, RESERVES: 0, SECURITY: 0, AI: 0 }
        }
    },
    {
        id: 'startup_b2b_s',
        wizard: { product_type: 'b2b', industry: 'corporate', scale: 's', geography: 'ru', pdn: true, activity: 'medium', ai_used: false },
        expected: {
            // Package 3A (OS license gate): b2b/corporate не fintech/b2g → os=false,
            // OS-лицензия убрана (LICENSE 142_573 → 10_910; остаток = СЗИ при pdn).
            // Package 7A: LOAD-cap email/SMS/push → SERVICES ниже (LOAD-стенд capped до PROD).
            totalMonthly: 1_931_724,
            totalAnnual: 23_180_692,
            topCategory: 'SERVICES',
            byCategoryMonthly: { HW: 107_419, LICENSE: 10_910, TRAFFIC: 33_134, SERVICES: 1_568_156, RESERVES: 0, SECURITY: 212_105, AI: 0 }
        }
    },
    {
        id: 'smb_b2b_m',
        wizard: { product_type: 'b2b', industry: 'corporate', scale: 'm', geography: 'ru', pdn: true, activity: 'medium', ai_used: false },
        expected: {
            // Package 3A (OS license gate): b2b/corporate не fintech/b2g → os=false,
            // OS-лицензия убрана (LICENSE 233_820 → 17_893; остаток = СЗИ при pdn).
            // Package 7A: LOAD-cap email/SMS/push → SERVICES ниже (LOAD-стенд capped до PROD).
            // Package 9A: cpu-vcpu-dedicated замещает RPS-overage >100, shared не считает его повторно.
            totalMonthly: 3_275_987,
            totalAnnual: 39_311_849,
            topCategory: 'SERVICES',
            byCategoryMonthly: { HW: 351_102, LICENSE: 17_893, TRAFFIC: 106_029, SERVICES: 2_184_073, RESERVES: 0, SECURITY: 616_891, AI: 0 }
        }
    },
    {
        id: 'edtech_b2c_m_ai',
        wizard: { product_type: 'b2c', industry: 'edtech', scale: 'm', geography: 'ru', pdn: true, activity: 'high', ai_used: true },
        expected: {
            // Package 3A (OS license gate): b2c/edtech не fintech/b2g → os=false,
            // OS-лицензия убрана (LICENSE 222_414 → 17_020; остаток = СЗИ при pdn).
            // Package 7A: LOAD-cap email/SMS/push → SERVICES ниже (LOAD-стенд capped до PROD).
            totalMonthly: 30_978_929,
            totalAnnual: 371_747_147,
            topCategory: 'AI',
            byCategoryMonthly: { HW: 1_067_478, LICENSE: 17_020, TRAFFIC: 205_431, SERVICES: 3_188_923, RESERVES: 0, SECURITY: 785_419, AI: 25_714_657 }
        }
    },
    {
        id: 'consumer_b2c_l_ai_global',
        wizard: { product_type: 'b2c', industry: 'consumer', scale: 'l', geography: 'global', pdn: true, activity: 'high', ai_used: true },
        expected: {
            // Package 3A (OS license gate): b2c/consumer не fintech/b2g → os=false,
            // OS-лицензия убрана (LICENSE 564_590 → 43_205; остаток = СЗИ при pdn).
            // Package 7A: LOAD-cap email/SMS/push → SERVICES ниже (LOAD-стенд capped до PROD).
            totalMonthly: 148_841_447,
            totalAnnual: 1_786_097_360,
            topCategory: 'AI',
            byCategoryMonthly: { HW: 29_851_065, LICENSE: 43_205, TRAFFIC: 9_244_399, SERVICES: 26_981_441, RESERVES: 0, SECURITY: 1_446_108, AI: 81_275_229 }
        }
    },
    {
        id: 'fintech_b2b_m',
        wizard: { product_type: 'b2b', industry: 'fintech', scale: 'm', geography: 'ru', pdn: true, activity: 'medium', ai_used: false },
        expected: {
            // Stage 5A (DR post-pass): RESERVES пересчитаны по blended ₽/vCPU (1750/2300)
            // вместо фикс. цены за площадку → RESERVES ниже, итог ниже.
            // Package 5A (F1-A): active-active подавляет warm-георезерв →
            // RESERVES 811_534 → 789_415 (−22_119), total −22_119.
            // Package 7A: LOAD-cap email/SMS/push → SERVICES ниже (LOAD-стенд capped до PROD).
            // Package 9A: cpu-vcpu-dedicated замещает RPS-overage >100, shared не считает его повторно.
            totalMonthly: 11_210_300,
            totalAnnual: 134_523_603,
            topCategory: 'LICENSE',
            byCategoryMonthly: { HW: 842_941, LICENSE: 3_923_740, TRAFFIC: 86_149, SERVICES: 3_433_991, RESERVES: 784_570, SECURITY: 2_138_910, AI: 0 }
        }
    },
    {
        id: 'b2g_m_ru_cis',
        wizard: { product_type: 'b2g', industry: 'corporate', scale: 'm', geography: 'ru_cis', pdn: true, activity: 'medium', ai_used: false },
        expected: {
            // Stage 5A (DR post-pass): RESERVES по blended ₽/vCPU вместо фикс. цены за площадку.
            // Package 7A: LOAD-cap email/SMS/push → SERVICES ниже (LOAD-стенд capped до PROD).
            // Package 9A: cpu-vcpu-dedicated замещает RPS-overage >100, shared не считает его повторно.
            totalMonthly: 6_065_130,
            totalAnnual: 72_781_561,
            topCategory: 'SERVICES',
            byCategoryMonthly: { HW: 351_102, LICENSE: 1_846_250, TRAFFIC: 159_043, SERVICES: 2_528_503, RESERVES: 58_634, SECURITY: 1_121_598, AI: 0 }
        }
    },
    {
        id: 'enterprise_b2c_xl_ai_global',
        wizard: { product_type: 'b2c', industry: 'consumer', scale: 'xl', geography: 'global', pdn: true, activity: 'high', ai_used: true },
        expected: {
            // Package 3A (OS license gate): b2c/consumer не fintech/b2g → os=false,
            // OS-лицензия убрана (LICENSE 1_209_021 → 92_521; остаток = СЗИ при pdn).
            // Package 7A: LOAD-cap email/SMS/push → SERVICES ниже (LOAD-стенд capped до PROD); −2_001_275.
            totalMonthly: 724_822_364,
            totalAnnual: 8_697_868_372,
            topCategory: 'HW',
            byCategoryMonthly: { HW: 291_698_621, LICENSE: 92_521, TRAFFIC: 46_221_993, SERVICES: 125_781_192, RESERVES: 0, SECURITY: 5_648_622, AI: 255_379_416 }
        }
    },
    {
        id: 'regulated_b2g_fintech_xl_ai_global',
        wizard: { product_type: 'b2g', industry: 'fintech', scale: 'xl', geography: 'global', pdn: true, activity: 'high', ai_used: true },
        expected: {
            // Stage 5A (DR post-pass): RESERVES по blended ₽/vCPU вместо фикс. цены за площадку.
            // Package 5A (F1-A): active-active подавляет warm-георезерв →
            // RESERVES 2_239_812 → 1_952_261 (−287_551), total −287_552.
            // Package 7A: LOAD-cap email/SMS/push → SERVICES ниже (LOAD-стенд capped до PROD); −7_172_988.
            totalMonthly: 580_572_590,
            totalAnnual: 6_966_871_082,
            topCategory: 'AI',
            byCategoryMonthly: { HW: 53_860_258, LICENSE: 16_984_903, TRAFFIC: 6_474_392, SERVICES: 153_125_094, RESERVES: 1_952_261, SECURITY: 7_463_136, AI: 340_712_546 }
        }
    }
]);

function buildCalcFromWizard(wizard) {
    const dictionaries = buildSeedDictionaries();
    const baseAnswers = defaultAnswersFrom(dictionaries.questions);
    const { answers } = wizardToAnswers(wizard);
    return {
        id: `golden-${wizard.product_type}-${wizard.scale}`,
        name: 'golden scenario',
        version: '1.0',
        schemaVersion: 19,
        createdAt: BASE_CALC_DATE,
        updatedAt: BASE_CALC_DATE,
        settings: { ...SEED_SETTINGS },
        answers: { ...baseAnswers, ...answers },
        dictionaries
    };
}

function roundedByCategory(result) {
    return Object.fromEntries(
        CATEGORY_IDS.map(cat => [cat, Math.round(result.byCategory[cat] || 0)])
    );
}

function topCategory(result) {
    return CATEGORY_IDS
        .map(cat => [cat, result.byCategory[cat] || 0])
        .sort((a, b) => b[1] - a[1])[0][0];
}

describe('golden scenarios: Quick Start расчёты', () => {
    for (const scenario of GOLDEN_SCENARIOS) {
        it(`${scenario.id}: totals and category breakdown match snapshot`, () => {
            clearCalculationCache();
            const result = calculate(buildCalcFromWizard(scenario.wizard));

            assert.equal(Math.round(result.totalMonthly), scenario.expected.totalMonthly);
            assert.equal(Math.round(result.totalAnnual), scenario.expected.totalAnnual);
            assert.equal(topCategory(result), scenario.expected.topCategory);
            assert.deepEqual(roundedByCategory(result), scenario.expected.byCategoryMonthly);
        });
    }
});

/* Регенерация снапшотов после намеренного изменения модели:
 *   GOLDEN_REGEN=1 node tests/run.js tests/unit/domain/golden-scenarios.test.js  (строки __REGEN__) */
if (process.env.GOLDEN_REGEN) {
    for (const scenario of GOLDEN_SCENARIOS) {
        clearCalculationCache();
        const result = calculate(buildCalcFromWizard(scenario.wizard));
        const exp = {
            totalMonthly: Math.round(result.totalMonthly),
            totalAnnual: Math.round(result.totalAnnual),
            topCategory: topCategory(result),
            byCategoryMonthly: roundedByCategory(result)
        };
        console.log(`__REGEN__ ${scenario.id} ${JSON.stringify(exp)}`);
    }
}
