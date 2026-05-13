/**
 * Минималистичные SVG-чарты: горизонтальный stacked bar, donut.
 *
 * Все суммы — в RUB; параметр `currency` удалён вместе с мультивалютностью.
 */

import { svg } from './dom.js';
import { CATEGORY_IDS, CATEGORY_LABELS, CATEGORY_COLORS } from '../utils/constants.js';
import { money, percent } from '../services/format.js';

/**
 * Горизонтальный stacked bar по категориям.
 * @param {Object<string, number>} byCategory — { HW: value, LICENSE: value, ... }
 * @param {Object} opts — { width, height }
 */
export function categoryStackedBar(byCategory, { width = 320, height = 18 } = {}) {
    const total = CATEGORY_IDS.reduce((acc, c) => acc + (byCategory[c] || 0), 0);
    const wrapper = svg('svg', {
        class: 'chart-stacked-bar',
        viewBox: `0 0 ${width} ${height}`,
        width, height,
        role: 'img',
        'aria-label': 'Распределение по категориям'
    });
    if (total <= 0) {
        wrapper.appendChild(svg('rect', {
            x: 0, y: 0, width, height,
            rx: height / 2, ry: height / 2,
            fill: 'var(--bg-elevated)'
        }));
        return wrapper;
    }
    let x = 0;
    for (const cat of CATEGORY_IDS) {
        const v = byCategory[cat] || 0;
        if (v <= 0) continue;
        const w = (v / total) * width;
        const rect = svg('rect', {
            x, y: 0, width: w, height,
            fill: CATEGORY_COLORS[cat]
        });
        const title = svg('title');
        title.textContent = `${CATEGORY_LABELS[cat]}: ${money(v)} (${percent(v / total)})`;
        rect.appendChild(title);
        wrapper.appendChild(rect);
        x += w;
    }
    return wrapper;
}

/**
 * Легенда категорий. Сортирует категории по убыванию суммы; нулевые скрывает.
 */
export function categoryLegend(byCategory) {
    const total = CATEGORY_IDS.reduce((acc, c) => acc + (byCategory[c] || 0), 0);
    const sorted = CATEGORY_IDS
        .filter(c => (byCategory[c] || 0) > 0)
        .sort((a, b) => (byCategory[b] || 0) - (byCategory[a] || 0));
    const root = document.createElement('div');
    root.className = 'chart-legend';
    for (const cat of sorted) {
        const v = byCategory[cat] || 0;
        const item = document.createElement('div');
        item.className = 'chart-legend-item';
        const dot = document.createElement('span');
        dot.className = 'chart-legend-dot';
        dot.style.background = CATEGORY_COLORS[cat];
        const lbl = document.createElement('span');
        lbl.className = 'chart-legend-label';
        lbl.textContent = CATEGORY_LABELS[cat];
        const val = document.createElement('span');
        val.className = 'chart-legend-value';
        val.textContent = `${money(v)}${total > 0 ? `  ·  ${percent(v / total)}` : ''}`;
        item.appendChild(dot); item.appendChild(lbl); item.appendChild(val);
        root.appendChild(item);
    }
    return root;
}

/**
 * Donut-чарт. Для сводной карточки.
 */
export function categoryDonut(byCategory, { size = 160, thickness = 22 } = {}) {
    const total = CATEGORY_IDS.reduce((acc, c) => acc + (byCategory[c] || 0), 0);
    const radius = (size - thickness) / 2;
    const cx = size / 2, cy = size / 2;
    const root = svg('svg', {
        class: 'chart-donut',
        viewBox: `0 0 ${size} ${size}`,
        width: size, height: size,
        role: 'img',
        'aria-label': 'Сводная диаграмма'
    });
    if (total <= 0) {
        root.appendChild(svg('circle', {
            cx, cy, r: radius,
            fill: 'none',
            stroke: 'var(--bg-elevated)',
            'stroke-width': thickness
        }));
        return root;
    }
    const circumference = 2 * Math.PI * radius;
    let offset = 0;
    // Базовый круг (пустые сектора, если что-то не покрыто)
    root.appendChild(svg('circle', {
        cx, cy, r: radius,
        fill: 'none',
        stroke: 'var(--bg-elevated)',
        'stroke-width': thickness
    }));
    for (const cat of CATEGORY_IDS) {
        const v = byCategory[cat] || 0;
        if (v <= 0) continue;
        const dash = (v / total) * circumference;
        const arc = svg('circle', {
            cx, cy, r: radius,
            fill: 'none',
            stroke: CATEGORY_COLORS[cat],
            'stroke-width': thickness,
            'stroke-dasharray': `${dash} ${circumference - dash}`,
            'stroke-dashoffset': -offset,
            transform: `rotate(-90 ${cx} ${cy})`
        });
        root.appendChild(arc);
        offset += dash;
    }
    return root;
}
