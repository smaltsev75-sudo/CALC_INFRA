/**
 * Stage 9.1 — Delta-pill в provider-price-summary.
 *
 * Source-grep тесты на:
 *   1. _renderDeltaPill helper в questionnaire.js.
 *   2. Использует frozenPrices (getEffectivePrices) и effective (ctx.getEffectivePricesForProvider).
 *   3. Pill имеет классы delta-pill / --up / --down.
 *   4. Tooltip с базовой ценой, текущей и %.
 *   5. aria-label расшифровывает направление (рост/снижение).
 *   6. Threshold 0.1% не показывает pill (защита от float-noise).
 *   7. CSS-классы .delta-pill / .delta-pill--up / .delta-pill--down в forms.css.
 *   8. Tabular-nums в .delta-pill.
 *   9. ctx.getEffectivePricesForProvider в app.js.
 *  10. providerCtl.resolveEffectivePricesForProvider re-export.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripCssComments, stripJsComments } from '../../_helpers/source.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUEST_SRC = fs.readFileSync(
    path.resolve(__dirname, '../../../js/ui/providerPriceSummary.js'), 'utf8'
);
const FORMS_CSS = fs.readFileSync(
    path.resolve(__dirname, '../../../css/forms.css'), 'utf8'
);
const APP_SRC = fs.readFileSync(
    path.resolve(__dirname, '../../../js/app.js'), 'utf8'
);
const PROVIDER_CTL_SRC = fs.readFileSync(
    path.resolve(__dirname, '../../../js/controllers/providerController.js'), 'utf8'
);

describe('Stage 9.1 providerPriceSummary.js _renderDeltaPill', () => {
    const stripped = stripJsComments(QUEST_SRC);

    it('_renderDeltaPill helper объявлен', () => {
        assert.match(stripped, /function\s+_renderDeltaPill\s*\(/);
    });

    it('renderProviderPriceSummary читает frozen через getEffectivePrices И effective через ctx', () => {
        const fn = stripped.match(/function\s+renderProviderPriceSummary[\s\S]+?\n\}/);
        assert.ok(fn);
        assert.match(fn[0], /const\s+frozenPrices\s*=\s*getEffectivePrices/);
        assert.match(fn[0], /ctx\.?getEffectivePricesForProvider/);
    });

    it('pill использует классы delta-pill / --up / --down', () => {
        assert.match(stripped, /['"]delta-pill['"]/);
        assert.match(stripped, /['"]delta-pill--up['"]/);
        assert.match(stripped, /['"]delta-pill--down['"]/);
    });

    it('pill имеет title с oldPrice / newPrice / %', () => {
        const fn = stripped.match(/function\s+_renderDeltaPill[\s\S]+?\n\}/);
        assert.match(fn[0], /title/);
        assert.match(fn[0], /Базовая|frozen/i);
    });

    it('pill имеет aria-label для screen-reader (без unicode-стрелок)', () => {
        const fn = stripped.match(/function\s+_renderDeltaPill[\s\S]+?\n\}/);
        assert.match(fn[0], /['"]aria-label['"]\s*:/);
    });

    it('threshold 0.1% — не показывать pill при < 0.1% разнице', () => {
        const fn = stripped.match(/function\s+_renderDeltaPill[\s\S]+?\n\}/);
        // должно быть условие типа `Math.abs(deltaPct) < 0.1` → return null
        assert.match(fn[0], /Math\.abs\s*\(\s*deltaPct\s*\)\s*<\s*0\.1/);
    });

    it('pill встроен внутрь .provider-price-row-value (рядом с числом)', () => {
        const fn = stripped.match(/function\s+renderProviderPriceSummary[\s\S]+?\n\}/);
        assert.match(fn[0], /provider-price-row-value-num/);
    });
});

describe('Stage 9.1 forms.css', () => {
    const stripped = stripCssComments(FORMS_CSS);

    it('содержит .delta-pill базовое правило', () => {
        assert.match(stripped, /\.delta-pill\s*\{/);
    });

    it('содержит .delta-pill--up и .delta-pill--down', () => {
        assert.match(stripped, /\.delta-pill--up\s*\{/);
        assert.match(stripped, /\.delta-pill--down\s*\{/);
    });

    it('.delta-pill имеет tabular-nums для выравнивания цифр', () => {
        const block = stripped.match(/\.delta-pill\s*\{([^}]+)\}/);
        assert.ok(block);
        assert.match(block[1], /tabular-nums/);
    });

    it('.delta-pill--up и --down имеют разные цвета (warning vs accent)', () => {
        assert.match(stripped, /\.delta-pill--up[\s\S]+?warning/);
        assert.match(stripped, /\.delta-pill--down[\s\S]+?accent/);
    });
});

describe('Stage 9.1 ctx + providerController bridge', () => {
    it('app.js: ctx.getEffectivePricesForProvider объявлен', () => {
        const stripped = stripJsComments(APP_SRC);
        assert.match(stripped, /getEffectivePricesForProvider\s*\(\s*providerId\s*\)/);
    });

    it('providerController.js: resolveEffectivePricesForProvider re-export', () => {
        const stripped = stripJsComments(PROVIDER_CTL_SRC);
        assert.match(stripped, /export\s+function\s+resolveEffectivePricesForProvider/);
    });
});
