/**
 * Stage 8.3 — UI «Старый прайс» badge + кнопка «Пересчитать на новом прайсе».
 *
 * Source-grep тесты на:
 *   1. renderProviderUpdateRow читает ctx.isActiveCalcStale + ctx.getCurrentOverrideVersion.
 *   2. При isStale && overrideVersion рендерится provider-stale-block.
 *   3. Кнопка «Пересчитать на новом прайсе» использует класс provider-recalculate-btn.
 *   4. CSS-классы provider-stale-block / -badge / provider-recalculate-btn в forms.css.
 *   5. ctx.applyProviderOverrideToActiveCalc / ctx.isActiveCalcStale в app.js.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripCssComments, stripJsComments } from '../../_helpers/source.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUEST_SRC = fs.readFileSync(
    path.resolve(__dirname, '../../../js/ui/providerUpdateRow.js'), 'utf8'
);
const FORMS_CSS = fs.readFileSync(
    path.resolve(__dirname, '../../../css/forms.css'), 'utf8'
);
const APP_SRC = fs.readFileSync(
    path.resolve(__dirname, '../../../js/app.js'), 'utf8'
);
const PROVIDER_ACTIONS_SRC = fs.readFileSync(
    path.resolve(__dirname, '../../../js/app/providerActions.js'), 'utf8'
);

describe('Stage 8.3 providerPriceSummary.js renderProviderUpdateRow stale-block', () => {
    const stripped = stripJsComments(QUEST_SRC);

    it('читает ctx.isActiveCalcStale', () => {
        assert.match(stripped, /ctx\.isActiveCalcStale/);
    });

    it('читает ctx.getCurrentOverrideVersion', () => {
        assert.match(stripped, /ctx\.getCurrentOverrideVersion\s*\(\s*providerId\s*\)/);
    });

    it('рендерит provider-stale-block при isStale && overrideVersion', () => {
        assert.match(stripped, /['"]provider-stale-block['"]/);
        assert.match(stripped, /provider-stale-badge/);
    });

    it('кнопка использует класс provider-recalculate-btn', () => {
        assert.match(stripped, /provider-recalculate-btn/);
    });

    it('кнопка вызывает ctx.applyProviderOverrideToActiveCalc(e)', () => {
        assert.match(stripped, /ctx\.applyProviderOverrideToActiveCalc\s*\(\s*e\s*\)/);
    });

    it('badge имеет role=status и aria-live=polite', () => {
        // искать в контексте provider-stale-badge
        const fn = stripped.match(/function\s+renderProviderUpdateRow[\s\S]+?\n\}/);
        assert.ok(fn);
        assert.match(fn[0], /provider-stale-badge/);
        assert.match(fn[0], /role:\s*['"]status['"]/);
        assert.match(fn[0], /['"]aria-live['"]\s*:\s*['"]polite['"]/);
    });
});

describe('Stage 8.3 forms.css', () => {
    const stripped = stripCssComments(FORMS_CSS);

    it('содержит .provider-stale-block', () => {
        assert.match(stripped, /\.provider-stale-block\s*\{/);
    });

    it('содержит .provider-stale-badge', () => {
        assert.match(stripped, /\.provider-stale-badge\s*\{/);
    });

    it('содержит .provider-recalculate-btn', () => {
        assert.match(stripped, /\.provider-recalculate-btn\s*\{/);
    });

    it('provider-stale-block использует accent/warning подсветку через border-left', () => {
        assert.match(stripped, /\.provider-stale-block[\s\S]+?border-left:[^;]+/);
    });
});

describe('Stage 8.3 app.js: ctx.applyProviderOverrideToActiveCalc + helpers', () => {
    const stripped = stripJsComments(APP_SRC);
    const actions = stripJsComments(PROVIDER_ACTIONS_SRC);

    it('ctx.applyProviderOverrideToActiveCalc объявлен', () => {
        assert.match(stripped, /applyProviderOverrideToActiveCalc\s*\(\s*triggerEvent\s*\)/);
    });

    it('ctx.isActiveCalcStale объявлен', () => {
        assert.match(stripped, /isActiveCalcStale\s*\(\s*\)\s*\{/);
    });

    it('ctx.getCurrentOverrideVersion объявлен', () => {
        assert.match(stripped, /getCurrentOverrideVersion\s*\(\s*providerId\s*\)/);
    });

    it('обёртка через withLoadingButton + snackbar.success', () => {
        const fn = actions.match(/export function applyProviderOverrideToActiveCalcAction[\s\S]*?(?=\nexport function|$)/);
        assert.ok(fn);
        assert.match(fn[0], /withLoadingButton/);
        assert.match(fn[0], /snackbar\.success/);
    });
});
