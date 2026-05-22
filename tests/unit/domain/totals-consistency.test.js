/**
 * Cross-check тест: согласованность итогов в `result` объекте калькулятора.
 *
 * Проверяет, что:
 *   sum(stands[*].total{Daily,Monthly,Annual}) === result.total{Daily,Monthly,Annual}
 *   sum(stands[*].byCategory[cat])             === result.byCategory[cat]
 *   sum(byCategory)                            === totalMonthly
 *   totalAnnual                                === totalMonthly * 12
 *   totalDaily                                 === totalMonthly / daysPerMonth
 *
 * Запускается на трёх сценариях:
 *   1. дефолтные ответы из seed;
 *   2. ответы с включённым георезервом и пентестом (триггерят дорогие ЭК);
 *   3. нулевые / пустые ответы (ничего не выбрано).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculate, clearCalculationCache } from '../../../js/domain/calculator.js';
import { buildSeedDictionaries, defaultAnswersFrom, SEED_SETTINGS } from '../../../js/domain/seed.js';
import { STAND_IDS, CATEGORY_IDS, MONTHS_PER_YEAR, DEFAULT_DAYS_PER_MONTH } from '../../../js/utils/constants.js';

const EPS = 1e-6;

function makeCalc(answersTransform = a => a) {
    const dict = buildSeedDictionaries();
    const answers = answersTransform(defaultAnswersFrom(dict.questions)) || {};
    return {
        version: '1.0',
        id: 'consistency-test',
        name: 'Consistency',
        schemaVersion: 2,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        settings: { ...SEED_SETTINGS },
        answers,
        dictionaries: dict
    };
}

/** Построить «нулевые» ответы — все boolean = false, multiselect = [], number = 0. */
function zeroAnswers(answers) {
    const out = {};
    for (const id of Object.keys(answers)) {
        const v = answers[id];
        if (Array.isArray(v))      out[id] = [];
        else if (typeof v === 'boolean') out[id] = false;
        else if (typeof v === 'number')  out[id] = 0;
        else out[id] = v;
    }
    return out;
}

/** Включить георезерв + пентест поверх дефолтных ответов. */
function withGeoAndPentest(answers) {
    return {
        ...answers,
        georedundancy_required: true,
        pentest_external: true,
        pentest_internal: true,
        pentest_per_year: 2
    };
}

const scenarios = [
    { name: 'дефолтные ответы из seed', transform: a => a },
    { name: 'георезерв + пентест включены', transform: withGeoAndPentest },
    { name: 'нулевые ответы (все false / 0 / [])', transform: zeroAnswers }
];

describe('cross-check итогов: stands, byCategory, период', () => {
    for (const sc of scenarios) {
        it(`${sc.name}: сумма по 5 стендам == result.totalMonthly`, () => {
            clearCalculationCache();
            const calc = makeCalc(sc.transform);
            const r = calculate(calc);
            const sumStands = STAND_IDS.reduce((acc, sid) => acc + r.stands[sid].totalMonthly, 0);
            assert.ok(Math.abs(sumStands - r.totalMonthly) < EPS,
                `monthly: sum(stands)=${sumStands} != total=${r.totalMonthly}`);
        });

        it(`${sc.name}: сумма по 5 стендам == result.totalDaily и totalAnnual`, () => {
            clearCalculationCache();
            const calc = makeCalc(sc.transform);
            const r = calculate(calc);
            const sumDaily  = STAND_IDS.reduce((acc, sid) => acc + r.stands[sid].totalDaily,  0);
            const sumAnnual = STAND_IDS.reduce((acc, sid) => acc + r.stands[sid].totalAnnual, 0);
            // Допуск чуть больше из-за деления на daysPerMonth (плавающая точка).
            assert.ok(Math.abs(sumDaily  - r.totalDaily)  < 1e-4,
                `daily: sum(stands)=${sumDaily} != total=${r.totalDaily}`);
            assert.ok(Math.abs(sumAnnual - r.totalAnnual) < 1e-3,
                `annual: sum(stands)=${sumAnnual} != total=${r.totalAnnual}`);
        });

        it(`${sc.name}: byCategory по стендам в сумме == result.byCategory[cat]`, () => {
            clearCalculationCache();
            const calc = makeCalc(sc.transform);
            const r = calculate(calc);
            for (const cat of CATEGORY_IDS) {
                const sumStandsCat = STAND_IDS.reduce(
                    (acc, sid) => acc + (r.stands[sid].byCategory[cat] || 0), 0
                );
                const totalCat = r.byCategory[cat] || 0;
                assert.ok(Math.abs(sumStandsCat - totalCat) < EPS,
                    `byCategory[${cat}]: sum(stands)=${sumStandsCat} != total=${totalCat}`);
            }
        });

        it(`${sc.name}: сумма всех byCategory == totalMonthly`, () => {
            clearCalculationCache();
            const calc = makeCalc(sc.transform);
            const r = calculate(calc);
            const sumCats = Object.values(r.byCategory).reduce((a, b) => a + b, 0);
            assert.ok(Math.abs(sumCats - r.totalMonthly) < EPS,
                `sum(byCategory)=${sumCats} != totalMonthly=${r.totalMonthly}`);
        });

        it(`${sc.name}: totalAnnual == totalMonthly * 12 и totalDaily == totalMonthly / daysPerMonth`, () => {
            clearCalculationCache();
            const calc = makeCalc(sc.transform);
            const r = calculate(calc);
            const days = Number(calc.settings.daysPerMonth) || DEFAULT_DAYS_PER_MONTH;
            assert.ok(Math.abs(r.totalAnnual - r.totalMonthly * MONTHS_PER_YEAR) < EPS,
                `totalAnnual=${r.totalAnnual} != monthly*12=${r.totalMonthly * MONTHS_PER_YEAR}`);
            assert.ok(Math.abs(r.totalDaily - r.totalMonthly / days) < EPS,
                `totalDaily=${r.totalDaily} != monthly/${days}=${r.totalMonthly / days}`);
        });

        it(`${sc.name}: byCostType.capex + .opex == totalMonthly`, () => {
            clearCalculationCache();
            const calc = makeCalc(sc.transform);
            const r = calculate(calc);
            const sumCt = (r.byCostType.capex || 0) + (r.byCostType.opex || 0);
            assert.ok(Math.abs(sumCt - r.totalMonthly) < EPS,
                `sum(byCostType)=${sumCt} != totalMonthly=${r.totalMonthly}`);
        });

        it(`${sc.name}: byCostType по стендам в сумме == result.byCostType`, () => {
            clearCalculationCache();
            const calc = makeCalc(sc.transform);
            const r = calculate(calc);
            for (const ct of ['capex', 'opex']) {
                const sumStandsCt = STAND_IDS.reduce(
                    (acc, sid) => acc + (r.stands[sid].byCostType[ct] || 0), 0
                );
                const totalCt = r.byCostType[ct] || 0;
                assert.ok(Math.abs(sumStandsCt - totalCt) < EPS,
                    `byCostType[${ct}]: sum(stands)=${sumStandsCt} != total=${totalCt}`);
            }
        });
    }
});
