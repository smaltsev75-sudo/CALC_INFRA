/**
 * Stage VAT-1 Phase 1: vatRateTable.js — source of truth для ставок НДС РФ.
 *
 * Покрывает:
 *   - содержимое и иммутабельность VAT_RATE_HISTORY;
 *   - граничные даты (2019-01-01, 2025-12-31, 2026-01-01);
 *   - валидация входа (null, Date, невалидные строки, несуществующие даты);
 *   - getCurrentVatRate (= getVatRateForDate(new Date()));
 *   - getVatPeriodCrossings (multi-period warning, целые и дробные горизонты);
 *   - todayIso.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    VAT_RATE_HISTORY,
    getVatRateForDate,
    getCurrentVatRate,
    getVatPeriodCrossings,
    todayIso
} from '../../../js/domain/vatRateTable.js';

/* ---------- VAT_RATE_HISTORY структурные тесты ---------- */

describe('vatRateTable: VAT_RATE_HISTORY', () => {
    it('содержит исторические ставки РФ: 18%, 20%, 22%', () => {
        const rates = VAT_RATE_HISTORY.map(p => p.rate);
        assert.deepEqual(rates, [0.18, 0.20, 0.22]);
    });

    it('последний период имеет to=null (открытый интервал = действует сейчас)', () => {
        const last = VAT_RATE_HISTORY[VAT_RATE_HISTORY.length - 1];
        assert.equal(last.to, null);
        assert.equal(last.rate, 0.22);
        assert.equal(last.from, '2026-01-01');
    });

    it('периоды не перекрываются и идут хронологически', () => {
        for (let i = 0; i < VAT_RATE_HISTORY.length - 1; i++) {
            const cur = VAT_RATE_HISTORY[i];
            const next = VAT_RATE_HISTORY[i + 1];
            assert.ok(cur.to !== null, `период ${i} не должен быть открытым`);
            assert.ok(cur.to < next.from, `период ${i} (to=${cur.to}) должен заканчиваться до ${i + 1} (from=${next.from})`);
        }
    });

    it('immutable (Object.freeze на массиве и на каждом периоде)', () => {
        assert.ok(Object.isFrozen(VAT_RATE_HISTORY));
        for (const p of VAT_RATE_HISTORY) {
            assert.ok(Object.isFrozen(p));
        }
    });
});

/* ---------- getVatRateForDate ---------- */

describe('vatRateTable: getVatRateForDate — основные ставки', () => {
    it('2018-06-01 → 0.18 (середина первого периода)', () => {
        assert.equal(getVatRateForDate('2018-06-01'), 0.18);
    });

    it('2020-07-15 → 0.20 (середина второго периода)', () => {
        assert.equal(getVatRateForDate('2020-07-15'), 0.20);
    });

    it('2026-05-12 → 0.22 (середина третьего, текущего, периода)', () => {
        assert.equal(getVatRateForDate('2026-05-12'), 0.22);
    });
});

describe('vatRateTable: getVatRateForDate — границы периодов', () => {
    it('boundary: 2018-12-31 → 0.18 (последний день первого периода)', () => {
        assert.equal(getVatRateForDate('2018-12-31'), 0.18);
    });

    it('boundary: 2019-01-01 → 0.20 (первый день второго периода)', () => {
        assert.equal(getVatRateForDate('2019-01-01'), 0.20);
    });

    it('boundary: 2025-12-31 → 0.20 (последний день второго периода)', () => {
        assert.equal(getVatRateForDate('2025-12-31'), 0.20);
    });

    it('boundary: 2026-01-01 → 0.22 (первый день третьего, текущего, периода)', () => {
        assert.equal(getVatRateForDate('2026-01-01'), 0.22);
    });
});

describe('vatRateTable: getVatRateForDate — входные форматы', () => {
    it('null → null', () => {
        assert.equal(getVatRateForDate(null), null);
    });

    it('undefined → null', () => {
        assert.equal(getVatRateForDate(undefined), null);
    });

    it('Date-объект корректно принимается', () => {
        const d = new Date('2026-05-12T15:30:00Z');
        assert.equal(getVatRateForDate(d), 0.22);
    });

    it('полная ISO-строка (с временем) обрабатывается как YYYY-MM-DD', () => {
        assert.equal(getVatRateForDate('2026-04-01T10:00:00.000Z'), 0.22);
    });

    it('Date с NaN-таймстампом → null', () => {
        assert.equal(getVatRateForDate(new Date('not-a-date')), null);
    });

    it('строка не в формате ISO → null', () => {
        assert.equal(getVatRateForDate('not-a-date'), null);
        assert.equal(getVatRateForDate('01.01.2026'), null);
        assert.equal(getVatRateForDate('2026/01/01'), null);
    });

    it('синтаксически валидная, но несуществующая дата → null', () => {
        assert.equal(getVatRateForDate('2026-13-01'), null);
        assert.equal(getVatRateForDate('2026-02-30'), null);
    });

    it('число / объект / массив → null', () => {
        assert.equal(getVatRateForDate(1234), null);
        assert.equal(getVatRateForDate({}), null);
        assert.equal(getVatRateForDate([]), null);
    });
});

describe('vatRateTable: getVatRateForDate — вне диапазона справочника', () => {
    it('дата до 2004-01-01 → null', () => {
        assert.equal(getVatRateForDate('2000-01-01'), null);
        assert.equal(getVatRateForDate('1999-12-31'), null);
    });
});

/* ---------- getCurrentVatRate ---------- */

describe('vatRateTable: getCurrentVatRate', () => {
    it('сегодня (на момент запуска тестов) → 0.22 (текущая ставка РФ с 01.01.2026)', () => {
        assert.equal(getCurrentVatRate(), 0.22);
    });

    it('эквивалент getVatRateForDate(new Date())', () => {
        assert.equal(getCurrentVatRate(), getVatRateForDate(new Date()));
    });
});

/* ---------- getVatPeriodCrossings ---------- */

describe('vatRateTable: getVatPeriodCrossings — multi-period warning', () => {
    it('2025-06-01 + 2 года → 1 crossing на 2026-01-01 (20→22)', () => {
        const cs = getVatPeriodCrossings('2025-06-01', 2);
        assert.equal(cs.length, 1);
        assert.equal(cs[0].date, '2026-01-01');
        assert.equal(cs[0].from, 0.20);
        assert.equal(cs[0].to, 0.22);
    });

    it('2026-02-01 + 3 года → 0 crossings (целиком внутри текущего периода)', () => {
        const cs = getVatPeriodCrossings('2026-02-01', 3);
        assert.equal(cs.length, 0);
    });

    it('2018-06-01 + 10 лет → 2 crossings (2019-01-01 и 2026-01-01)', () => {
        const cs = getVatPeriodCrossings('2018-06-01', 10);
        assert.equal(cs.length, 2);
        assert.equal(cs[0].date, '2019-01-01');
        assert.equal(cs[0].from, 0.18);
        assert.equal(cs[0].to, 0.20);
        assert.equal(cs[1].date, '2026-01-01');
        assert.equal(cs[1].from, 0.20);
        assert.equal(cs[1].to, 0.22);
    });

    it('Дробный горизонт: 2025-08-01 + 0.5 года → пересекает 2026-01-01', () => {
        const cs = getVatPeriodCrossings('2025-08-01', 0.5);
        assert.equal(cs.length, 1);
        assert.equal(cs[0].date, '2026-01-01');
    });

    it('Дробный горизонт: 2025-12-15 + 0.1 года (~37 дней) → 1 crossing (попадает на 2026-01-21)', () => {
        const cs = getVatPeriodCrossings('2025-12-15', 0.1);
        assert.equal(cs.length, 1);
        assert.equal(cs[0].date, '2026-01-01');
    });

    it('horizonYears=0 → []', () => {
        assert.deepEqual([...getVatPeriodCrossings('2025-06-01', 0)], []);
    });

    it('horizonYears отрицательный → []', () => {
        assert.deepEqual([...getVatPeriodCrossings('2025-06-01', -1)], []);
    });

    it('horizonYears = NaN / Infinity → []', () => {
        assert.deepEqual([...getVatPeriodCrossings('2025-06-01', NaN)], []);
        assert.deepEqual([...getVatPeriodCrossings('2025-06-01', Infinity)], []);
    });

    it('Невалидная дата → []', () => {
        assert.deepEqual([...getVatPeriodCrossings('not-a-date', 5)], []);
        assert.deepEqual([...getVatPeriodCrossings(null, 5)], []);
    });

    it('Возвращает frozen-массив с frozen-элементами', () => {
        const cs = getVatPeriodCrossings('2018-06-01', 10);
        assert.ok(Object.isFrozen(cs));
        for (const c of cs) {
            assert.ok(Object.isFrozen(c));
        }
    });

    it('Граничный случай: расчёт начинается ровно в день смены ставки → нет crossing', () => {
        const cs = getVatPeriodCrossings('2026-01-01', 5);
        assert.equal(cs.length, 0);
    });

    it('Граничный случай: расчёт заканчивается ровно в день смены ставки → есть crossing', () => {
        const cs = getVatPeriodCrossings('2025-01-01', 1);
        assert.equal(cs.length, 1);
        assert.equal(cs[0].date, '2026-01-01');
    });
});

/* ---------- todayIso ---------- */

describe('vatRateTable: todayIso', () => {
    it('возвращает строку формата YYYY-MM-DD', () => {
        const iso = todayIso();
        assert.match(iso, /^\d{4}-\d{2}-\d{2}$/);
    });

    it('эквивалент new Date().toISOString().slice(0, 10)', () => {
        const fromHelper = todayIso();
        const fromDirect = new Date().toISOString().slice(0, 10);
        /* Допускаем редкий race при пересечении полуночи UTC — повторяем раз. */
        if (fromHelper !== fromDirect) {
            assert.equal(todayIso(), new Date().toISOString().slice(0, 10));
        } else {
            assert.equal(fromHelper, fromDirect);
        }
    });
});
