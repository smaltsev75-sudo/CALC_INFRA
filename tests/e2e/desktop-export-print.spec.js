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

test('Details PDF print mode uses full-width landscape table layout', async ({ page }) => {
    const consoleErrors = await bootCleanApp(page);

    await createCalculationFromQuickStart(page, {
        name: 'Desktop Details PDF layout',
        presetId: 'std_b2b'
    });
    await clickSidebarTab(page, 'details');
    await expect(page.locator('.details-table-cost')).toBeVisible();

    await page.emulateMedia({ media: 'print' });

    const snapshot = await page.evaluate(async () => {
        const { printPdfAction } = await import(new URL('js/app/printActions.js', document.baseURI).href);
        const { store } = await import(new URL('js/state/store.js', document.baseURI).href);
        store.setActiveTab('details');
        store.setUi({ detailsSubTab: 'cost' });
        await new Promise(resolve => requestAnimationFrame(resolve));

        let duringPrint = null;
        printPdfAction({
            store,
            snackbar: { info() {}, warning() {} },
            withLoadingButton: async (_event, fn) => fn(),
            printWindow: () => {
                const table = document.querySelector('.details-table-cost');
                const wrap = document.querySelector('.details-table-wrap');
                const main = document.querySelector('.app-main');
                const vendorHeader = [...document.querySelectorAll('.details-table-cost thead th')]
                    .find(th => th.textContent.trim() === 'Поставщик');
                const tableStyle = getComputedStyle(table);
                const vendorStyle = getComputedStyle(vendorHeader);
                duringPrint = {
                    bodyClass: document.body.className,
                    hasStyle: !!document.getElementById('details-print-page-style'),
                    styleText: document.getElementById('details-print-page-style')?.textContent || '',
                    tableLayout: tableStyle.tableLayout,
                    tableWidth: table.getBoundingClientRect().width,
                    wrapWidth: wrap.getBoundingClientRect().width,
                    mainWidth: main.getBoundingClientRect().width,
                    tabContain: getComputedStyle(document.querySelector('.tab-pane')).contain,
                    vendorWidth: vendorHeader.getBoundingClientRect().width,
                    vendorWordBreak: vendorStyle.wordBreak,
                    vendorOverflowWrap: vendorStyle.overflowWrap
                };
                window.dispatchEvent(new Event('afterprint'));
            }
        });

        return {
            duringPrint,
            afterClass: document.body.className,
            afterStyleExists: !!document.getElementById('details-print-page-style')
        };
    });

    expect(snapshot.duringPrint.bodyClass).toContain('printing-details');
    expect(snapshot.duringPrint.hasStyle).toBe(true);
    expect(snapshot.duringPrint.styleText).toContain('A4 landscape');
    expect(snapshot.duringPrint.tableLayout).toBe('fixed');
    expect(snapshot.duringPrint.tabContain).toBe('none');
    expect(snapshot.duringPrint.tableWidth).toBeGreaterThan(snapshot.duringPrint.mainWidth * 0.98);
    expect(snapshot.duringPrint.wrapWidth).toBeGreaterThan(snapshot.duringPrint.mainWidth * 0.98);
    expect(snapshot.duringPrint.vendorWidth).toBeGreaterThan(60);
    expect(snapshot.duringPrint.vendorWordBreak).toBe('keep-all');
    expect(snapshot.duringPrint.vendorOverflowWrap).toBe('normal');
    expect(snapshot.afterClass).not.toContain('printing-details');
    expect(snapshot.afterStyleExists).toBe(false);

    await page.emulateMedia({ media: 'screen' });
    expect(consoleErrors).toEqual([]);
});

test('Native beforeprint on Details enables full-width landscape price and qty tables', async ({ page }) => {
    const consoleErrors = await bootCleanApp(page);

    await createCalculationFromQuickStart(page, {
        name: 'Native Details PDF layout',
        presetId: 'high_ai'
    });
    await clickSidebarTab(page, 'details');
    await expect(page.locator('.details-table-cost')).toBeVisible();

    await page.emulateMedia({ media: 'print' });
    const snapshot = await page.evaluate(async () => {
        window.dispatchEvent(new Event('beforeprint'));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

        const table = document.querySelector('.details-table-cost');
        const wrap = document.querySelector('.details-table-wrap');
        const main = document.querySelector('.app-main');
        return {
            bodyClass: document.body.className,
            hasStyle: !!document.getElementById('details-print-page-style'),
            styleText: document.getElementById('details-print-page-style')?.textContent || '',
            tableLayout: getComputedStyle(table).tableLayout,
            tableWidth: table.getBoundingClientRect().width,
            wrapWidth: wrap.getBoundingClientRect().width,
            mainWidth: main.getBoundingClientRect().width
        };
    });

    expect(snapshot.bodyClass).toContain('printing-details');
    expect(snapshot.hasStyle).toBe(true);
    expect(snapshot.styleText).toContain('A4 landscape');
    expect(snapshot.tableLayout).toBe('fixed');
    expect(snapshot.tableWidth).toBeGreaterThan(snapshot.mainWidth * 0.98);
    expect(snapshot.wrapWidth).toBeGreaterThan(snapshot.mainWidth * 0.98);

    const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true });
    const mediaBox = pdf.toString('latin1').match(/\/MediaBox\s*\[\s*([^\]]+)\]/)?.[1] || '';
    const [, , width, height] = mediaBox.trim().split(/\s+/).map(Number);
    expect(width).toBeGreaterThan(height);

    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await expect.poll(() => page.evaluate(() => document.body.classList.contains('printing-details'))).toBe(false);

    await page.emulateMedia({ media: 'screen' });
    await page.getByRole('button', { name: 'Объём (qty)' }).click();
    await expect(page.locator('.details-table-qty')).toBeVisible();
    await page.emulateMedia({ media: 'print' });

    const qtySnapshot = await page.evaluate(async () => {
        window.dispatchEvent(new Event('beforeprint'));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

        const table = document.querySelector('.details-table-qty');
        const wrap = document.querySelector('.details-table-wrap');
        const main = document.querySelector('.app-main');
        return {
            bodyClass: document.body.className,
            tableLayout: getComputedStyle(table).tableLayout,
            tableWidth: table.getBoundingClientRect().width,
            wrapWidth: wrap.getBoundingClientRect().width,
            mainWidth: main.getBoundingClientRect().width
        };
    });

    expect(qtySnapshot.bodyClass).toContain('printing-details');
    expect(qtySnapshot.tableLayout).toBe('fixed');
    expect(qtySnapshot.tableWidth).toBeGreaterThan(qtySnapshot.mainWidth * 0.98);
    expect(qtySnapshot.wrapWidth).toBeGreaterThan(qtySnapshot.mainWidth * 0.98);
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await expect.poll(() => page.evaluate(() => document.body.classList.contains('printing-details'))).toBe(false);

    await page.emulateMedia({ media: 'screen' });
    expect(consoleErrors).toEqual([]);
});
