/**
 * Тесты унифицированного форматирования (Этап 9.5).
 *
 * Числа: разделитель тысяч — неразрывный пробел (U+00A0), десятичный — запятая.
 * Даты: «dd.mm.yyyy», время: «hh:mi», вместе: «dd.mm.yyyy hh:mi».
 *
 * NB: Intl.NumberFormat в node для ru-RU использует U+00A0 (NBSP) как разделитель
 * групп. Сравниваем через regex `\s`, чтобы не зависеть от типа пробела.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    formatNumber,
    formatRub,
    formatRubThousands,
    formatDate,
    formatTime,
    formatDateTime,
    integer,
    num
} from '../../../js/services/format.js';

describe('format.formatRubThousands', () => {
    /* 12.U25-fix-10: помимо целочисленного режима (default) поддерживает
     * fractionDigits для дневных значений, где «округление вниз» каждого
     * слагаемого ломает сумму (50 + 112 = 162, а total round'ится в 163).
     * 1 знак после запятой даёт сходящиеся числа: 50.4 + 112.3 = 162.7. */
    it('default: округление до целых тысяч', () => {
        assert.match(formatRubThousands(162727), /^163\s+тыс\.\s+₽$/);
        assert.match(formatRubThousands(50432),  /^50\s+тыс\.\s+₽$/);
        assert.match(formatRubThousands(112267), /^112\s+тыс\.\s+₽$/);
    });

    it('сумма обрезанных != округлённый total — типовая беда без fractionDigits', () => {
        // 50.43 + 112.27 = 162.7 → round = 163; но round(50.43) + round(112.27) = 50 + 112 = 162.
        const total = formatRubThousands(162727);
        const sum = (Math.round(50432 / 1000) + Math.round(112267 / 1000));
        // Подтверждение проблемы: цифры в total и сумма компонентов расходятся на 1.
        assert.match(total, /163/);
        assert.equal(sum, 162);
    });

    it('fractionDigits: 1 → 1 знак после запятой, числа сходятся', () => {
        assert.match(formatRubThousands(162727, { fractionDigits: 1 }), /^162,7\s+тыс\.\s+₽$/);
        assert.match(formatRubThousands(50432,  { fractionDigits: 1 }), /^50,4\s+тыс\.\s+₽$/);
        assert.match(formatRubThousands(112267, { fractionDigits: 1 }), /^112,3\s+тыс\.\s+₽$/);
        // Проверка: 50.4 + 112.3 = 162.7 ✓ (визуальная согласованность).
    });

    it('fractionDigits: 2', () => {
        assert.match(formatRubThousands(162727, { fractionDigits: 2 }), /^162,73\s+тыс\.\s+₽$/);
    });

    it('отрицательное число', () => {
        assert.match(formatRubThousands(-50432, { fractionDigits: 1 }), /^-50,4\s+тыс\.\s+₽$/);
    });

    it('NaN/Infinity → «—»', () => {
        assert.equal(formatRubThousands(NaN), '—');
        assert.equal(formatRubThousands(Infinity, { fractionDigits: 1 }), '—');
    });

    it('ноль', () => {
        assert.match(formatRubThousands(0), /^0\s+тыс\.\s+₽$/);
        assert.match(formatRubThousands(0, { fractionDigits: 1 }), /^0,0\s+тыс\.\s+₽$/);
    });
});

describe('format.formatNumber', () => {
    it('целое число с разделителем тысяч', () => {
        const s = formatNumber(1234567);
        // ru-RU: «1 234 567» (NBSP/обычный пробел между группами)
        assert.match(s, /^1\s234\s567$/);
    });

    it('маленькие числа без разделителя', () => {
        assert.equal(formatNumber(42), '42');
        assert.equal(formatNumber(0), '0');
    });

    it('дробное число — запятая как десятичный разделитель', () => {
        const s = formatNumber(1234.56);
        assert.match(s, /^1\s234,56$/);
    });

    it('много знаков после запятой — режется до max=3 по умолчанию', () => {
        const s = formatNumber(0.123456);
        assert.equal(s, '0,123');
    });

    it('opts.max контролирует знаки после запятой', () => {
        assert.equal(formatNumber(1.5, { max: 0 }), '2');           // округление
        assert.equal(formatNumber(1.234, { max: 1 }), '1,2');
    });

    it('opts.min дозаполняет нулями', () => {
        assert.equal(formatNumber(7, { min: 2, max: 2 }), '7,00');
    });

    it('некорректный вход → «—»', () => {
        assert.equal(formatNumber(NaN), '—');
        assert.equal(formatNumber(Infinity), '—');
        assert.equal(formatNumber(undefined), '—');
    });

    it('отрицательные числа — со знаком и группировкой', () => {
        const s = formatNumber(-1234567);
        // Знак минус может быть «-» или «−» (U+2212); пробел — обычный или NBSP.
        assert.match(s, /^[-−]1\s234\s567$/);
    });
});

describe('format.formatRub', () => {
    it('1 500 000 → содержит разделитель тысяч и знак ₽ в конце', () => {
        const s = formatRub(1500000);
        assert.match(s, /1\s500\s000/);
        assert.match(s, /₽$/);
    });

    it('100 → без разделителя', () => {
        const s = formatRub(100);
        assert.match(s, /^100\s₽$/);
    });
});

describe('format.integer', () => {
    it('всегда без дробной части и с разделителем', () => {
        assert.match(integer(1234567), /^1\s234\s567$/);
        // округление к ближайшему целому
        assert.equal(integer(1.7), '2');
    });
});

describe('format.num (обратная совместимость)', () => {
    it('по умолчанию 2 знака после запятой максимум', () => {
        assert.match(num(1234.5678), /^1\s234,57$/);
    });
});

describe('format.formatDate', () => {
    it('ISO с временем → «dd.mm.yyyy»', () => {
        // Используем дату без timezone-suffix чтобы не зависеть от пояса CI.
        const s = formatDate('2026-05-02T14:35:00');
        assert.equal(s, '02.05.2026');
    });

    it('ISO с Z (UTC) — выводится в локальном поясе', () => {
        // Здесь просто проверяем формат «dd.mm.yyyy», не конкретное число
        const s = formatDate('2026-05-02T10:30:00.000Z');
        assert.match(s, /^\d{2}\.\d{2}\.\d{4}$/);
    });

    it('Date-объект тоже принимается', () => {
        const d = new Date(2026, 0, 9, 14, 35); // 9 января 2026
        assert.equal(formatDate(d), '09.01.2026');
    });

    it('невалидный вход → пустая строка', () => {
        assert.equal(formatDate('garbage'), '');
        assert.equal(formatDate(null), '');
        assert.equal(formatDate(undefined), '');
        assert.equal(formatDate(''), '');
    });
});

describe('format.formatTime', () => {
    it('Date без timezone → «hh:mi»', () => {
        const d = new Date(2026, 4, 2, 14, 35);
        assert.equal(formatTime(d), '14:35');
    });

    it('часы и минуты дополняются нулём', () => {
        const d = new Date(2026, 4, 2, 9, 5);
        assert.equal(formatTime(d), '09:05');
    });

    it('невалидный вход → пустая строка', () => {
        assert.equal(formatTime('garbage'), '');
        assert.equal(formatTime(null), '');
    });
});

describe('format.formatDateTime', () => {
    it('Date без timezone → «dd.mm.yyyy hh:mi»', () => {
        const d = new Date(2026, 4, 2, 14, 35);
        assert.equal(formatDateTime(d), '02.05.2026 14:35');
    });

    it('ISO с Z — формат «dd.mm.yyyy hh:mi» (значения зависят от пояса)', () => {
        const s = formatDateTime('2026-05-02T10:30:00.000Z');
        assert.match(s, /^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/);
    });

    it('невалидный вход → пустая строка', () => {
        assert.equal(formatDateTime('garbage'), '');
        assert.equal(formatDateTime(null), '');
    });
});
