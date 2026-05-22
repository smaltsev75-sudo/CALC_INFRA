/**
 * PATCH 2.20.27 — desktop viewport guard for Dashboard.
 *
 * GitHub Linux Chromium can render the risk-card header a few pixels wider
 * than Windows Chrome. The Dashboard grid must not let card min-content sizes
 * inflate the whole document or create horizontal overflow at 1440px laptops.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ruleBody } from '../../_helpers/source.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('PATCH 2.20.27 / dashboard desktop overflow guards', () => {
    const css = read('css/dashboard.css');

    it('dashboard grid and direct children may shrink below min-content', () => {
        assert.match(ruleBody(css, '.dashboard-grid'), /min-width:\s*0\b/,
            '.dashboard-grid должен иметь min-width: 0');
        assert.match(ruleBody(css, '.dashboard-grid > *'), /min-width:\s*0\b/,
            'direct grid children should not inflate the grid scrollWidth');
    });

    it('dash-card shell does not export min-content overflow to the grid', () => {
        assert.match(ruleBody(css, '.dash-card'), /min-width:\s*0\b/,
            '.dash-card должен иметь min-width: 0');
        assert.match(ruleBody(css, '.dash-card-header'), /min-width:\s*0\b/,
            '.dash-card-header должен иметь min-width: 0');
        assert.match(ruleBody(css, '.dash-card-body'), /min-width:\s*0\b/,
            '.dash-card-body должен иметь min-width: 0');
    });

    it('risk-card header uses a stacked layout so the surcharge amount fits', () => {
        const header = ruleBody(css, '.dash-card-risk .dash-card-header');
        assert.match(header, /flex-direction:\s*column\b/,
            'risk-card header should not squeeze title and amount into one narrow row');

        const sub = ruleBody(css, '.dash-card-risk .dash-card-eyebrow-sub');
        assert.match(sub, /justify-content:\s*flex-start\b/,
            'surcharge summary should use the full header row from the left edge');
    });
});
