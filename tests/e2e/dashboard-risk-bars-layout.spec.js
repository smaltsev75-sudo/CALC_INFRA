import { expect, test } from '@playwright/test';
import {
    bootCleanApp,
    createCalculationFromQuickStart
} from './helpers.js';

test.describe.configure({ mode: 'parallel' });

test('Risk contribution composition card stays aligned and non-overlapping', async ({ page }) => {
    const consoleErrors = await bootCleanApp(page);

    await createCalculationFromQuickStart(page, {
        name: 'Risk bars layout contract',
        presetId: 'high_ai'
    });
    await page.getByTestId('dashboard-period-annual').click();
    await expect(page.locator('.dash-card-risk')).toBeVisible();

    const segmentSummary = await page.locator('.dash-card-risk .dash-risk-segments').evaluate(node => {
        const container = node.getBoundingClientRect();
        const segments = [...node.querySelectorAll('.dash-risk-segment')].map(seg => {
            const rect = seg.getBoundingClientRect();
            return {
                width: Math.round(rect.width * 100) / 100,
                top: Math.round(rect.top * 100) / 100,
                bottom: Math.round(rect.bottom * 100) / 100
            };
        });
        return {
            containerWidth: Math.round(container.width * 100) / 100,
            segments,
            sumWidth: Math.round(segments.reduce((sum, seg) => sum + seg.width, 0) * 100) / 100
        };
    });

    expect(segmentSummary.segments.length).toBeGreaterThanOrEqual(3);
    expect(Math.abs(segmentSummary.sumWidth - segmentSummary.containerWidth)).toBeLessThanOrEqual(2);
    for (const segment of segmentSummary.segments) {
        expect(segment.width).toBeGreaterThan(0);
        expect(Math.abs(segment.top - segmentSummary.segments[0].top)).toBeLessThanOrEqual(1);
        expect(Math.abs(segment.bottom - segmentSummary.segments[0].bottom)).toBeLessThanOrEqual(1);
    }

    const overflow = await page.locator('.dash-card-risk .dash-risk-row')
        .evaluateAll(rows => rows.flatMap(row => {
            const cardRect = row.closest('.dash-card-risk').getBoundingClientRect();
            return [...row.querySelectorAll('.dash-risk-row-label, .dash-risk-row-amount, .dash-risk-row-value')]
                .map(node => {
                    const rect = node.getBoundingClientRect();
                    return {
                        text: node.textContent.trim(),
                        left: rect.left,
                        right: rect.right,
                        cardLeft: cardRect.left,
                        cardRight: cardRect.right
                    };
                })
                .filter(rect => rect.left < rect.cardLeft - 1 || rect.right > rect.cardRight + 1);
        }));
    expect(overflow).toEqual([]);

    const collisions = await page.locator('.dash-card-risk .dash-risk-row')
        .evaluateAll(rows => rows.flatMap(row => {
            const label = row.querySelector('.dash-risk-row-label');
            const amount = row.querySelector('.dash-risk-row-amount');
            const value = row.querySelector('.dash-risk-row-value');
            if (!label || !amount || !value) return [];
            const labelRect = label.getBoundingClientRect();
            const amountRect = amount.getBoundingClientRect();
            const valueRect = value.getBoundingClientRect();
            const sameLineLabelAmount = labelRect.top < amountRect.bottom && labelRect.bottom > amountRect.top;
            const sameLineAmountValue = amountRect.top < valueRect.bottom && amountRect.bottom > valueRect.top;
            const bad = [];
            if (sameLineLabelAmount && amountRect.left - labelRect.right < 8) bad.push('label/amount');
            if (sameLineAmountValue && valueRect.left - amountRect.right < 8) bad.push('amount/value');
            return bad.map(type => ({ type, text: row.textContent.trim() }));
        }));
    expect(collisions).toEqual([]);

    expect(consoleErrors).toEqual([]);
});

test('Category distribution composition card stays aligned and non-overlapping', async ({ page }) => {
    const consoleErrors = await bootCleanApp(page);

    await createCalculationFromQuickStart(page, {
        name: 'Category composition layout contract',
        presetId: 'high_ai'
    });
    await page.getByTestId('dashboard-period-monthly').click();
    await expect(page.locator('.dash-card-categories')).toBeVisible();

    const segmentSummary = await page.locator('.dash-card-categories .dash-category-segments').evaluate(node => {
        const container = node.getBoundingClientRect();
        const segments = [...node.querySelectorAll('.dash-category-segment')].map(seg => {
            const rect = seg.getBoundingClientRect();
            return {
                width: Math.round(rect.width * 100) / 100,
                top: Math.round(rect.top * 100) / 100,
                bottom: Math.round(rect.bottom * 100) / 100
            };
        });
        return {
            containerWidth: Math.round(container.width * 100) / 100,
            segments,
            sumWidth: Math.round(segments.reduce((sum, seg) => sum + seg.width, 0) * 100) / 100
        };
    });

    expect(segmentSummary.segments.length).toBeGreaterThanOrEqual(4);
    expect(Math.abs(segmentSummary.sumWidth - segmentSummary.containerWidth)).toBeLessThanOrEqual(2);
    for (const segment of segmentSummary.segments) {
        expect(segment.width).toBeGreaterThan(0);
        expect(Math.abs(segment.top - segmentSummary.segments[0].top)).toBeLessThanOrEqual(1);
        expect(Math.abs(segment.bottom - segmentSummary.segments[0].bottom)).toBeLessThanOrEqual(1);
    }

    const overflow = await page.locator('.dash-card-categories .dash-category-row')
        .evaluateAll(rows => rows.flatMap(row => {
            const cardRect = row.closest('.dash-card-categories').getBoundingClientRect();
            return [...row.querySelectorAll('.dash-category-row-label, .dash-category-row-value, .dash-category-row-pct')]
                .map(node => {
                    const rect = node.getBoundingClientRect();
                    return {
                        text: node.textContent.trim(),
                        left: rect.left,
                        right: rect.right,
                        cardLeft: cardRect.left,
                        cardRight: cardRect.right
                    };
                })
                .filter(rect => rect.left < rect.cardLeft - 1 || rect.right > rect.cardRight + 1);
        }));
    expect(overflow).toEqual([]);

    const collisions = await page.locator('.dash-card-categories .dash-category-row')
        .evaluateAll(rows => rows.flatMap(row => {
            const label = row.querySelector('.dash-category-row-label');
            const amount = row.querySelector('.dash-category-row-value');
            const value = row.querySelector('.dash-category-row-pct');
            if (!label || !amount || !value) return [];
            const labelRect = label.getBoundingClientRect();
            const amountRect = amount.getBoundingClientRect();
            const valueRect = value.getBoundingClientRect();
            const sameLineLabelAmount = labelRect.top < amountRect.bottom && labelRect.bottom > amountRect.top;
            const sameLineAmountValue = amountRect.top < valueRect.bottom && amountRect.bottom > valueRect.top;
            const bad = [];
            if (sameLineLabelAmount && amountRect.left - labelRect.right < 8) bad.push('label/amount');
            if (sameLineAmountValue && valueRect.left - amountRect.right < 8) bad.push('amount/value');
            return bad.map(type => ({ type, text: row.textContent.trim() }));
        }));
    expect(collisions).toEqual([]);

    expect(consoleErrors).toEqual([]);
});

test('Dashboard top composition cards share the same desktop row height', async ({ page }) => {
    await page.setViewportSize({ width: 1680, height: 900 });
    const consoleErrors = await bootCleanApp(page);

    await createCalculationFromQuickStart(page, {
        name: 'Top composition card height contract',
        presetId: 'high_ai'
    });
    await page.getByTestId('dashboard-period-monthly').click();

    const heights = await page.evaluate(() => {
        return ['.dash-card-hero', '.dash-card-categories', '.dash-card-risk'].map(selector => {
            const rect = document.querySelector(selector).getBoundingClientRect();
            return {
                selector,
                top: Math.round(rect.top),
                height: Math.round(rect.height)
            };
        });
    });

    const tops = heights.map(item => item.top);
    const rowHeights = heights.map(item => item.height);
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(1);
    expect(Math.max(...rowHeights) - Math.min(...rowHeights)).toBeLessThanOrEqual(2);

    expect(consoleErrors).toEqual([]);
});
