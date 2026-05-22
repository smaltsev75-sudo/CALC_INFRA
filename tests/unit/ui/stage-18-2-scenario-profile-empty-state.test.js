/**
 * Stage 18.2 (v2.13.1) — Scenario Quick Start Profile UX fix.
 *
 * Source-grep тесты для двух вещей:
 *   1. dashboardProfileBanner.js → renderProfileBanner НЕ возвращает null при wizard===null:
 *      возвращает renderProfileBannerEmptyState с CTA «Задать профиль сценария».
 *   2. app.js имеет ctx-method openQuickStartForActiveScenarioProfile, который
 *      проксируется в Quick Start модалку.
 *
 * Реальный DOM-флоу покрыт ui-modules-smoke + интеграционными тестами scenarios.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripJsComments } from '../../_helpers/source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf-8');

/* ============================================================
 * 1. Dashboard profile banner — empty-state вместо null
 * ============================================================ */

describe('Stage 18.2 — renderProfileBanner empty-state', () => {
    const src = stripJsComments(read('js/ui/dashboardProfileBanner.js'));

    it('renderProfileBanner возвращает renderProfileBannerEmptyState, если wizard===null', () => {
        assert.match(src,
            /export function renderProfileBanner\s*\(calc,\s*ctx\)[\s\S]{0,200}?if\s*\(!w\)\s*return\s+renderProfileBannerEmptyState\(\s*calc,\s*ctx\s*\)/);
    });

    it('renderProfileBannerEmptyState определён в dashboardProfileBanner.js', () => {
        assert.match(src, /function renderProfileBannerEmptyState\s*\(\s*calc,\s*ctx\s*\)/);
    });

    it('Empty-state содержит подпись «Профиль сценария … не задан»', () => {
        assert.match(src, /Профиль сценария.*не задан|Профиль сценария «[^»]+» не задан/);
    });

    it('Empty-state CTA — «Задать профиль сценария»', () => {
        assert.match(src, /Задать профиль сценария/);
    });

    it('Empty-state CTA вызывает ctx.openQuickStartForActiveScenarioProfile', () => {
        assert.match(src, /ctx\.openQuickStartForActiveScenarioProfile\(\)/);
    });

    it('Empty-state имеет класс .profile-banner-empty', () => {
        assert.match(src, /profile-banner-empty\b/);
    });
});

/* ============================================================
 * 2. ctx-method exists in app.js
 * ============================================================ */

describe('Stage 18.2 — ctx.openQuickStartForActiveScenarioProfile', () => {
    const appSrc = stripJsComments(read('js/app.js'));
    const src = stripJsComments(read('js/app/quickStartActions.js'));

    it('app.js экспортирует openQuickStartForActiveScenarioProfile в ctx', () => {
        assert.match(appSrc, /openQuickStartForActiveScenarioProfile\s*\(\s*\)\s*\{/);
        assert.match(appSrc, /openQuickStartForActiveScenarioProfileAction\s*\(/);
    });

    it('method открывает quickStart с mode=edit', () => {
        const block = src.match(
            /openQuickStartForActiveScenarioProfileAction\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/
        );
        assert.ok(block, 'action body found');
        assert.match(block[1], /openModal\(\s*['"]quickStart['"]/);
        assert.match(block[1], /mode:\s*['"]edit['"]/);
    });

    it('method передаёт name из calc (для предзаполнения)', () => {
        const block = src.match(
            /openQuickStartForActiveScenarioProfileAction\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/
        );
        assert.match(block[1], /name:\s*calc\.name/);
    });
});

/* ============================================================
 * 3. openReapplyConfirm работает без wizard (для empty-state submit-flow)
 * ============================================================ */

describe('Stage 18.2 — openReapplyConfirm не блокирует null-wizard calc', () => {
    const src = stripJsComments(read('js/app/quickStartActions.js'));

    it('openReapplyConfirm НЕ имеет guard «|| !c.wizard»', () => {
        const block = src.match(
            /openReapplyConfirmAction\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/
        );
        assert.ok(block, 'action body found');
        /* Может быть guard `if (!c)`, но НЕ `if (!c || !c.wizard)`. */
        assert.ok(!/!calc\s*\|\|\s*!calc\.wizard/.test(block[1]),
            'null-wizard guard убран в Stage 18.2');
    });
});

/* ============================================================
 * 4. addScenario — inheritance contract (sanity, основные тесты в domain)
 * ============================================================ */

describe('Stage 18.2 — addScenario наследует wizard (sanity grep)', () => {
    const src = stripJsComments(read('js/domain/scenarios.js'));

    it('addScenario использует calc.wizard для наследования (не hardcoded null)', () => {
        const block = src.match(
            /export function addScenario\s*\([^)]*\)\s*\{([\s\S]*?)\n\s*\}/
        );
        assert.ok(block, 'addScenario body found');
        assert.match(block[1], /calc\?\.wizard|calc\.wizard/,
            'addScenario читает calc.wizard');
        assert.match(block[1], /JSON\.parse\(JSON\.stringify\(calc\.wizard\)\)|structuredClone\(calc\.wizard\)/,
            'wizard клонируется deep');
    });
});

/* ============================================================
 * 5. CSS — empty-state стиль присутствует
 * ============================================================ */

describe('Stage 18.2 — CSS .profile-banner-empty', () => {
    const css = readFileSync(join(ROOT, 'css/dashboard.css'), 'utf-8');

    it('содержит .profile-banner-empty rule', () => {
        assert.match(css, /^\.profile-banner-empty\b/m);
    });

    it('содержит .profile-banner-empty-title', () => {
        assert.match(css, /^\.profile-banner-empty-title\b/m);
    });

    it('содержит .profile-banner-empty-action', () => {
        assert.match(css, /^\.profile-banner-empty-action\b/m);
    });

    it('имеет print-media overrides (background reset)', () => {
        assert.match(css,
            /@media print[\s\S]{0,500}?\.profile-banner-empty\b/);
    });
});
