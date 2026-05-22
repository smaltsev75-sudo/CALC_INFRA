/**
 * Provider price summary must preserve decimal comma in Russian prices.
 *
 * Regression: a local formatter used `replace(/,/g, ' ')`, so `9 490,16`
 * became `9 490 16` in the expanded provider tariff grid.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatNumber } from '../../../js/services/format.js';
import { ruleBody } from '../../_helpers/source.js';

const ROOT = process.cwd();
const providerSrc = readFileSync(join(ROOT, 'js/ui/providerPriceSummary.js'), 'utf8');
const formsCss = readFileSync(join(ROOT, 'css/forms.css'), 'utf8');

describe('Provider price summary: decimal price formatting', () => {
    it('uses shared formatNumber and does not replace decimal comma with a space', () => {
        assert.match(providerSrc, /import\s*\{\s*formatNumber\s*\}\s*from\s*['"]\.\.\/services\/format\.js['"]/);
        assert.doesNotMatch(providerSrc, /\.replace\s*\(\s*\/,\s*\/g/);
        assert.doesNotMatch(providerSrc, /toLocaleString\s*\(\s*['"]ru-RU['"]\s*\)\s*\.replace/);
    });

    it('shared number formatter renders provider prices with decimal comma', () => {
        assert.match(formatNumber(9490.16, { min: 0, max: 2 }), /^9\s*490,16$/);
        assert.equal(formatNumber(583.61, { min: 0, max: 2 }), '583,61');
        assert.equal(formatNumber(152.46, { min: 0, max: 2 }), '152,46');
    });

    it('keeps the rendered numeric token unwrapped from its decimal part', () => {
        const body = ruleBody(formsCss, '.provider-price-row-value-num');
        assert.match(body, /white-space:\s*nowrap/);
    });
});
