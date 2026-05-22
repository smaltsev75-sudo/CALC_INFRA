/**
 * 12.U25: индикаторы min/next-min/max и сортировка по индикатору в постатейном
 * сравнении расчётов.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    computeRowIndicators,
    sortRowsByIndicator,
    nextSortState,
    INDICATOR_RANK
} from '../../../js/ui/comparisonIndicators.js';

const cells = (...vals) => vals.map(v => v === null ? { present: false, value: 0 } : { present: true, value: v });

describe('computeRowIndicators — цвета min/next-min/max', () => {
    it('2 расчёта, разные значения → green (min) + red (max), без yellow', () => {
        // 100 vs 200 → 100=green, 200=red.
        assert.deepEqual(computeRowIndicators(cells(100, 200)), ['green', 'red']);
        assert.deepEqual(computeRowIndicators(cells(200, 100)), ['red', 'green']);
    });

    it('2 расчёта, равные значения → оба none (нет проигравшего)', () => {
        assert.deepEqual(computeRowIndicators(cells(100, 100)), ['none', 'none']);
    });

    it('3 разных → green / yellow / red в порядке возрастания значений', () => {
        // 100, 200, 300 → green, yellow, red.
        assert.deepEqual(computeRowIndicators(cells(100, 200, 300)), ['green', 'yellow', 'red']);
        // 300, 100, 200 → red, green, yellow.
        assert.deepEqual(computeRowIndicators(cells(300, 100, 200)), ['red', 'green', 'yellow']);
    });

    it('4 разных {100,200,300,400} → green / yellow / none / red (yellow только для следующего после min)', () => {
        // По спецификации пользователя: green=min, yellow=uniq[1] (следующее после min), red=max.
        // 300 — промежуточное, не получает индикатор.
        assert.deepEqual(
            computeRowIndicators(cells(100, 200, 300, 400)),
            ['green', 'yellow', 'none', 'red']
        );
    });

    it('ничьи в min: {100, 100, 200, 300} → оба 100 = green, 200 = yellow, 300 = red', () => {
        assert.deepEqual(
            computeRowIndicators(cells(100, 100, 200, 300)),
            ['green', 'green', 'yellow', 'red']
        );
    });

    it('ничьи в max: {100, 200, 300, 300} → 100=green, 200=yellow, оба 300 = red', () => {
        assert.deepEqual(
            computeRowIndicators(cells(100, 200, 300, 300)),
            ['green', 'yellow', 'red', 'red']
        );
    });

    it('ничьи в next-min: {100, 200, 200, 300} → 100=green, оба 200 = yellow, 300=red', () => {
        assert.deepEqual(
            computeRowIndicators(cells(100, 200, 200, 300)),
            ['green', 'yellow', 'yellow', 'red']
        );
    });

    it('3 равных → все none (uniq=1, нет проигравшего)', () => {
        assert.deepEqual(computeRowIndicators(cells(100, 100, 100)), ['none', 'none', 'none']);
    });

    it('item отсутствует в одном расчёте (present=false) → эта ячейка = none, не входит в min/max', () => {
        // null = present:false. Среди оставшихся {100, 200} → 100=green, 200=red.
        assert.deepEqual(
            computeRowIndicators(cells(100, null, 200)),
            ['green', 'none', 'red']
        );
    });

    it('item только в одном расчёте → нечего сравнивать, все none', () => {
        assert.deepEqual(
            computeRowIndicators(cells(100, null, null)),
            ['none', 'none', 'none']
        );
    });

    it('пустой массив → пустой результат', () => {
        assert.deepEqual(computeRowIndicators([]), []);
    });

    it('сложный сценарий: 4 расчёта с двумя отсутствующими + 2 равными', () => {
        // {200, null, 200, 100} → valid = [200, 200, 100], uniq=[100,200], min=100, max=200.
        // 100=green, оба 200=red, null=none.
        assert.deepEqual(
            computeRowIndicators(cells(200, null, 200, 100)),
            ['red', 'none', 'red', 'green']
        );
    });
});

describe('sortRowsByIndicator — сортировка по индикатору в столбце', () => {
    const rows = [
        { id: 'a', indicators: ['red',    'green',  'yellow'] },
        { id: 'b', indicators: ['green',  'red',    'yellow'] },
        { id: 'c', indicators: ['yellow', 'yellow', 'green']  },
        { id: 'd', indicators: ['none',   'green',  'red']    },
    ];

    it('asc по столбцу 0: green → yellow → red → none', () => {
        const sorted = sortRowsByIndicator(rows, 0, 'asc');
        assert.deepEqual(sorted.map(r => r.id), ['b', 'c', 'a', 'd']);
    });

    it('desc по столбцу 0: red → yellow → green, none остаётся в конце', () => {
        const sorted = sortRowsByIndicator(rows, 0, 'desc');
        assert.deepEqual(sorted.map(r => r.id), ['a', 'c', 'b', 'd'],
            'none всегда в конце независимо от direction');
    });

    it('asc по столбцу 1: b(red) идёт ПОСЛЕ a/d (green) и c (yellow)', () => {
        const sorted = sortRowsByIndicator(rows, 1, 'asc');
        // green: a, d → yellow: c → red: b
        assert.deepEqual(sorted.map(r => r.id), ['a', 'd', 'c', 'b']);
    });

    it('при равных рангах БЕЗ values — стабильная сортировка по индексу', () => {
        const ties = [
            { id: 'x', indicators: ['green'] },
            { id: 'y', indicators: ['green'] },
            { id: 'z', indicators: ['green'] },
        ];
        assert.deepEqual(sortRowsByIndicator(ties, 0, 'asc').map(r => r.id), ['x', 'y', 'z']);
        assert.deepEqual(sortRowsByIndicator(ties, 0, 'desc').map(r => r.id), ['x', 'y', 'z']);
    });

    /* 12.U25-fix-4: вторичная сортировка по значению ячейки.
     *
     * Корень проблемы пользователя: когда в столбце ВСЕ ячейки одного цвета
     * (типично при «дешёвый vs дорогой» расчёт — все cells одного calc
     * = красные), сорт по индикатору даёт стабильный исходный порядок →
     * пользователь видит ↑/↓, но никакой видимой пересортировки нет.
     *
     * Решение: при равных рангах индикатора — вторичный сорт по значению ячейки
     * в этом же столбце. asc → меньшее значение первым, desc → большее первым. */

    it('вторичный сорт по value при равных рангах: asc → меньшее значение сверху', () => {
        const sameRank = [
            { id: 'big',   indicators: ['red'], cells: [{ present: true, value: 1000 }] },
            { id: 'small', indicators: ['red'], cells: [{ present: true, value: 100 }] },
            { id: 'mid',   indicators: ['red'], cells: [{ present: true, value: 500 }] },
        ];
        const sorted = sortRowsByIndicator(sameRank, 0, 'asc');
        assert.deepEqual(sorted.map(r => r.id), ['small', 'mid', 'big'],
            'все red — но внутри них asc по value сверху должно идти меньшее значение');
    });

    it('вторичный сорт по value при равных рангах: desc → большее значение сверху', () => {
        const sameRank = [
            { id: 'big',   indicators: ['red'], cells: [{ present: true, value: 1000 }] },
            { id: 'small', indicators: ['red'], cells: [{ present: true, value: 100 }] },
            { id: 'mid',   indicators: ['red'], cells: [{ present: true, value: 500 }] },
        ];
        const sorted = sortRowsByIndicator(sameRank, 0, 'desc');
        assert.deepEqual(sorted.map(r => r.id), ['big', 'mid', 'small']);
    });

    it('сценарий пользователя: все строки в столбце красные (этот расчёт дороже всегда) → сортируются по value', () => {
        // Имитация скрина: левый столбец (calc 0) везде дороже → все красные.
        // Клик ↑ на нём должен дать сортировку по возрастанию value этого столбца.
        const rows = [
            { id: 'big',  indicators: ['red'], cells: [{ present: true, value: 1580514 }] },
            { id: 'mid',  indicators: ['red'], cells: [{ present: true, value: 214546 }] },
            { id: 'tiny', indicators: ['red'], cells: [{ present: true, value: 7900 }] },
        ];
        const sorted = sortRowsByIndicator(rows, 0, 'asc');
        // tiny → mid → big (asc по value).
        assert.deepEqual(sorted.map(r => r.id), ['tiny', 'mid', 'big']);
    });

    it('combined: основная сортировка по индикатору + вторичная по value внутри ранга', () => {
        const rows = [
            { id: 'g-big',  indicators: ['green'], cells: [{ present: true, value: 999 }] },
            { id: 'r-mid',  indicators: ['red'],   cells: [{ present: true, value: 500 }] },
            { id: 'g-tiny', indicators: ['green'], cells: [{ present: true, value: 100 }] },
            { id: 'r-big',  indicators: ['red'],   cells: [{ present: true, value: 800 }] },
        ];
        const sorted = sortRowsByIndicator(rows, 0, 'asc');
        // Сначала все greens (asc по value): g-tiny=100, g-big=999.
        // Потом все reds (asc по value): r-mid=500, r-big=800.
        assert.deepEqual(sorted.map(r => r.id), ['g-tiny', 'g-big', 'r-mid', 'r-big']);
    });

    it('cells без present=true не влияют на сортировку (рассматривается как «нет значения»)', () => {
        const rows = [
            { id: 'a', indicators: ['none'], cells: [{ present: false, value: 0 }] },
            { id: 'b', indicators: ['none'], cells: [{ present: false, value: 0 }] },
        ];
        // Оба none → стабильный порядок по индексу.
        assert.deepEqual(sortRowsByIndicator(rows, 0, 'asc').map(r => r.id), ['a', 'b']);
    });

    it('null/undefined columnIndex → возвращает rows как есть', () => {
        assert.equal(sortRowsByIndicator(rows, null, 'asc'), rows);
        assert.equal(sortRowsByIndicator(rows, undefined, 'asc'), rows);
    });

    it('INDICATOR_RANK заморожен и содержит ожидаемый порядок', () => {
        assert.equal(INDICATOR_RANK.green, 0);
        assert.equal(INDICATOR_RANK.yellow, 1);
        assert.equal(INDICATOR_RANK.red, 2);
        assert.equal(INDICATOR_RANK.none, 3);
        assert.ok(Object.isFrozen(INDICATOR_RANK));
    });
});

describe('nextSortState — цикл NULL → asc → desc → NULL по клику', () => {
    it('первый клик на колонку → asc', () => {
        assert.deepEqual(nextSortState(null, 2), { columnIndex: 2, direction: 'asc' });
    });

    it('второй клик на ту же колонку → desc', () => {
        const cur = { columnIndex: 2, direction: 'asc' };
        assert.deepEqual(nextSortState(cur, 2), { columnIndex: 2, direction: 'desc' });
    });

    it('третий клик на ту же колонку → null (сброс)', () => {
        const cur = { columnIndex: 2, direction: 'desc' };
        assert.equal(nextSortState(cur, 2), null);
    });

    it('клик на ДРУГУЮ колонку → asc по новой (сбрасывает старую)', () => {
        const cur = { columnIndex: 2, direction: 'desc' };
        assert.deepEqual(nextSortState(cur, 0), { columnIndex: 0, direction: 'asc' });
    });
});
