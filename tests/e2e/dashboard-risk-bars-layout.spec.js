import { expect, test } from '@playwright/test';
import {
    bootCleanApp,
    createCalculationFromQuickStart
} from './helpers.js';

test.describe.configure({ mode: 'parallel' });

test('Risk contribution bars are left-aligned and have equal width', async ({ page }) => {
    const consoleErrors = await bootCleanApp(page);

    await createCalculationFromQuickStart(page, {
        name: 'Risk bars layout contract',
        presetId: 'high_ai'
    });
    await page.getByTestId('dashboard-period-annual').click();
    await expect(page.locator('.dash-card-risk')).toBeVisible();

    const bars = await page.locator('.dash-card-risk .dash-risk-row-bar')
        .evaluateAll(nodes => nodes.map(node => {
            const rect = node.getBoundingClientRect();
            return {
                left: Math.round(rect.left * 100) / 100,
                width: Math.round(rect.width * 100) / 100
            };
        }));

    expect(bars.length).toBeGreaterThanOrEqual(3);
    const first = bars[0];
    for (const bar of bars) {
        expect(Math.abs(bar.left - first.left)).toBeLessThanOrEqual(1);
        expect(Math.abs(bar.width - first.width)).toBeLessThanOrEqual(1);
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

    expect(consoleErrors).toEqual([]);
});
