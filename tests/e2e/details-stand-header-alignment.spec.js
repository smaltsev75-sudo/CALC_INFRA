import { expect, test } from '@playwright/test';
import {
    bootCleanApp,
    clickSidebarTab,
    createCalculationFromQuickStart
} from './helpers.js';

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

    const detailsAlignment = await page.locator('.details-table-cost').evaluate((table) => {
        const headers = [...table.querySelectorAll('thead tr.details-thead-row-headers th.col-stand')];
        const totals = [...table.querySelectorAll('thead tr.details-thead-row-totals-grand td.col-stand')];
        return headers.map((header, index) => {
            const total = totals[index];
            const headerRect = header.getBoundingClientRect();
            const totalRect = total.getBoundingClientRect();
            const name = header.querySelector('.col-stand-name');
            const unit = header.querySelector('.col-stand-unit');
            return {
                headerAlign: getComputedStyle(header).textAlign,
                nameAlign: name ? getComputedStyle(name).textAlign : '',
                hasUnit: Boolean(unit),
                leftDelta: Math.abs(headerRect.left - totalRect.left),
                widthDelta: Math.abs(headerRect.width - totalRect.width)
            };
        });
    });
    expect(detailsAlignment).toHaveLength(5);
    for (const cell of detailsAlignment) {
        expect(cell.headerAlign).toBe('right');
        expect(cell.nameAlign).toBe('right');
        expect(cell.hasUnit).toBe(false);
        expect(cell.leftDelta).toBeLessThanOrEqual(1);
        expect(cell.widthDelta).toBeLessThanOrEqual(1);
    }

    const aiSummaryAlignment = await page.locator('.details-ai-summary-table').evaluate((table) => {
        const headers = [...table.querySelectorAll('thead th.details-ai-cell-stand')];
        const cells = [...table.querySelectorAll('tbody tr:first-child td.details-ai-cell-stand')];
        return headers.map((header, index) => {
            const cell = cells[index];
            const headerRect = header.getBoundingClientRect();
            const cellRect = cell.getBoundingClientRect();
            return {
                headerAlign: getComputedStyle(header).textAlign,
                cellAlign: getComputedStyle(cell).textAlign,
                leftDelta: Math.abs(headerRect.left - cellRect.left),
                widthDelta: Math.abs(headerRect.width - cellRect.width)
            };
        });
    });
    expect(aiSummaryAlignment).toHaveLength(5);
    for (const cell of aiSummaryAlignment) {
        expect(cell.headerAlign).toBe('right');
        expect(cell.cellAlign).toBe('right');
        expect(cell.leftDelta).toBeLessThanOrEqual(1);
        expect(cell.widthDelta).toBeLessThanOrEqual(1);
    }

    await expect.poll(async () => page.evaluate(() => {
        const details = document.querySelector('.details-table-cost');
        const summary = document.querySelector('.details-ai-summary-table');
        const detailStandHeaders = [...details.querySelectorAll('thead tr.details-thead-row-headers th.col-stand')];
        const summaryStandHeaders = [...summary.querySelectorAll('thead th.details-ai-cell-stand')];
        const detailTotalHeader = details.querySelector('thead tr.details-thead-row-headers th.col-total');
        const summaryTotalHeader = summary.querySelector('thead th.details-ai-cell-total');
        const deltas = detailStandHeaders.map((detailHeader, index) => {
            const summaryHeader = summaryStandHeaders[index];
            const d = detailHeader.getBoundingClientRect();
            const s = summaryHeader.getBoundingClientRect();
            return Math.max(Math.abs(d.left - s.left), Math.abs(d.width - s.width));
        });
        const dTotal = detailTotalHeader.getBoundingClientRect();
        const sTotal = summaryTotalHeader.getBoundingClientRect();
        deltas.push(Math.abs(dTotal.left - sTotal.left), Math.abs(dTotal.width - sTotal.width));
        return Math.max(...deltas);
    }), {
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
