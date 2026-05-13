/**
 * 12.U25: индикаторы min/next-min/max для постатейного сравнения и логика
 * сортировки строк по выбранному столбцу.
 *
 * Чистая логика — без DOM. Тестируется юнит-тестами; renderDetailTable в
 * [comparison.js](./comparison.js) использует эти функции.
 */

/* Ранг индикатора для сортировки: чем меньше — тем «лучше» в asc-порядке.
 * Ячейки без индикатора (никто не выиграл / item не в расчёте) уходят в конец. */
export const INDICATOR_RANK = Object.freeze({
    green:  0,  // min — самый дешёвый
    yellow: 1,  // следующий после минимального
    red:    2,  // max — самый дорогой
    none:   3   // нет индикатора (все равны / cell отсутствует)
});

/**
 * Вычислить индикаторы для одной строки (item × N расчётов).
 *
 * @param {Array<{ present: boolean, value: number }>} cells — по одному элементу на расчёт
 * @returns {Array<'green'|'yellow'|'red'|'none'>} — индикатор для каждой ячейки
 *
 * Алгоритм (по согласованию с пользователем):
 *   - cell.present=false (item не в расчёте) → 'none', НЕ участвует в min/max.
 *   - valid = массив всех cell.value у present=true ячеек.
 *   - valid.length < 2: все 'none' (нечего сравнивать).
 *   - uniq = [...new Set(valid)].sort((a,b) => a-b)
 *   - uniq.length === 1: все равны → все 'none' (нет проигравшего).
 *   - cell.value === min → 'green' (для всех ячеек со значением = min).
 *   - cell.value === max → 'red'   (для всех ячеек со значением = max).
 *   - cell.value === uniq[1] AND uniq.length >= 3 → 'yellow' (следующее после min).
 *   - иначе → 'none' (промежуточные значения при N≥4 без жёлтого ранга).
 *
 * Особый случай: при ровно 2 расчётах uniq.length максимум 2, поэтому
 * жёлтых не бывает (только green + red).
 */
export function computeRowIndicators(cells) {
    if (!Array.isArray(cells) || cells.length === 0) return [];

    const valid = cells.filter(c => c && c.present && Number.isFinite(c.value));
    if (valid.length < 2) return cells.map(() => 'none');

    const values = valid.map(c => c.value);
    const uniq = [...new Set(values)].sort((a, b) => a - b);
    if (uniq.length === 1) return cells.map(() => 'none');

    const min = uniq[0];
    const max = uniq[uniq.length - 1];
    const secondMin = uniq.length >= 3 ? uniq[1] : null;

    return cells.map(c => {
        if (!c || !c.present || !Number.isFinite(c.value)) return 'none';
        if (c.value === min) return 'green';
        if (c.value === max) return 'red';
        if (secondMin !== null && c.value === secondMin) return 'yellow';
        return 'none';
    });
}

/**
 * Отсортировать строки сравнения по индикатору в указанном столбце.
 *
 * @param {Array<{ indicators: string[], cells?: Array<{present, value}> }>} rows
 *        каждая строка содержит indicators (длиной N расчётов) и опционально
 *        cells (для вторичной сортировки по значению при равных рангах).
 * @param {number} columnIndex — индекс столбца (0..N-1), по которому сортируем
 * @param {'asc'|'desc'} direction — 'asc' = green→yellow→red→none,
 *                                    'desc' = red→yellow→green→none
 * @returns {Array} новый массив (исходный не мутируется)
 *
 * 12.U25-fix-4: добавлена ВТОРИЧНАЯ сортировка по `cells[columnIndex].value`
 * при равных рангах индикатора. Без неё, когда все cells в столбце одного
 * цвета (типично для «дешёвый vs дорогой» расчёт — все красные у дорогого),
 * клик ↑/↓ давал бы стабильный исходный порядок и пользователь не видел
 * никакой пересортировки. Теперь:
 *   - asc:  меньшее value первым внутри каждого ранга.
 *   - desc: большее value первым внутри каждого ранга.
 * Cells с present=false / non-finite value участвуют в сортировке как
 * «без значения» (стабильный порядок по индексу).
 */
export function sortRowsByIndicator(rows, columnIndex, direction = 'asc') {
    if (!Array.isArray(rows) || columnIndex === null || columnIndex === undefined) return rows;
    const dir = direction === 'desc' ? -1 : 1;
    const indexed = rows.map((row, i) => ({ row, i }));
    indexed.sort((a, b) => {
        const ia = a.row.indicators?.[columnIndex] || 'none';
        const ib = b.row.indicators?.[columnIndex] || 'none';
        const ra = INDICATOR_RANK[ia] ?? INDICATOR_RANK.none;
        const rb = INDICATOR_RANK[ib] ?? INDICATOR_RANK.none;
        if (ra !== rb) {
            // 'none' всегда уходит в конец независимо от direction — иначе
            // отсутствующие/равные значения смешивались бы с осмысленными.
            if (ia === 'none' && ib !== 'none') return 1;
            if (ib === 'none' && ia !== 'none') return -1;
            return (ra - rb) * dir;
        }
        // Ранги равны — вторичный сорт по значению ячейки в этом столбце.
        const va = a.row.cells?.[columnIndex];
        const vb = b.row.cells?.[columnIndex];
        const vaOk = va && va.present && Number.isFinite(va.value);
        const vbOk = vb && vb.present && Number.isFinite(vb.value);
        if (vaOk && vbOk && va.value !== vb.value) {
            return (va.value - vb.value) * dir;
        }
        return a.i - b.i;  // стабильный порядок
    });
    return indexed.map(x => x.row);
}

/**
 * Решить следующее состояние сортировки при клике на заголовок столбца.
 * Цикл: NULL → asc → desc → NULL.
 *
 * @param {{columnIndex: number|null, direction: 'asc'|'desc'}|null} current
 * @param {number} clickedColumn
 * @returns {{columnIndex: number|null, direction: 'asc'|'desc'}|null}
 */
export function nextSortState(current, clickedColumn) {
    if (!current || current.columnIndex !== clickedColumn) {
        return { columnIndex: clickedColumn, direction: 'asc' };
    }
    if (current.direction === 'asc') {
        return { columnIndex: clickedColumn, direction: 'desc' };
    }
    // current.direction === 'desc' → сброс
    return null;
}
