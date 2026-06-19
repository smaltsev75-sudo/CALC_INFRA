import { expect, test } from '@playwright/test';
import {
    bootCleanApp,
    clickSidebarTab,
    createCalculationFromQuickStart
} from './helpers.js';

function maxDetailsStandHeaderDelta(table) {
    if (!table?.isConnected) return Number.POSITIVE_INFINITY;
    const headers = [...table.querySelectorAll('thead tr.details-thead-row-headers th.col-stand')];
    const totals = [...table.querySelectorAll('thead tr.details-thead-row-totals-grand td.col-stand')];
    if (headers.length !== 5 || totals.length !== 5) return Number.POSITIVE_INFINITY;

    let maxDelta = 0;
    for (const [index, header] of headers.entries()) {
        const total = totals[index];
        const headerRect = header.getBoundingClientRect();
        const totalRect = total.getBoundingClientRect();
        const name = header.querySelector('.col-stand-name');
        const unit = header.querySelector('.col-stand-unit');
        if (headerRect.width <= 0 || totalRect.width <= 0) return Number.POSITIVE_INFINITY;
        if (getComputedStyle(header).textAlign !== 'right') return Number.POSITIVE_INFINITY;
        if (!name || getComputedStyle(name).textAlign !== 'right') return Number.POSITIVE_INFINITY;
        if (unit) return Number.POSITIVE_INFINITY;
        maxDelta = Math.max(
            maxDelta,
            Math.abs(headerRect.left - totalRect.left),
            Math.abs(headerRect.width - totalRect.width)
        );
    }
    return maxDelta;
}

function maxAiSummaryStandHeaderDelta(table) {
    if (!table?.isConnected) return Number.POSITIVE_INFINITY;
    const headers = [...table.querySelectorAll('thead th.details-ai-cell-stand')];
    const cells = [...table.querySelectorAll('tbody tr:first-child td.details-ai-cell-stand')];
    if (headers.length !== 5 || cells.length !== 5) return Number.POSITIVE_INFINITY;

    let maxDelta = 0;
    for (const [index, header] of headers.entries()) {
        const cell = cells[index];
        const headerRect = header.getBoundingClientRect();
        const cellRect = cell.getBoundingClientRect();
        if (headerRect.width <= 0 || cellRect.width <= 0) return Number.POSITIVE_INFINITY;
        if (getComputedStyle(header).textAlign !== 'right') return Number.POSITIVE_INFINITY;
        if (getComputedStyle(cell).textAlign !== 'right') return Number.POSITIVE_INFINITY;
        maxDelta = Math.max(
            maxDelta,
            Math.abs(headerRect.left - cellRect.left),
            Math.abs(headerRect.width - cellRect.width)
        );
    }
    return maxDelta;
}

function maxDetailsToAiSummaryDelta() {
    const details = document.querySelector('.details-table-cost');
    const summary = document.querySelector('.details-ai-summary-table');
    if (!details?.isConnected || !summary?.isConnected) return Number.POSITIVE_INFINITY;
    const detailStandHeaders = [...details.querySelectorAll('thead tr.details-thead-row-headers th.col-stand')];
    const summaryStandHeaders = [...summary.querySelectorAll('thead th.details-ai-cell-stand')];
    const detailTotalHeader = details.querySelector('thead tr.details-thead-row-headers th.col-total');
    const summaryTotalHeader = summary.querySelector('thead th.details-ai-cell-total');
    if (detailStandHeaders.length !== 5 || summaryStandHeaders.length !== 5 ||
        !detailTotalHeader || !summaryTotalHeader) {
        return Number.POSITIVE_INFINITY;
    }

    const deltas = detailStandHeaders.map((detailHeader, index) => {
        const summaryHeader = summaryStandHeaders[index];
        const d = detailHeader.getBoundingClientRect();
        const s = summaryHeader.getBoundingClientRect();
        if (d.width <= 0 || s.width <= 0) return Number.POSITIVE_INFINITY;
        return Math.max(Math.abs(d.left - s.left), Math.abs(d.width - s.width));
    });
    const dTotal = detailTotalHeader.getBoundingClientRect();
    const sTotal = summaryTotalHeader.getBoundingClientRect();
    if (dTotal.width <= 0 || sTotal.width <= 0) return Number.POSITIVE_INFINITY;
    deltas.push(Math.abs(dTotal.left - sTotal.left), Math.abs(dTotal.width - sTotal.width));
    return Math.max(...deltas);
}

test('Details stand headers are right-aligned with numeric stand columns', async ({ page }) => {
    const consoleErrors = await bootCleanApp(page);

    await createCalculationFromQuickStart(page, {
        name: 'Details stand header alignment',
        presetId: 'high_ai'
    });
    await clickSidebarTab(page, 'details');

    await expect(page.locator('.details-table-cost')).toBeVisible();
    await expect(page.locator('.details-ai-summary-table')).toBeVisible();
    await expect(page.locator('.details-ai-summary-table thead th.details-ai-cell-metric'))
        .toHaveText('Метрика');
    await expect(page.locator('.details-ai-summary-table thead th.details-ai-cell-unit'))
        .toHaveText('Ед.изм.');
    await expect(page.locator('.details-ai-summary-table tbody tr').filter({ hasText: 'Токены' })
        .locator('.details-ai-cell-unit')).toHaveText('₽/мес');
    await expect(page.locator('.details-table-cost thead tr.details-thead-row-headers th.col-unit')).toHaveCSS('text-align', 'left');
    await expect(page.locator('.details-ai-summary-table thead th.details-ai-cell-unit')).toHaveCSS('text-align', 'left');
    await expect(page.locator('.details-ai-summary-table thead th.details-ai-cell-stand').first()).toHaveCSS('text-align', 'right');
    await expect(page.locator('.details-ai-summary-table tbody td.details-ai-cell-stand').first()).toHaveCSS('text-align', 'right');

    await expect.poll(async () => page.locator('.details-table-cost').evaluate(maxDetailsStandHeaderDelta), {
        message: 'Details stand headers must have stable right-aligned geometry'
    }).toBeLessThanOrEqual(1);

    await expect.poll(async () => page.locator('.details-ai-summary-table').evaluate(maxAiSummaryStandHeaderDelta), {
        message: 'AI summary stand headers must have stable right-aligned geometry'
    }).toBeLessThanOrEqual(1);

    await expect.poll(async () => page.evaluate(maxDetailsToAiSummaryDelta), {
        message: 'AI summary stand headers must align with the Details table stand headers'
    }).toBeLessThanOrEqual(1);

    await page.getByRole('button', { name: 'Объём (qty)' }).click();
    await expect(page.locator('.details-table-qty')).toBeVisible();
    await expect(page.locator('.details-table-qty thead tr.details-thead-row-headers th.col-unit')).toHaveCSS('text-align', 'left');
    await expect(page.locator('.details-table-qty thead tr.details-thead-row-headers th.col-stand .col-stand-unit')).toHaveCount(0);
    await page.locator('.details-table-qty tbody tr.category-row').filter({ hasText: 'AI / LLM' }).first().click();
    const inputTokensQtyRow = page.locator('.details-table-qty tbody tr.item-row').filter({ hasText: 'Входящие токены LLM' }).first();
    await expect(inputTokensQtyRow).toBeVisible();
    await expect(inputTokensQtyRow.locator('td.col-unit')).toContainText('млн токенов / мес');
    await expect(inputTokensQtyRow.locator('td.col-total')).not.toContainText(/млн токенов/);
    const standCellTexts = await inputTokensQtyRow.locator('td.col-stand').allTextContents();
    expect(standCellTexts.some(text => /[1-9]/.test(text))).toBeTruthy();
    expect(standCellTexts.every(text => !/млн токенов/.test(text))).toBeTruthy();
    await expect(page.locator('.details-ai-summary-table thead th.details-ai-cell-unit')).toHaveCSS('text-align', 'left');
    await expect(page.locator('.details-ai-summary-table tbody tr').filter({ hasText: 'Токены' })
        .locator('.details-ai-cell-unit')).toContainText('токен');

    expect(consoleErrors).toEqual([]);
});
