/**
 * Stage 5B-Sec / audit-log completeness (2026-06-18).
 *
 * Опциональная event-based модель объёма журналов аудита поверх старой «15% от БД».
 * Условия пользователя:
 *  - event-модель опциональна: audit_events_per_day<=0 → старая формула (fallback), без golden-дрейфа;
 *  - параметры: audit_events_per_day(0), audit_bytes_per_event(1000), audit_retention_years(1),
 *    audit_log_compression_ratio(5, min 1);
 *  - event-формула: ГБ = events/day × 365 × retention × bytes / compression / 1e9 × коэф.стенда;
 *  - НТ (LOAD): объём audit-log НЕ выше ПРОМ → cap min(1, standSizeRatio.LOAD) в event-ветке;
 *  - floor 1000 ГБ только в fallback; в event-ветке только технический минимум max(1 ГБ, …);
 *  - compression<1 не ломает расчёт.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSeedDictionaries, defaultAnswersFrom, SEED_ITEMS } from '../../../js/domain/seed.js';
import { calculate } from '../../../js/domain/calculator.js';
import { evaluateCalculationHealth } from '../../../js/domain/calculationHealth.js';

const ITEM = 'security-audit-log-storage-gb';

function qtyByStand(over) {
    const D = buildSeedDictionaries();
    const A = defaultAnswersFrom(D.questions);
    const calc = {
        id: 't', name: 't', schemaVersion: 12,
        answers: { ...A, audit_logging_required: true, ...over },
        answersMeta: {}, settings: { ...D.settings },
        dictionaries: D, view: { disabledStands: [] }, providerVersion: null
    };
    const r = calculate(calc, null);
    const out = { DEV: 0, IFT: 0, PSI: 0, PROD: 0, LOAD: 0 };
    for (const sid of Object.keys(r.stands)) {
        for (const x of r.stands[sid].items) if (x.itemId === ITEM) out[sid] = x.qty;
    }
    return out;
}

describe('5B audit-log: event-based модель', () => {
    it('считает объём по формуле events×365×retention×bytes/compression/1e9', () => {
        // 1e6 событий/день × 365 × 1 год × 1000 байт / 5 / 1e9 = 73 ГБ
        const q = qtyByStand({
            audit_events_per_day: 1_000_000, audit_bytes_per_event: 1000,
            audit_retention_years: 1, audit_log_compression_ratio: 5
        });
        assert.ok(Math.abs(q.PROD - 73) < 0.01, `PROD ожидался ≈73 ГБ, получено ${q.PROD}`);
        // ПСИ = 73 × ratio.PSI(0.5) = 36.5
        assert.ok(Math.abs(q.PSI - 36.5) < 0.01, `PSI ожидался ≈36.5, получено ${q.PSI}`);
    });

    it('НТ (LOAD) audit-log НЕ превышает ПРОМ (cap min(1, ratio.LOAD))', () => {
        const q = qtyByStand({
            audit_events_per_day: 1_000_000, audit_bytes_per_event: 1000,
            audit_retention_years: 1, audit_log_compression_ratio: 5
        });
        assert.ok(q.LOAD <= q.PROD, `LOAD(${q.LOAD}) не должен превышать PROD(${q.PROD})`);
    });

    it('в event-ветке НЕТ floor 1000 ГБ — малый объём даёт технический минимум 1 ГБ', () => {
        // 1000 событий/день → ~0.07 ГБ → max(1, …) = 1 ГБ (а не 1000)
        const q = qtyByStand({
            audit_events_per_day: 1000, audit_bytes_per_event: 1000,
            audit_retention_years: 1, audit_log_compression_ratio: 5
        });
        assert.equal(q.PROD, 1, `event-ветка: малый объём → 1 ГБ, получено ${q.PROD}`);
    });

    it('compression < 1 не ломает расчёт (трактуется как min 1)', () => {
        const q = qtyByStand({
            audit_events_per_day: 1000, audit_bytes_per_event: 1000,
            audit_retention_years: 1, audit_log_compression_ratio: 0.5
        });
        assert.ok(Number.isFinite(q.PROD), `PROD должен быть конечным, получено ${q.PROD}`);
        assert.ok(Number.isFinite(q.LOAD) && Number.isFinite(q.PSI));
        assert.equal(q.PROD, 1, 'compression<1 → max(1,comp)=1 → объём не раздувается');
    });
});

describe('5B audit-log: fallback сохраняет старое поведение (без golden-дрейфа)', () => {
    it('events=0 → старая формула 15% от БД с полами 1000/100', () => {
        const q = qtyByStand({
            audit_events_per_day: 0,
            db_size_initial_gb: 200, db_growth_gb_month: 10, db_count: 2
        });
        // annual=(200+120)*2=640, ×0.15=96 → PROD floor 1000, PSI floor 100, LOAD max(100,96×1.2=115.2)
        assert.equal(q.PROD, 1000);
        assert.equal(q.PSI, 100);
        assert.ok(Math.abs(q.LOAD - 115.2) < 0.01, `LOAD ожидался ≈115.2, получено ${q.LOAD}`);
    });

    it('audit_logging_required=false → 0 на всех стендах', () => {
        const D = buildSeedDictionaries();
        const A = defaultAnswersFrom(D.questions);
        const calc = {
            id: 't', name: 't', schemaVersion: 12,
            answers: { ...A, audit_logging_required: false, audit_events_per_day: 1_000_000 },
            answersMeta: {}, settings: { ...D.settings },
            dictionaries: D, view: { disabledStands: [] }, providerVersion: null
        };
        const r = calculate(calc, null);
        let total = 0;
        for (const sid of Object.keys(r.stands)) for (const x of r.stands[sid].items) if (x.itemId === ITEM) total += x.qty;
        assert.equal(total, 0);
    });
});

describe('5B audit-log: health-check грубой оценки', () => {
    function makeCalc(answers) {
        return {
            id: 't', name: 't', schemaVersion: 12,
            answers: { ...answers },
            settings: { applyRiskFactors: true },
            answersMeta: {},
            dictionaries: { questions: [], items: [], settings: {} },
            view: {}
        };
    }
    const find = (calc) => evaluateCalculationHealth(calc).findings.find(f => f.id === 'security-audit-log-rough-estimate');

    it('audit on + events=0 → info', () => {
        const f = find(makeCalc({ audit_logging_required: true, audit_events_per_day: 0 }));
        assert.ok(f, 'finding должен существовать');
        assert.equal(f.severity, 'info');
        assert.equal(f.category, 'security');
    });

    it('audit on + events>0 → нет finding (точная модель)', () => {
        const f = find(makeCalc({ audit_logging_required: true, audit_events_per_day: 5000 }));
        assert.equal(f, undefined);
    });

    it('audit off → нет finding', () => {
        const f = find(makeCalc({ audit_logging_required: false, audit_events_per_day: 0 }));
        assert.equal(f, undefined);
    });
});

describe('5B audit-log: arch-guard единиц и formulaHelp', () => {
    const item = SEED_ITEMS.find(i => i.id === ITEM);
    it('item существует, unit=ГБ, formulaHelp непустой', () => {
        assert.ok(item, 'security-audit-log-storage-gb должен быть в seed');
        assert.equal(item.unit, 'ГБ');
        assert.ok(typeof item.formulaHelp === 'string' && item.formulaHelp.length > 0);
    });
    it('формула PROD ссылается на новые event-параметры', () => {
        assert.match(item.qtyFormulas.PROD, /audit_events_per_day/);
        assert.match(item.qtyFormulas.PROD, /audit_retention_years/);
        assert.match(item.qtyFormulas.PROD, /audit_bytes_per_event/);
        assert.match(item.qtyFormulas.PROD, /audit_log_compression_ratio/);
    });
    it('LOAD-формула содержит cap min(1, ratio.LOAD)', () => {
        assert.match(item.qtyFormulas.LOAD, /min\(1,\s*S\.standSizeRatio\.LOAD\)/);
    });
});
