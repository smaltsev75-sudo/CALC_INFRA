/**
 * Smoke-тест seed-формул: каждая qty-формула во всех ЭК должна парситься
 * и вычисляться без ошибок при дефолтных ответах и SEED_SETTINGS.
 *
 * Не проверяет конкретные значения — только что нет parse-error и не-финитных
 * результатов. Страховка от случая, когда в seed попадёт формула с несовместимым
 * с парсером синтаксисом (как было с многоуровневым S.standSizeRatio.<STAND>
 * до фикса парсера).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseFormula } from '../../../js/domain/formula/parser.js';
import { evaluate } from '../../../js/domain/formula/evaluator.js';
import {
    buildSeedDictionaries,
    defaultAnswersFrom,
    SEED_SETTINGS
} from '../../../js/domain/seed.js';
import { calculate, clearCalculationCache } from '../../../js/domain/calculator.js';
import { STAND_IDS } from '../../../js/utils/constants.js';

const dict = buildSeedDictionaries();
const answers = defaultAnswersFrom(dict.questions);
const settings = { ...SEED_SETTINGS };

const questionDefaults = {};
for (const q of dict.questions) {
    if (q.defaultValue !== undefined && q.defaultValue !== null) {
        questionDefaults[q.id] = q.defaultValue;
    }
}

describe('seed-formulas: parse', () => {
    for (const item of dict.items) {
        for (const stand of STAND_IDS) {
            const src = item.qtyFormulas?.[stand];
            if (!src || src.trim() === '') continue;
            it(`${item.id} / ${stand} парсится`, () => {
                assert.doesNotThrow(
                    () => parseFormula(src),
                    `Формула ${item.id}/${stand} не парсится: ${src}`
                );
            });
        }
    }
});

describe('seed-formulas: evaluate to finite number', () => {
    for (const item of dict.items) {
        for (const stand of STAND_IDS) {
            if (!item.applicableStands.includes(stand)) continue;
            const src = item.qtyFormulas?.[stand];
            if (!src || src.trim() === '') continue;
            it(`${item.id} / ${stand} вычисляется в число ≥ 0`, () => {
                const ast = parseFormula(src);
                const ctx = {
                    Q: answers,
                    S: settings,
                    STAND: stand,
                    questionDefaults
                };
                const v = evaluate(ast, ctx);
                const num = typeof v === 'boolean' ? (v ? 1 : 0) : Number(v);
                assert.ok(Number.isFinite(num),
                    `Формула ${item.id}/${stand} вернула не-финитное: ${v}`);
                assert.ok(num >= 0,
                    `Формула ${item.id}/${stand} вернула отрицательное: ${num}`);
            });
        }
    }
});

describe('seed-formulas: end-to-end calculate()', () => {
    it('не падает на seed-данных при дефолтах', () => {
        clearCalculationCache();
        const calc = {
            version: '1.0', id: 'smoke', name: 'smoke',
            schemaVersion: 2,
            createdAt: '2026-05-02T00:00:00Z',
            updatedAt: '2026-05-02T00:00:00Z',
            settings: { ...SEED_SETTINGS },
            answers: defaultAnswersFrom(dict.questions),
            dictionaries: dict
        };
        const r = calculate(calc);
        assert.ok(Number.isFinite(r.totalMonthly), 'totalMonthly должен быть конечным');
        assert.ok(r.totalMonthly >= 0, 'totalMonthly не может быть отрицательным');
        for (const stand of STAND_IDS) {
            assert.ok(Number.isFinite(r.stands[stand].totalMonthly),
                `stands.${stand}.totalMonthly не финитный`);
        }
    });

    it('не оставляет formula errors для применимых стендов', () => {
        clearCalculationCache();
        const calc = {
            version: '1.0', id: 'smoke2', name: 'smoke2',
            schemaVersion: 2,
            createdAt: '2026-05-02T00:00:00Z',
            updatedAt: '2026-05-02T00:00:00Z',
            settings: { ...SEED_SETTINGS },
            answers: defaultAnswersFrom(dict.questions),
            dictionaries: dict
        };
        const r = calculate(calc);
        const errors = [];
        for (const item of dict.items) {
            for (const stand of STAND_IDS) {
                if (!item.applicableStands.includes(stand)) continue;
                const cell = r.items[item.id]?.stands?.[stand];
                if (cell?.error) {
                    errors.push(`${item.id}/${stand}: ${cell.error}`);
                }
            }
        }
        assert.deepEqual(errors, [],
            `Найдены ошибки в формулах:\n${errors.join('\n')}`);
    });

    it('HDD Нагрузки при ratio 120% масштабирует ту же cold-storage базу, что и ПРОМ', () => {
        clearCalculationCache();
        const calc = {
            version: '1.0', id: 'hdd-load-ratio', name: 'hdd-load-ratio',
            schemaVersion: 3,
            createdAt: '2026-05-25T00:00:00Z',
            updatedAt: '2026-05-25T00:00:00Z',
            settings: {
                ...SEED_SETTINGS,
                applyRiskFactors: false,
                vatEnabled: false,
                vatRate: 0
            },
            answers: {
                ...defaultAnswersFrom(dict.questions),
                users_total: 55000,
                db_size_initial_gb: 100,
                db_growth_gb_month: 10,
                db_count: 2,
                backup_retention_days: 90,
                file_storage_volume_tb: 5,
                file_storage_growth_tb_year: 1,
                hot_data_share_percent: 30
            },
            dictionaries: dict
        };

        const r = calculate(calc);
        const prodHdd = r.items['storage-hdd-tb'].stands.PROD.qty;
        const loadHdd = r.items['storage-hdd-tb'].stands.LOAD.qty;
        const loadRatio = calc.settings.resourceRatio.LOAD.HDD;

        assert.equal(loadRatio, 1.2);
        assert.ok(loadHdd > prodHdd,
            `LOAD HDD должен быть больше PROD при ratio 1.2: PROD=${prodHdd}, LOAD=${loadHdd}`);
        assert.ok(Math.abs(loadHdd - prodHdd * loadRatio) < 1e-9,
            `LOAD HDD должен масштабировать полную PROD-базу: expected=${prodHdd * loadRatio}, got=${loadHdd}`);
    });
});
