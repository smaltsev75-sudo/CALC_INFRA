/**
 * UX-ревью (2026-05-31): НДС-бейджи в светлой теме.
 *
 * Базовые правила VAT-индикаторов хардкодят sky-300 #7dd3fc (color), настроенный
 * под ТЁМНУЮ тему. На песочном --bg-card светлой темы (#faf2db) этот голубой даёт
 * контраст ~1.4:1 (замерено в браузере) — WCAG AA fail. Конвенция проекта —
 * давать [data-theme="light"]-override этой же палитре (см. .field-impact-badge--planning
 * в forms.css), ось НДС была пропущена.
 *
 * Тест ДОКАЗЫВАЕТ поведение: вычисляет реальный WCAG-контраст override-цвета каждого
 * VAT-класса против светлого --bg-card и требует ≥ 4.5:1. И защищает тёмную тему от
 * регрессии (там #7dd3fc остаётся).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { stripCssComments } from '../../_helpers/source.js';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const read = rel => stripCssComments(fs.readFileSync(path.resolve(here, '../../../', rel), 'utf8'));

const baseCss = read('css/base.css');
const componentsCss = read('css/components.css');
const dashboardCss = read('css/dashboard.css');

function parseColor(s) {
    s = s.trim();
    let m = s.match(/#([0-9a-fA-F]{6})/);
    if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
    m = s.match(/rgba?\(\s*([0-9]+)\s*,\s*([0-9]+)\s*,\s*([0-9]+)/);
    if (m) return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
    throw new Error('не распознал цвет: ' + s);
}
function relLum([r, g, b]) {
    const f = x => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(fg, bg) {
    const a = relLum(fg), b = relLum(bg);
    const hi = Math.max(a, b), lo = Math.min(a, b);
    return (hi + 0.05) / (lo + 0.05);
}
function lightBgCard() {
    const m = baseCss.match(/\[data-theme="light"\]\s*\{([^}]+)\}/);
    assert.ok(m, 'не нашёл блок [data-theme="light"] {} в base.css');
    const c = m[1].match(/--bg-card\s*:\s*(#[0-9a-fA-F]+)/);
    assert.ok(c, '--bg-card должен быть определён в светлой теме');
    return parseColor(c[1]);
}
/** Тело правила `[data-theme="light"] <selector> { ... }` (с балансировкой одного уровня). */
function lightOverrideBody(css, selector) {
    const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('\\[data-theme="light"\\]\\s+' + esc + '\\s*\\{([^}]+)\\}');
    const m = css.match(re);
    return m ? m[1] : null;
}
function colorOf(body) {
    const m = body && body.match(/(?:^|[;{\s])color\s*:\s*([^;]+);/);
    return m ? parseColor(m[1]) : null;
}

const VAT_CLASSES = [
    { sel: '.calc-card-chip-vat', css: componentsCss, where: 'components.css (карточка расчёта)' },
    { sel: '.vat-badge-on', css: dashboardCss, where: 'dashboard.css (стенд-карточка / Hero бейдж)' },
    { sel: '.vat-breakdown-amount', css: dashboardCss, where: 'dashboard.css (сумма НДС под Hero)' },
    { sel: '.dash-hero-breakdown-row-vat .dash-hero-breakdown-value', css: dashboardCss, where: 'dashboard.css (строка НДС в Hero)' },
];

describe('НДС-бейджи — контраст в светлой теме (WCAG AA ≥ 4.5:1)', () => {
    const bg = lightBgCard();

    for (const { sel, css, where } of VAT_CLASSES) {
        it(`${sel} имеет [data-theme="light"]-override с контрастом ≥ 4.5:1`, () => {
            const body = lightOverrideBody(css, sel);
            assert.ok(body, `Нет [data-theme="light"] ${sel} { ... } в ${where} — голубой #7dd3fc остаётся нечитаемым на песочном фоне`);
            const fg = colorOf(body);
            assert.ok(fg, `В override ${sel} нет color: ...`);
            const ratio = contrast(fg, bg);
            assert.ok(ratio >= 4.5,
                `${sel}: контраст ${ratio.toFixed(2)}:1 на светлом --bg-card — нужно ≥ 4.5:1 (WCAG AA)`);
        });
    }

    it('тёмная тема не затронута — базовые VAT-правила сохраняют #7dd3fc', () => {
        assert.match(componentsCss, /\.calc-card-chip-vat\s*\{[^}]*color\s*:\s*#7dd3fc/,
            '.calc-card-chip-vat в тёмной теме должен сохранять #7dd3fc');
        assert.match(dashboardCss, /\.vat-badge-on\s*\{[^}]*color\s*:\s*#7dd3fc/,
            '.vat-badge-on в тёмной теме должен сохранять #7dd3fc');
    });
});
