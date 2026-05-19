/**
 * WCAG 2.5.5 Target Size:
 * Все основные интерактивные элементы должны иметь touch-target ≥44×44 CSS-px
 * на сенсорных устройствах (pointer: coarse) ИЛИ на mobile-viewport (≤720px).
 *
 * Линтер проверяет:
 *   1. css/base.css — определена переменная --touch-target.
 *   2. css/components.css — есть @media (pointer: coarse) с правилами для .btn / .btn-icon / .info-icon.
 *   3. css/modals.css — есть @media (pointer: coarse) с правилом для .modal-close.
 *   4. css/sidebar.css — есть @media (pointer: coarse) с правилом для .sidebar-nav-item.
 *
 * Цель: при удалении/переименовании сломанных правил тест падает с конкретным
 * указанием, какой селектор больше не покрыт touch-target требованием.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');

const baseCss       = readFileSync(join(REPO_ROOT, 'css', 'base.css'),       'utf8');
const componentsCss = readFileSync(join(REPO_ROOT, 'css', 'components.css'), 'utf8');
const modalsCss     = readFileSync(join(REPO_ROOT, 'css', 'modals.css'),     'utf8');
const sidebarCss    = readFileSync(join(REPO_ROOT, 'css', 'sidebar.css'),    'utf8');

/**
 * Извлекает body @media-блока, содержащего pointer: coarse.
 * Простая реализация — ищет вхождение и возвращает body до первой
 * закрывающей фигурной скобки на верхнем уровне @media.
 */
function getCoarsePointerBody(css) {
    const idx = css.search(/@media\s*\([^)]*pointer\s*:\s*coarse[^)]*\)(?:\s*,\s*\([^)]*\))*\s*\{/i);
    if (idx < 0) return null;
    const open = css.indexOf('{', idx);
    if (open < 0) return null;
    let depth = 1;
    for (let i = open + 1; i < css.length; i++) {
        if (css[i] === '{') depth++;
        else if (css[i] === '}') {
            depth--;
            if (depth === 0) return css.slice(open + 1, i);
        }
    }
    return null;
}

describe('A11y: touch-targets ≥44×44 (WCAG 2.5.5)', () => {

    it('css/base.css определяет --touch-target: 44px', () => {
        assert.match(baseCss, /--touch-target\s*:\s*44px/);
    });

    describe('css/components.css — @media (pointer: coarse)', () => {
        const body = getCoarsePointerBody(componentsCss);

        it('содержит @media-блок с pointer: coarse', () => {
            assert.ok(body, 'не найден @media (pointer: coarse) в components.css');
        });

        it('правило для .btn с min-height/min-width', () => {
            assert.match(body || '', /\.btn[^{]*\{[^}]*min-(?:height|width)\s*:\s*var\(--touch-target\)/s);
        });

        it('правило для .btn-icon с min-height/min-width', () => {
            assert.match(body || '', /\.btn-icon[^{]*\{[^}]*min-(?:height|width)\s*:\s*var\(--touch-target\)/s);
        });

        it('правило для .info-icon с touch-target размером', () => {
            assert.match(body || '', /\.info-icon[^{]*\{[^}]*(?:width|height)\s*:\s*var\(--touch-target\)/s);
        });
    });

    describe('css/modals.css — @media (pointer: coarse)', () => {
        const body = getCoarsePointerBody(modalsCss);

        it('содержит @media-блок с pointer: coarse', () => {
            assert.ok(body, 'не найден @media (pointer: coarse) в modals.css');
        });

        it('правило для .modal-close с touch-target размером', () => {
            assert.match(body || '', /\.modal-close[^{]*\{[^}]*(?:width|height)\s*:\s*var\(--touch-target\)/s);
        });
    });

    describe('css/sidebar.css — @media (pointer: coarse)', () => {
        const body = getCoarsePointerBody(sidebarCss);

        it('содержит @media-блок с pointer: coarse', () => {
            assert.ok(body, 'не найден @media (pointer: coarse) в sidebar.css');
        });

        it('правило для .sidebar-nav-item с min-height', () => {
            assert.match(body || '', /\.sidebar-nav-item[^{]*\{[^}]*min-height\s*:\s*var\(--touch-target\)/s);
        });
    });
});
