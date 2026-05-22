/**
 * Stage 5.B — Accent borders + scenario re-apply hint (regression linter).
 *
 * Защищает три инварианта:
 *   1. Все active tab/preset/chip элементы используют ОДИНАКОВЫЙ паттерн:
 *      1px solid var(--accent) border + accent-faint background. Никаких
 *      box-shadow ring'ов, удваивающих визуальную толщину.
 *      Покрывает: .scenario-tab.is-active, .qs-preset-card-active,
 *      .qs-geo-chip-active.
 *
 *      Исключения (intentional, НЕ под этот линтер):
 *        • .calc-card-active — primary card на «Расчётах», использует glow-shadow
 *          для выделения главной точки входа (это decorative card, не tab).
 *        • .sub-tab-active — индикатор tab-bottom (border-bottom 2px),
 *          другая семантика (вкладка, а не выделенный элемент-в-ряду).
 *
 *   2. Re-apply tooltip явно описывает scope «к активному сценарию» —
 *      пользователь не должен сомневаться, изменит ли re-apply все сценарии
 *      или только текущий.
 *
 *   3. (Документация в коде) calcController.reapplyProfile содержит комментарий
 *      про mirror-pattern и per-scenario семантику.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripCssComments, ruleBody } from '../../_helpers/source.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('Stage 5.B / Accent borders унификация для tab/preset/chip', () => {
    it('layout.css: .scenario-tab.is-active использует border-color var(--accent)', () => {
        const body = ruleBody(read('css/layout.css'), '.scenario-tab.is-active');
        assert.match(body, /border-color:\s*var\(--accent\)/,
            '.scenario-tab.is-active должен иметь border-color: var(--accent)');
    });

    it('layout.css: .scenario-tab имеет border 1px (на active меняется только color)', () => {
        const body = ruleBody(read('css/layout.css'), '.scenario-tab');
        assert.match(body, /border:\s*1px\s+solid\s+var\(--border\)/,
            '.scenario-tab базовый border должен быть 1px solid var(--border)');
    });

    it('modals.css: .qs-preset-card-active использует border-color var(--accent)', () => {
        const body = ruleBody(read('css/modals.css'), '.qs-preset-card-active');
        assert.match(body, /border-color:\s*var\(--accent\)/,
            '.qs-preset-card-active должен иметь border-color: var(--accent)');
        assert.match(body, /background:\s*var\(--accent-faint\)/,
            '.qs-preset-card-active должен иметь background: var(--accent-faint)');
    });

    it('modals.css: .qs-preset-card-active НЕ имеет box-shadow (Stage 5.2 fix — был accent ring)', () => {
        const body = ruleBody(read('css/modals.css'), '.qs-preset-card-active');
        // Унификация Stage 5.2: ring через box-shadow убран — визуальная толщина
        // должна совпадать с .scenario-tab.is-active и .qs-geo-chip-active.
        assert.doesNotMatch(body, /box-shadow:\s*0\s+0\s+0\s+1px/,
            '.qs-preset-card-active НЕ должен иметь box-shadow accent-ring (Stage 5.2 — унификация с scenario-tab)');
    });

    it('modals.css: .qs-geo-chip-active использует border-color var(--accent)', () => {
        const body = ruleBody(read('css/modals.css'), '.qs-geo-chip-active');
        assert.match(body, /border-color:\s*var\(--accent\)/,
            '.qs-geo-chip-active должен иметь border-color: var(--accent)');
        assert.match(body, /background:\s*var\(--accent-faint\)/,
            '.qs-geo-chip-active должен иметь background: var(--accent-faint)');
    });

    it('modals.css: .qs-preset-card имеет border 1px (active меняет только color/bg)', () => {
        const body = ruleBody(read('css/modals.css'), '.qs-preset-card');
        assert.match(body, /border:\s*1px\s+solid\s+var\(--border\)/,
            '.qs-preset-card базовый border должен быть 1px solid var(--border)');
    });

    it('modals.css: .qs-geo-chip имеет border 1px solid var(--border)', () => {
        const body = ruleBody(read('css/modals.css'), '.qs-geo-chip');
        assert.match(body, /border:\s*1px\s+solid\s+var\(--border\)/,
            '.qs-geo-chip базовый border должен быть 1px solid var(--border)');
    });
});

describe('Stage 5.B / Re-apply tooltip mentions «активному сценарию»', () => {
    it('dashboardProfileBanner.js: re-apply title содержит «активному сценарию» для multi-scenario', () => {
        const src = read('js/ui/dashboardProfileBanner.js');
        // Multi-scenario ветка с scenarioLabel
        assert.match(src, /к\s+активному\s+сценарию\s+«\$\{scenarioLabel\}»/,
            'дашборд должен явно описывать scope re-apply: «к активному сценарию «...»»');
    });

    it('dashboardProfileBanner.js: re-apply title содержит «Другие сценарии не изменятся»', () => {
        const src = read('js/ui/dashboardProfileBanner.js');
        assert.match(src, /Другие\s+сценарии\s+не\s+изменятся/,
            'tooltip должен явно сообщать, что re-apply через mirror НЕ затрагивает другие сценарии');
    });
});

describe('Stage 5.B / calcController.reapplyProfile mirror-pattern doc-комментарий', () => {
    it('calcController.js: reapplyProfile упоминает mirror-pattern и активный scenario', () => {
        const src = read('js/controllers/calcController.js');
        assert.match(src, /mirror-pattern/,
            'reapplyProfile должен содержать ссылку на mirror-pattern в комментарии');
        assert.match(src, /применя[юе]тся\s+ТОЛЬКО\s+к\s+активному\s+scenario|применяются\s+ТОЛЬКО\s+к\s+активному\s+scenario/,
            'reapplyProfile должен явно объяснять per-scenario семантику (Stage 4.5 комментарий)');
    });
});
