/**
 * UI-улучшения после ревью (2026-05-05) + sand-итерация: читабельность
 * светлой темы.
 *
 * После итерации 2 светлая тема перешла на ТЁПЛУЮ песочную (sand) палитру:
 *   - undertone тёплый коричневый (#3d2e15) вместо холодного slate (#0f172a);
 *   - bg-main #efe6cf (sand 100), bg-panel #f7eed8 (cream), bg-elevated #e6dabb;
 *   - текст #2d2520 (deep coffee), --text-muted/dim warm taupe.
 *
 * Тест защищает архитектуру светлой темы от регрессий:
 *   1. bg-panel ≠ bg-card (sidebar/topbar отделён от main-content);
 *   2. Границы достаточно заметные на тёплом фоне;
 *   3. body radial-gradient отключён (на песочном были бы грязные пятна);
 *   4. Тени плотнее, карточки имеют depth-маркер;
 *   5. Hero / dash-resources / stand-card-icon / cats-bar — overrides
 *      применены, чтобы тёмные rgba(0,0,0,...) не оставались на белом фоне.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { stripCssComments } from '../../_helpers/source.js';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const baseCss = stripCssComments(fs.readFileSync(
    path.resolve(here, '../../../css/base.css'), 'utf8'));

function lightThemeBlockBody() {
    // Берём body главного блока [data-theme="light"] { ... }
    const m = baseCss.match(/\[data-theme="light"\]\s*\{([^}]+)\}/);
    if (!m) throw new Error('не нашёл блок [data-theme="light"] {} в base.css');
    return m[1];
}

describe('Светлая тема — читабельность', () => {
    it('bg-panel в светлой теме отличается от bg-card (sidebar отделён от main)', () => {
        const body = lightThemeBlockBody();
        const panelMatch = body.match(/--bg-panel\s*:\s*(#[0-9a-fA-F]+)/);
        const cardMatch  = body.match(/--bg-card\s*:\s*(#[0-9a-fA-F]+)/);
        assert.ok(panelMatch, '--bg-panel должен быть определён в светлой теме');
        assert.ok(cardMatch,  '--bg-card должен быть определён в светлой теме');
        assert.notEqual(panelMatch[1].toLowerCase(), cardMatch[1].toLowerCase(),
            `--bg-panel (${panelMatch[1]}) и --bg-card (${cardMatch[1]}) ` +
            'должны различаться, иначе sidebar/topbar сливается с main-content');
    });

    it('границы усилены — --border имеет alpha ≥ 0.12', () => {
        const body = lightThemeBlockBody();
        const m = body.match(/--border\s*:\s*rgba\([^)]*?,\s*([0-9.]+)\s*\)/);
        assert.ok(m, '--border должен быть rgba() со светлой alpha');
        const alpha = parseFloat(m[1]);
        assert.ok(alpha >= 0.12,
            `--border alpha = ${alpha}: должна быть ≥ 0.12 для видимого контура карточек ` +
            `(на песочной теме особенно — глаз привыкает к тёплому фону, нужен чёткий контур)`);
    });

    it('границы используют тёплый undertone (warm rgba), не холодный slate', () => {
        const body = lightThemeBlockBody();
        const m = body.match(/--border\s*:\s*rgba\(\s*([0-9]+)\s*,\s*([0-9]+)\s*,\s*([0-9]+)/);
        assert.ok(m, '--border должен быть rgba()');
        const [r, g, b] = [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
        // Warm: red >= green >= blue (тёплый коричневый, не slate где b > r).
        assert.ok(r >= g && g >= b,
            `--border RGB ${r},${g},${b}: песочная тема требует тёплого undertone'а ` +
            `(R ≥ G ≥ B). Холодный slate (15, 23, 42 — где b > r) не подходит.`);
    });

    it('shadow-sm плотнее (alpha y2px ≥ 0.10)', () => {
        const body = lightThemeBlockBody();
        const m = body.match(/--shadow-sm\s*:\s*([^;]+);/);
        assert.ok(m, '--shadow-sm должен быть переопределён в светлой теме');
        const alphas = [...m[1].matchAll(/rgba\([^)]+,\s*([0-9.]+)\s*\)/g)]
            .map(am => parseFloat(am[1]));
        assert.ok(alphas.some(a => a >= 0.10),
            `--shadow-sm в светлой теме должен иметь хотя бы один alpha ≥ 0.10. ` +
            `Получили: ${alphas}`);
    });

    it('body radial-gradient отключён в светлой теме', () => {
        // [data-theme="light"] body должен иметь background-image: none
        assert.match(baseCss,
            /\[data-theme="light"\]\s+body\s*\{[^}]*background-image\s*:\s*none/,
            'body radial-gradient (зелёные/фиолетовые круги) должен быть отключён ' +
            'в светлой теме, иначе на slate-100 фоне будут видны грязные пятна');
    });

    it('app-sidebar получает заметную правую границу в светлой теме', () => {
        assert.match(baseCss,
            /\[data-theme="light"\]\s+\.app-sidebar\s*\{[^}]*border-right-color\s*:[^;]*var\(--border-light\)/,
            'sidebar в светлой теме должен иметь border-right-color: var(--border-light) ' +
            'для отделения от main-column');
    });

    it('app-topbar заменяет dark-fade-gradient на чистый bg-panel в светлой теме', () => {
        // Существующее правило в layout.css имеет hardcoded rgba(10,15,26,0.92) —
        // это тёмный hue, который на светлом фоне даёт грязно-серый эффект.
        assert.match(baseCss,
            /\[data-theme="light"\]\s+\.app-topbar\s*\{[^}]*background\s*:\s*var\(--bg-panel\)/,
            'topbar в светлой теме должен заменять gradient на чистый var(--bg-panel)');
    });

    it('Hero-карточка дашборда в светлой теме получает плоский bg-card', () => {
        assert.match(baseCss,
            /\[data-theme="light"\]\s+\.dash-card-hero\s*\{[^}]*background\s*:\s*var\(--bg-card\)/,
            'Hero в светлой теме должен использовать var(--bg-card), не linear-gradient');
    });

    it('dash-resource-row получает явный bg + border в светлой теме', () => {
        // Изначально rgba(255,255,255,0.03) — невидимо на белом.
        assert.match(baseCss,
            /\[data-theme="light"\][^{]*\.dash-resource-row\s*\{[^}]*background\s*:\s*var\(--bg-card\)/,
            'dash-resource-row в светлой теме должен иметь явный bg-card');
    });

    it('dash-stand-card-icon заменяет rgba(255,255,255,...) на bg-elevated', () => {
        assert.match(baseCss,
            /\[data-theme="light"\]\s+\.dash-stand-card-icon\s*\{[^}]*background\s*:\s*var\(--bg-elevated\)/,
            'icon-плейсхолдер должен использовать bg-elevated в светлой теме');
    });

    it('cats-bar / category-row-bar / risk-segments используют bg-elevated в светлой теме', () => {
        // Раньше bg-input #ffffff на белой карточке был невидим.
        assert.match(baseCss,
            /\[data-theme="light"\][\s\S]*?\.dash-stand-card-cats-bar[\s\S]*?background\s*:\s*var\(--bg-elevated\)/,
            'progress tracks должны использовать bg-elevated как track в светлой теме');
    });

    it('кастомный scrollbar получает thumb с тёплым undertone в светлой теме', () => {
        // Sand-палитра: thumb в тёплом коричневом rgba(61,46,21,...) вместо
        // холодного slate. Иначе scrollbar выбивается из общей warmth-palette.
        const m = baseCss.match(
            /\[data-theme="light"\]\s+::-webkit-scrollbar-thumb\s*\{[^}]*background\s*:\s*rgba\(\s*([0-9]+)\s*,\s*([0-9]+)\s*,\s*([0-9]+)\s*,\s*([0-9.]+)\s*\)/);
        assert.ok(m, 'scrollbar thumb в светлой теме должен быть rgba()');
        const [r, g, b, a] = [parseInt(m[1]), parseInt(m[2]), parseInt(m[3]), parseFloat(m[4])];
        assert.ok(r >= g && g >= b,
            `scrollbar thumb RGB ${r},${g},${b}: должен иметь тёплый undertone (R ≥ G ≥ B)`);
        assert.ok(a >= 0.15,
            `scrollbar thumb alpha = ${a}: должна быть ≥ 0.15 для видимости на песочном bg-panel`);
    });
});
