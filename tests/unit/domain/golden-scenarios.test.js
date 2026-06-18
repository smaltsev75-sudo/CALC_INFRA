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
            totalMonthly: 1_932_356,
            totalAnnual: 23_188_276,
            topCategory: 'SERVICES',
            byCategoryMonthly: { HW: 107_419, LICENSE: 10_910, TRAFFIC: 33_134, SERVICES: 1_568_788, RESERVES: 0, SECURITY: 212_105, AI: 0 }
        }
    },
    {
        id: 'smb_b2b_m',
        wizard: { product_type: 'b2b', industry: 'corporate', scale: 'm', geography: 'ru', pdn: true, activity: 'medium', ai_used: false },
        expected: {
            // Package 3A (OS license gate): b2b/corporate не fintech/b2g → os=false,
            // OS-лицензия убрана (LICENSE 233_820 → 17_893; остаток = СЗИ при pdn).
            totalMonthly: 3_294_422,
            totalAnnual: 39_533_064,
            topCategory: 'SERVICES',
            byCategoryMonthly: { HW: 354_790, LICENSE: 17_893, TRAFFIC: 106_029, SERVICES: 2_198_819, RESERVES: 0, SECURITY: 616_891, AI: 0 }
        }
    },
    {
        id: 'edtech_b2c_m_ai',
        wizard: { product_type: 'b2c', industry: 'edtech', scale: 'm', geography: 'ru', pdn: true, activity: 'high', ai_used: true },
        expected: {
            // Package 3A (OS license gate): b2c/edtech не fintech/b2g → os=false,
            // OS-лицензия убрана (LICENSE 222_414 → 17_020; остаток = СЗИ при pdn).
            totalMonthly: 31_018_954,
            totalAnnual: 372_227_452,
            topCategory: 'AI',
            byCategoryMonthly: { HW: 1_067_478, LICENSE: 17_020, TRAFFIC: 205_431, SERVICES: 3_228_949, RESERVES: 0, SECURITY: 785_419, AI: 25_714_657 }
        }
    },
    {
        id: 'consumer_b2c_l_ai_global',
        wizard: { product_type: 'b2c', industry: 'consumer', scale: 'l', geography: 'global', pdn: true, activity: 'high', ai_used: true },
        expected: {
            // Package 3A (OS license gate): b2c/consumer не fintech/b2g → os=false,
            // OS-лицензия убрана (LICENSE 564_590 → 43_205; остаток = СЗИ при pdn).
            totalMonthly: 149_241_701,
            totalAnnual: 1_790_900_418,
            topCategory: 'AI',
            byCategoryMonthly: { HW: 29_851_065, LICENSE: 43_205, TRAFFIC: 9_244_399, SERVICES: 27_381_696, RESERVES: 0, SECURITY: 1_446_108, AI: 81_275_229 }
        }
    },
    {
        id: 'fintech_b2b_m',
        wizard: { product_type: 'b2b', industry: 'fintech', scale: 'm', geography: 'ru', pdn: true, activity: 'medium', ai_used: false },
        expected: {
            // Stage 5A (DR post-pass): RESERVES пересчитаны по blended ₽/vCPU (1750/2300)
            // вместо фикс. цены за площадку → RESERVES ниже, итог ниже.
            totalMonthly: 11_287_298,
            totalAnnual: 135_447_581,
            topCategory: 'LICENSE',
            byCategoryMonthly: { HW: 846_629, LICENSE: 3_923_740, TRAFFIC: 86_149, SERVICES: 3_480_337, RESERVES: 811_534, SECURITY: 2_138_910, AI: 0 }
        }
    },
    {
        id: 'b2g_m_ru_cis',
        wizard: { product_type: 'b2g', industry: 'corporate', scale: 'm', geography: 'ru_cis', pdn: true, activity: 'medium', ai_used: false },
        expected: {
            // Stage 5A (DR post-pass): RESERVES по blended ₽/vCPU вместо фикс. цены за площадку.
            totalMonthly: 6_106_211,
            totalAnnual: 73_274_527,
            topCategory: 'SERVICES',
            byCategoryMonthly: { HW: 354_790, LICENSE: 1_846_250, TRAFFIC: 159_043, SERVICES: 2_562_208, RESERVES: 62_320, SECURITY: 1_121_598, AI: 0 }
        }
    },
    {
        id: 'enterprise_b2c_xl_ai_global',
        wizard: { product_type: 'b2c', industry: 'consumer', scale: 'xl', geography: 'global', pdn: true, activity: 'high', ai_used: true },
        expected: {
            // Package 3A (OS license gate): b2c/consumer не fintech/b2g → os=false,
            // OS-лицензия убрана (LICENSE 1_209_021 → 92_521; остаток = СЗИ при pdn).
            totalMonthly: 726_823_639,
            totalAnnual: 8_721_883_663,
            topCategory: 'HW',
            byCategoryMonthly: { HW: 291_698_621, LICENSE: 92_521, TRAFFIC: 46_221_993, SERVICES: 127_782_466, RESERVES: 0, SECURITY: 5_648_622, AI: 255_379_416 }
        }
    },
    {
        id: 'regulated_b2g_fintech_xl_ai_global',
        wizard: { product_type: 'b2g', industry: 'fintech', scale: 'xl', geography: 'global', pdn: true, activity: 'high', ai_used: true },
        expected: {
            // Stage 5A (DR post-pass): RESERVES по blended ₽/vCPU вместо фикс. цены за площадку.
            totalMonthly: 588_033_130,
            totalAnnual: 7_056_397_560,
            topCategory: 'AI',
            byCategoryMonthly: { HW: 53_860_258, LICENSE: 16_984_903, TRAFFIC: 6_474_392, SERVICES: 160_298_082, RESERVES: 2_239_812, SECURITY: 7_463_136, AI: 340_712_546 }
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
