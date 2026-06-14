/**
 * Ревью Codex (2026-06-14): подпись чипа стоимости `.pp-mchip-l` в детализации
 * Паспорта ПРОМ использовала var(--text-muted) на var(--bg-elevated). В тёмной
 * теме это ~#94a3b8 на #334155 ≈ 4.04:1 при 9px — ниже WCAG AA 4.5:1.
 *
 * Тест ДОКАЗЫВАЕТ поведение: резолвит реальный токен цвета `.pp-mchip-l` и токен
 * --bg-elevated в КАЖДОЙ теме (:root / [data-theme="light"]) и требует контраст
 * ≥ 4.5:1. Заодно фиксирует, что используется var(--text) (muted/dim не проходят).
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
const modalsCss = read('css/modals.css');

function parseColor(s) {
    const m = String(s).trim().match(/#([0-9a-fA-F]{6})/);
    assert.ok(m, 'не распознал цвет: ' + s);
    return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
}
function relLum([r, g, b]) {
    const f = x => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(fg, bg) {
    const a = relLum(fg), b = relLum(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Тело flat-блока темы (нет вложенных скобок в объявлениях токенов). */
function themeBody(re) {
    const m = baseCss.match(re);
    assert.ok(m, `не нашёл блок темы ${re}`);
    return m[1];
}
function tokenHex(body, name) {
    const m = body.match(new RegExp(name.replace(/-/g, '\\-') + '\\s*:\\s*(#[0-9a-fA-F]+)'));
    assert.ok(m, `токен ${name} не найден в теме`);
    return m[1];
}
/** Имя токена из `.pp-mchip-l { … color: var(--token); … }`. */
function ruleColorVar(selector) {
    const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = modalsCss.match(new RegExp(esc + '\\s*\\{([^}]*)\\}'));
    assert.ok(m, `не нашёл правило ${selector}`);
    const c = m[1].match(/color\s*:\s*var\((--[a-z-]+)\)/);
    assert.ok(c, `${selector} должен использовать color: var(--token)`);
    return c[1];
}

const THEMES = [
    { name: 'тёмная', re: /:root\s*\{([^}]*)\}/ },
    { name: 'светлая', re: /\[data-theme="light"\]\s*\{([^}]*)\}/ }
];

describe('.pp-mchip-l — контраст подписи чипа стоимости (WCAG AA ≥ 4.5:1)', () => {
    const colorVar = ruleColorVar('.pp-mchip-l');

    it('использует var(--text), а не --text-muted/--text-dim (они не проходят AA на --bg-elevated)', () => {
        assert.equal(colorVar, '--text');
    });

    for (const theme of THEMES) {
        it(`${theme.name} тема: контраст ${colorVar} на --bg-elevated ≥ 4.5:1`, () => {
            const body = themeBody(theme.re);
            const fg = parseColor(tokenHex(body, colorVar));
            const bg = parseColor(tokenHex(body, '--bg-elevated'));
            const ratio = contrast(fg, bg);
            assert.ok(ratio >= 4.5, `контраст ${ratio.toFixed(2)}:1 — нужно ≥ 4.5:1 (WCAG AA)`);
        });
    }
});
