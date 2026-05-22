/**
 * Stage 8.5 — UI кнопка «Пересчитать все расчёты на этом прайсе» в provider-stale-block.
 *
 * Source-grep тесты на:
 *   1. renderProviderUpdateRow рендерит provider-recalculate-all-btn при overrideVersion.
 *   2. fresh-badge (provider-stale-badge--fresh) появляется когда current calc уже на новом прайсе.
 *   3. ctx.applyProviderOverrideToAllCalcs объявлен в app.js.
 *   4. CSS-классы .provider-recalculate-all-btn / .provider-stale-badge--fresh в forms.css.
 *   5. snackbar success/warning после применения (на основе errors.length).
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

describe('Stage 8.5 providerPriceSummary.js — кнопка «Пересчитать все»', () => {
    const stripped = stripJsComments(QUEST_SRC);

    it('UI рендерит provider-recalculate-all-btn', () => {
        assert.match(stripped, /provider-recalculate-all-btn/);
    });

    it('кнопка вызывает ctx.applyProviderOverrideToAllCalcs(e, providerId)', () => {
        assert.match(stripped, /ctx\.applyProviderOverrideToAllCalcs\s*\(\s*e\s*,\s*providerId\s*\)/);
    });

    it('fresh-badge (provider-stale-badge--fresh) рендерится когда не stale', () => {
        assert.match(stripped, /provider-stale-badge--fresh/);
    });

    it('staleBlock рендерится для overrideVersion (даже когда current не stale)', () => {
        const fn = stripped.match(/function\s+renderProviderUpdateRow[\s\S]+?\n\}/);
        assert.ok(fn);
        assert.match(fn[0], /if\s*\(\s*overrideVersion\s*\)/);
    });
});

describe('Stage 8.5 forms.css', () => {
    const stripped = stripCssComments(FORMS_CSS);

    it('содержит .provider-recalculate-all-btn', () => {
        assert.match(stripped, /\.provider-recalculate-all-btn\s*\{/);
    });

    it('содержит .provider-stale-badge--fresh', () => {
        assert.match(stripped, /\.provider-stale-badge--fresh\s*\{/);
    });
});

describe('Stage 8.5 app.js: ctx.applyProviderOverrideToAllCalcs', () => {
    const stripped = stripJsComments(APP_SRC);
    const actions = stripJsComments(PROVIDER_ACTIONS_SRC);

    it('ctx.applyProviderOverrideToAllCalcs объявлен', () => {
        assert.match(stripped, /applyProviderOverrideToAllCalcs\s*\(\s*triggerEvent\s*,\s*providerId\s*\)/);
    });

    it('обёртка через withLoadingButton + snackbar success/warning', () => {
        const fn = actions.match(/export function applyProviderOverrideToAllCalcsAction[\s\S]*?(?=\nexport function|$)/);
        assert.ok(fn);
        assert.match(fn[0], /withLoadingButton/);
        assert.match(fn[0], /snackbar\.success/);
        assert.match(fn[0], /snackbar\.warning/);
    });

    it('после применения вызывает refreshCalcList', () => {
        const fn = actions.match(/export function applyProviderOverrideToAllCalcsAction[\s\S]*?(?=\nexport function|$)/);
        assert.match(fn[0], /refreshCalcList/);
    });
});
