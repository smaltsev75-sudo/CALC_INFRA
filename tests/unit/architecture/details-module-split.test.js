import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = path => readFileSync(join(ROOT, path), 'utf8');

describe('Details tab modules stay split by responsibility', () => {
    it('detailsSections keeps the legacy public surface via re-exports', () => {
        const src = read('js/ui/detailsSections.js');

        assert.match(src, /export\s*\{\s*renderAiMetricsSummary\s*\}\s*from\s*['"]\.\/detailsAiSummary\.js['"]/);
        assert.match(src, /export\s*\{\s*computeTotalsForItems,\s*itemMonthlyOnActiveStands\s*\}\s*from\s*['"]\.\/detailsTotals\.js['"]/);
        assert.doesNotMatch(src, /DASHBOARD_AI_METRIC_|aggregateAiMetrics|formatResourceQty/);
    });

    it('detailsTotals remains DOM-free calculation glue', () => {
        const src = read('js/ui/detailsTotals.js');

        assert.match(src, /export\s+function\s+itemMonthlyOnActiveStands/);
        assert.match(src, /export\s+function\s+computeTotalsForItems/);
        assert.doesNotMatch(src, /from\s+['"][^'"]*(?:dom|icons|dashboard|vatBadge)\.js['"]/);
        assert.doesNotMatch(src, /\bdocument\b|\bHTMLElement\b|createElement/);
    });

    it('detailsAiSummary does not depend on the heavy table module', () => {
        const src = read('js/ui/detailsAiSummary.js');

        assert.match(src, /export\s+function\s+renderAiMetricsSummary/);
        assert.doesNotMatch(src, /from\s+['"]\.\/detailsSections\.js['"]/);
        assert.doesNotMatch(src, /from\s+['"]\.\/detailsTotals\.js['"]/);
    });

    it('details.js can keep importing Details helpers from the compatibility facade', () => {
        const src = read('js/ui/details.js');

        assert.match(src, /from\s+['"]\.\/detailsSections\.js['"]/);
        assert.match(src, /\bcomputeTotalsForItems\b/);
        assert.match(src, /\bitemMonthlyOnActiveStands\b/);
        assert.match(src, /\brenderAiMetricsSummary\b/);
    });
});
