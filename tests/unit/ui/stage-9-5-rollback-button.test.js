/**
 * Stage 9.5 — UI кнопка «Откатить на прайс <version>» в provider-stale-block.
 *
 * Source-grep тесты на:
 *   1. renderProviderUpdateRow читает ctx.peekPreviousProviderOverride.
 *   2. provider-rollback-btn рендерится только при previousVersion.
 *   3. Кнопка вызывает ctx.rollbackProviderOverride(e, providerId).
 *   4. Tooltip с appliedAt timestamp.
 *   5. CSS .provider-rollback-btn в forms.css (ghost-style: dashed border).
 *   6. ctx.peekPreviousProviderOverride / rollbackProviderOverride объявлены в app.js.
 *   7. providerCtl: peekPreviousOverride / rollbackProvider re-export'ы.
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
const PROVIDER_CTL_SRC = fs.readFileSync(
    path.resolve(__dirname, '../../../js/controllers/providerController.js'), 'utf8'
);

describe('Stage 9.5 providerPriceSummary.js — rollback кнопка', () => {
    const stripped = stripJsComments(QUEST_SRC);

    it('UI читает ctx.peekPreviousProviderOverride', () => {
        assert.match(stripped, /ctx\.peekPreviousProviderOverride/);
    });

    it('staleBlock появляется при overrideVersion ИЛИ previousVersion', () => {
        const fn = stripped.match(/function\s+renderProviderUpdateRow[\s\S]+?\n\}/);
        assert.ok(fn);
        assert.match(fn[0], /if\s*\(\s*overrideVersion\s*\|\|\s*previousVersion\s*\)/);
    });

    it('provider-rollback-btn рендерится только при previousVersion', () => {
        assert.match(stripped, /provider-rollback-btn/);
        const fn = stripped.match(/function\s+renderProviderUpdateRow[\s\S]+?\n\}/);
        // Должно быть условие if (previousVersion)
        assert.match(fn[0], /if\s*\(\s*previousVersion\s*\)/);
    });

    it('кнопка вызывает ctx.rollbackProviderOverride(e, providerId)', () => {
        assert.match(stripped, /ctx\.rollbackProviderOverride\s*\(\s*e\s*,\s*providerId\s*\)/);
    });

    it('tooltip содержит appliedAt timestamp', () => {
        const fn = stripped.match(/function\s+renderProviderUpdateRow[\s\S]+?\n\}/);
        /* Stage 10.2: appliedAt доступен через optional chain
           `previousOverride?.appliedAt` или через локальную const
           `previousAppliedAt`. Допускаем оба варианта. */
        assert.match(fn[0], /(previousOverride\??\.appliedAt|previousAppliedAt)/);
    });

    it('rollback-btn label содержит «Откатить на прайс <ver>»', () => {
        const fn = stripped.match(/function\s+renderProviderUpdateRow[\s\S]+?\n\}/);
        assert.match(fn[0], /Откатить\s+на\s+прайс/);
    });
});

describe('Stage 9.5 forms.css', () => {
    const stripped = stripCssComments(FORMS_CSS);

    it('содержит .provider-rollback-btn', () => {
        assert.match(stripped, /\.provider-rollback-btn\s*\{/);
    });

    it('rollback-btn имеет dashed border (ghost-style)', () => {
        const block = stripped.match(/\.provider-rollback-btn\s*\{([^}]+)\}/);
        assert.ok(block);
        assert.match(block[1], /border:\s*1px\s+dashed/);
    });
});

describe('Stage 9.5 ctx + providerController bridge', () => {
    it('app.js: ctx.peekPreviousProviderOverride объявлен', () => {
        const stripped = stripJsComments(APP_SRC);
        assert.match(stripped, /peekPreviousProviderOverride\s*\(\s*providerId\s*\)/);
    });

    it('app.js: ctx.rollbackProviderOverride с withLoadingButton + snackbar', () => {
        const stripped = stripJsComments(PROVIDER_ACTIONS_SRC);
        const fn = stripped.match(/export function rollbackProviderOverrideAction[\s\S]*?(?=\nexport function|$)/);
        assert.ok(fn);
        assert.match(fn[0], /withLoadingButton/);
        assert.match(fn[0], /snackbar\.success/);
    });

    it('providerController: rollbackProvider + peekPreviousOverride re-export', () => {
        const stripped = stripJsComments(PROVIDER_CTL_SRC);
        assert.match(stripped, /export\s+function\s+rollbackProvider/);
        assert.match(stripped, /export\s+function\s+peekPreviousOverride/);
    });
});
