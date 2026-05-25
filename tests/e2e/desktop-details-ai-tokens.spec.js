import { expect, test } from '@playwright/test';
import {
    bootCleanApp,
    clickSidebarTab,
    createCalculationFromQuickStart
} from './helpers.js';

test.describe.configure({ mode: 'parallel' });

function aiSummaryRow(page, label) {
    return page.locator('.details-ai-summary-table tbody tr').filter({ hasText: label });
}

async function expectTokensSummaryVisible(page) {
    const row = aiSummaryRow(page, 'Токены');
    await expect(row).toBeVisible();
    await expect(row.locator('.details-ai-cell-total')).toContainText(/млн токенов \/ мес/);
    await expect(row.locator('.details-ai-cell-total')).not.toHaveText('—');
}

async function expandAiCategoryIfNeeded(page, tableSelector) {
    const inputRow = page.locator(`${tableSelector} tbody tr.item-row`).filter({ hasText: 'Входящие токены LLM' });
    if (await inputRow.count()) return;

    const aiCategory = page
        .locator(`${tableSelector} tbody tr.category-row`)
        .filter({ hasText: 'AI / LLM' })
        .first();
    await expect(aiCategory).toBeVisible();
    await aiCategory.click();
}

async function expectTokenItemRowsVisible(page, tableSelector) {
    await expandAiCategoryIfNeeded(page, tableSelector);

    const inputRow = page.locator(`${tableSelector} tbody tr.item-row`).filter({ hasText: 'Входящие токены LLM' });
    const outputRow = page.locator(`${tableSelector} tbody tr.item-row`).filter({ hasText: 'Исходящие токены LLM' });
    await expect(inputRow).toBeVisible();
    await expect(outputRow).toBeVisible();
    await expect(inputRow.locator('td.col-total').first()).not.toHaveText('—');
    await expect(outputRow.locator('td.col-total').first()).not.toHaveText('—');
}

test('Details shows calculated LLM tokens on Budget and Qty for Quick Start AI', async ({ page }) => {
    const consoleErrors = await bootCleanApp(page);

    await createCalculationFromQuickStart(page, {
        name: 'Details tokens contract',
        presetId: 'high_ai'
    });

    await clickSidebarTab(page, 'details');
    await expect(page.locator('.details-table-cost')).toBeVisible();
    await expect(page.locator('.details-ai-summary')).toBeVisible();
    await expectTokensSummaryVisible(page);

    const cpuAgentsRow = aiSummaryRow(page, 'CPU агентов');
    await expect(cpuAgentsRow).toBeVisible();

    await page.locator('.details-hide-zero').click();
    await expectTokensSummaryVisible(page);
    await expect(cpuAgentsRow).toHaveCount(0);

    await expectTokenItemRowsVisible(page, '.details-table-cost');

    await page.getByRole('button', { name: 'Объём (qty)' }).click();
    await expect(page.locator('.details-table-qty')).toBeVisible();
    await expect(page.locator('.details-ai-summary')).toBeVisible();
    await expectTokensSummaryVisible(page);
    await expect(aiSummaryRow(page, 'CPU агентов')).toHaveCount(0);
    await expectTokenItemRowsVisible(page, '.details-table-qty');

    expect(consoleErrors).toEqual([]);
});
