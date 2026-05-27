import { expect, test } from '@playwright/test';
import {
    bootCleanApp,
    seedCalculations
} from './helpers.js';

test.describe.configure({ mode: 'parallel' });

function readSummaryLayout(page) {
    return page.locator('.calc-state-summary').first().evaluate(card => {
        const cardRect = card.getBoundingClientRect();
        const rows = [...card.querySelectorAll('.calc-state-summary-diagnostics > .calc-state-summary-row')]
            .map(row => {
                const rect = row.getBoundingClientRect();
                return {
                    left: Math.round(rect.left * 100) / 100,
                    right: Math.round(rect.right * 100) / 100,
                    top: Math.round(rect.top * 100) / 100,
                    bottom: Math.round(rect.bottom * 100) / 100,
                    width: Math.round(rect.width * 100) / 100
                };
            });
        const next = card.querySelector('.calc-state-summary-next')?.getBoundingClientRect();
        const optimization = card.querySelector('.calc-state-summary-optimization')?.getBoundingClientRect();
        const overflow = [...card.querySelectorAll('*')]
            .filter(node => {
                const rect = node.getBoundingClientRect();
                return rect.width > 0 &&
                    (rect.left < cardRect.left - 1 || rect.right > cardRect.right + 1);
            })
            .map(node => ({
                className: String(node.className),
                text: node.textContent.trim().slice(0, 80)
            }));
        return {
            card: {
                left: Math.round(cardRect.left * 100) / 100,
                right: Math.round(cardRect.right * 100) / 100,
                width: Math.round(cardRect.width * 100) / 100
            },
            rows,
            next: next ? {
                top: Math.round(next.top * 100) / 100,
                bottom: Math.round(next.bottom * 100) / 100,
                width: Math.round(next.width * 100) / 100
            } : null,
            optimization: optimization ? {
                top: Math.round(optimization.top * 100) / 100,
                bottom: Math.round(optimization.bottom * 100) / 100,
                width: Math.round(optimization.width * 100) / 100
            } : null,
            overflow
        };
    });
}

test('Calculation state summary keeps compact stacked rows on desktop', async ({ page }) => {
    const consoleErrors = await bootCleanApp(page);
    await seedCalculations(page);

    const summary = page.locator('.calc-state-summary').first();
    await expect(summary).toBeVisible();
    await expect(summary.locator('.calc-state-summary-diagnostics > .calc-state-summary-row')).toHaveCount(3);
    await expect(summary.locator('.calc-state-summary-next')).toBeVisible();
    await expect(summary.locator('.calc-state-summary-optimization')).toBeVisible();

    const layout = await readSummaryLayout(page);
    expect(layout.overflow).toEqual([]);
    expect(layout.rows.length).toBe(3);

    for (const row of layout.rows) {
        expect(Math.abs(row.left - layout.rows[0].left)).toBeLessThanOrEqual(1);
        expect(Math.abs(row.right - layout.rows[0].right)).toBeLessThanOrEqual(1);
    }
    for (let i = 1; i < layout.rows.length; i += 1) {
        expect(layout.rows[i].top).toBeGreaterThanOrEqual(layout.rows[i - 1].bottom - 1);
    }
    expect(layout.next.top).toBeGreaterThan(layout.rows[layout.rows.length - 1].bottom);
    expect(layout.optimization.top).toBeGreaterThan(layout.next.bottom);

    expect(consoleErrors).toEqual([]);
});

test('Calculation state summary fits mobile width without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    const consoleErrors = await bootCleanApp(page);
    await seedCalculations(page);

    const summary = page.locator('.calc-state-summary').first();
    await expect(summary).toBeVisible();
    await expect.poll(async () => summary.evaluate(card => {
        const rect = card.getBoundingClientRect();
        return card.isConnected && rect.width > 240 && rect.height > 240;
    })).toBe(true);

    const layout = await readSummaryLayout(page);
    expect(layout.card.width).toBeGreaterThan(240);
    expect(layout.overflow).toEqual([]);
    expect(layout.rows.length).toBe(3);
    expect(layout.next.width).toBeLessThanOrEqual(layout.card.width);
    expect(layout.optimization.width).toBeLessThanOrEqual(layout.card.width);

    expect(consoleErrors).toEqual([]);
});
