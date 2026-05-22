import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import {
    bootCleanApp,
    clickSidebarTab,
    createCalculationFromQuickStart,
    expectNoHorizontalOverflow
} from './helpers.js';

test.describe.configure({ mode: 'parallel' });

test('Decision Memo downloads markdown from the desktop modal', async ({ page }) => {
    const consoleErrors = await bootCleanApp(page);

    await createCalculationFromQuickStart(page, {
        name: 'Desktop memo export',
        presetId: 'high_ai'
    });

    await page.evaluate(async () => {
        const memoCtl = await import(new URL('js/controllers/decisionMemoController.js', document.baseURI).href);
        memoCtl.openDecisionMemoModal();
    });

    await expect(page.getByTestId('decision-memo-modal')).toBeVisible();
    await expect(page.getByTestId('decision-memo-preview')).toBeVisible();
    await expect(page.getByTestId('decision-memo-preview').locator('table').first()).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('decision-memo-download').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.md$/);

    const memoPath = await download.path();
    const markdown = await readFile(memoPath, 'utf8');
    expect(markdown).toContain('# Обоснование расчёта инфраструктуры');
    expect(markdown).toContain('Desktop memo export');
    expect(markdown).toContain('## 2. Что повлияло на стоимость больше всего');
    expect(markdown).toMatch(/\|\s*#\s*\|\s*Статья затрат/);
    expect(markdown).toContain('## 4. Использованные прайсы');

    await expectNoHorizontalOverflow(page, [
        '.modal',
        '.decision-memo-modal-body',
        '.decision-memo-actions',
        '.decision-memo-preview'
    ]);
    expect(consoleErrors).toEqual([]);
});

test('Header PDF routes dashboard print and questionnaire answer print correctly', async ({ page }) => {
    await page.addInitScript(() => {
        window.__printCalls = [];
        window.print = () => {
            const area = document.getElementById('print-answers-area');
            window.__printCalls.push({
                bodyClass: document.body.className,
                hasPrintArea: !!area,
                printText: area?.textContent || ''
            });
            window.dispatchEvent(new Event('afterprint'));
        };
    });
    const consoleErrors = await bootCleanApp(page);

    await createCalculationFromQuickStart(page, {
        name: 'Desktop PDF routing',
        presetId: 'std_b2b'
    });

    await page.getByTestId('header-print-pdf').click();
    await expect.poll(() => page.evaluate(() => window.__printCalls?.length || 0)).toBe(1);
    let calls = await page.evaluate(() => window.__printCalls);
    expect(calls[0].hasPrintArea).toBe(false);

    await clickSidebarTab(page, 'questionnaire');
    await page.getByTestId('header-print-pdf').click();
    await expect(page.getByTestId('print-options-modal')).toBeVisible();
    await page.getByTestId('print-format-extended').click();
    await page.getByTestId('print-options-submit').click();

    await expect.poll(() => page.evaluate(() => window.__printCalls?.length || 0)).toBe(2);
    calls = await page.evaluate(() => window.__printCalls);
    expect(calls[1].hasPrintArea).toBe(true);
    expect(calls[1].bodyClass).toContain('printing-answers');
    expect(calls[1].bodyClass).toContain('printing-answers-extended');
    expect(calls[1].printText).toContain('Анкета бизнес-заказчика');
    expect(calls[1].printText).toContain('Desktop PDF routing');

    expect(consoleErrors).toEqual([]);
});
