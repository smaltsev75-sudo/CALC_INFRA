/**
 * Shared Russian formatting helpers: compact money and percentage points.
 *
 * These helpers protect dense UI/memo surfaces from drifting back to ad-hoc
 * `toFixed()` / `toLocaleString().replace()` formatting.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    formatNumber,
    formatPercentPoints,
    formatRubShort
} from '../../../js/services/format.js';

describe('format.js ru-RU helpers', () => {
    it('formatNumber preserves decimal comma', () => {
        assert.match(formatNumber(9490.16, { min: 0, max: 2 }), /^9\s*490,16$/);
        assert.equal(formatNumber(1.2345, { min: 3, max: 3, useGrouping: false }), '1,235');
    });

    it('formatRubShort renders compact money with Russian decimal comma', () => {
        assert.match(formatRubShort(2_500_000, { millionFractionDigits: 2 }), /^2,50\s+млн\s+₽$/);
        assert.match(formatRubShort(150_000, { thousandFractionDigits: 1 }), /^150,0\s+тыс\.\s+₽$/);
        assert.match(formatRubShort(-750), /^−750\s+₽$/);
        assert.equal(formatRubShort(NaN), '—');
    });

    it('formatPercentPoints formats deltas without multiplying by 100', () => {
        assert.equal(formatPercentPoints(18, { min: 1, max: 1 }), '+18,0%');
        assert.equal(formatPercentPoints(-5.5, { min: 1, max: 1 }), '−5,5%');
        assert.match(formatPercentPoints(12.4, { min: 1, max: 1, spaceBeforePercent: true }), /^\+12,4\s+%$/);
        assert.equal(formatPercentPoints(12.4, { min: 1, max: 1, showPlus: false }), '12,4%');
    });
});
