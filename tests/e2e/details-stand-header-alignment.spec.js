import { expect, test } from '@playwright/test';
import {
    bootCleanApp,
    clickSidebarTab,
    createCalculationFromQuickStart
} from './helpers.js';

test('Details stand headers are centered and aligned with stand columns', async ({ page }) => {
    const consoleErrors = await bootCleanApp(page);

    await createCalculationFromQuickStart(page, {
        name: 'Details stand header alignment',
        presetId: 'high_ai'
    });
    await clickSidebarTab(page, 'details');

    await expect(page.locator('.details-table-cost')).toBeVisible();
    await expect(page.locator('.details-ai-summary-table')).toBeVisible();

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
                unitAlign: unit ? getComputedStyle(unit).textAlign : '',
                leftDelta: Math.abs(headerRect.left - totalRect.left),
                widthDelta: Math.abs(headerRect.width - totalRect.width)
            };
        });
    });
    expect(detailsAlignment).toHaveLength(5);
    for (const cell of detailsAlignment) {
        expect(cell.headerAlign).toBe('center');
        expect(cell.nameAlign).toBe('center');
        expect(cell.unitAlign).toBe('center');
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
        expect(cell.headerAlign).toBe('center');
        expect(cell.cellAlign).toBe('center');
        expect(cell.leftDelta).toBeLessThanOrEqual(1);
        expect(cell.widthDelta).toBeLessThanOrEqual(1);
    }

    expect(consoleErrors).toEqual([]);
});
