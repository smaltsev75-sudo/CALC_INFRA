/**
 * Source-level guard for user-facing number formatting.
 *
 * Regression class: local formatters can accidentally mix decimal/grouping
 * separators (`9 490,16` → `9 490 16`) or return dot-decimal values inside
 * Russian UI. Shared helpers in js/services/format.js are the intended path.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { stripJsComments } from '../../_helpers/source.js';

const ROOT = process.cwd();

function walk(dir) {
    return readdirSync(join(ROOT, dir), { withFileTypes: true })
        .flatMap(entry => {
            const rel = join(dir, entry.name);
            return entry.isDirectory() ? walk(rel) : [rel];
        });
}

function read(rel) {
    return readFileSync(join(ROOT, rel), 'utf8');
}

describe('UI number formatting consistency', () => {
    it('does not use locale formatting followed by comma replacement', () => {
        const files = [
            ...walk('js/ui'),
            ...walk('js/services'),
            ...walk('js/app')
        ].filter(f => f.endsWith('.js'));

        const offenders = files.filter(file => {
            const src = stripJsComments(read(file));
            return /toLocaleString\s*\([^)]*['"]ru-RU['"][^)]*\)\s*\.replace\s*\(/.test(src);
        });
        assert.deepEqual(offenders, []);
    });

    it('does not localize dot decimals with ad-hoc toFixed().replace(".", ",")', () => {
        const files = [
            ...walk('js/ui'),
            ...walk('js/services')
        ].filter(f => f.endsWith('.js'));

        const offenders = files.filter(file => {
            const src = stripJsComments(read(file));
            return /toFixed\s*\([^)]*\)\s*\.replace\s*\(\s*['"]\.['"]\s*,\s*['"],['"]/.test(src);
        });
        assert.deepEqual(offenders, []);
    });

    it('provider price comparison surfaces use shared formatter helpers', () => {
        const files = [
            'js/ui/providerPriceSummary.js',
            'js/ui/modals/providerAnalyticsModal.js',
            'js/ui/modals/providerScenarioComparisonModal.js',
            'js/ui/modals/deltaHistoryModal.js'
        ];

        for (const file of files) {
            const src = stripJsComments(read(file));
            assert.match(src, /formatNumber/, `${file} should use formatNumber`);
            assert.match(src, /formatPercentPoints/, `${file} should use formatPercentPoints`);
            assert.doesNotMatch(src, /toLocaleString\s*\(/, `${file} should not have local toLocaleString formatting`);
        }
    });
});
