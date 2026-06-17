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
    expect(markdown).toContain('## 2. Состав стоимости: самые дорогие статьи');
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

test('Details PDF options allow hiding quantity check summary', async ({ page }) => {
    await page.addInitScript(() => {
        window.__printCalls = [];
        window.print = () => {
            const summary = document.querySelector('.details-quantity-print-summary');
            window.__printCalls.push({
                bodyClass: document.body.className,
                summaryText: summary?.textContent || ''
            });
            window.dispatchEvent(new Event('afterprint'));
        };
    });
    const consoleErrors = await bootCleanApp(page);

    await createCalculationFromQuickStart(page, {
        name: 'Details PDF quantity option',
        presetId: 'std_b2b'
    });
    await clickSidebarTab(page, 'details');
    await expect(page.locator('.details-table-cost')).toBeVisible();

    await page.getByTestId('header-print-pdf').click();
    await expect(page.getByTestId('details-print-options-modal')).toBeVisible();
    await expect(page.getByTestId('details-print-quantity-toggle')).toBeChecked();
    await page.getByTestId('details-print-options-submit').click();

    await expect.poll(() => page.evaluate(() => window.__printCalls?.length || 0)).toBe(1);
    let calls = await page.evaluate(() => window.__printCalls);
    expect(calls[0].bodyClass).toContain('printing-details');
    expect(calls[0].bodyClass).not.toContain('printing-details-no-quantity-summary');
    expect(calls[0].summaryText).toContain('Почему столько? Проверка количества ЭК');

    await page.getByTestId('header-print-pdf').click();
    await expect(page.getByTestId('details-print-options-modal')).toBeVisible();
    await page.getByTestId('details-print-quantity-toggle').click();
    await page.getByTestId('details-print-options-submit').click();

    await expect.poll(() => page.evaluate(() => window.__printCalls?.length || 0)).toBe(2);
    calls = await page.evaluate(() => window.__printCalls);
    expect(calls[1].bodyClass).toContain('printing-details');
    expect(calls[1].bodyClass).toContain('printing-details-no-quantity-summary');

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
    /* 2.22.7: меряем при A4 landscape usable-ширине (≈1122px @96dpi минус поля),
       иначе при desktop-viewport колонки шире реальной печати и переполнение
       ИТОГО-колонок (год, 8 цифр) не воспроизводится. */
    await page.setViewportSize({ width: 1122, height: 793 });

    const snapshot = await page.evaluate(async () => {
        const { printWithDetailsMode } = await import(new URL('js/utils/printMode.js', document.baseURI).href);
        const { store } = await import(new URL('js/state/store.js', document.baseURI).href);
        store.setActiveTab('details');
        store.setUi({ detailsSubTab: 'cost' });
        await new Promise(resolve => requestAnimationFrame(resolve));

        const byTheme = [];
        for (const theme of ['dark', 'light']) {
            document.documentElement.dataset.theme = theme;
            await new Promise(resolve => requestAnimationFrame(resolve));

            let duringPrint = null;
            let withoutQuantity = null;
            printWithDetailsMode(
                () => {
                    const table = document.querySelector('.details-table-cost');
                    const wrap = document.querySelector('.details-table-wrap');
                    const main = document.querySelector('.app-main');
                    const rootCause = document.querySelector('.root-cause-report, .root-cause-modal-body');
                    const quantitySummary = document.querySelector('.details-quantity-print-summary');
                    const vendorHeader = [...document.querySelectorAll('.details-table-cost thead th')]
                        .find(th => th.textContent.trim() === 'Поставщик');
                    const tableStyle = getComputedStyle(table);
                    const vendorStyle = getComputedStyle(vendorHeader);
                    const wrapStyle = getComputedStyle(wrap);
                    const mainStyle = getComputedStyle(main);
                    /* 2.22.7: колонки ИТОГО/мес и ИТОГО/год (.col-total) — right-aligned
                       nowrap-числа. Под table-layout:fixed узкая ячейка → 8-значный
                       год переполняет её влево и сливается с месяцем. scrollWidth >
                       clientWidth = переполнение (визуальное слияние). Должно быть 0. */
                    const totalCells = [...table.querySelectorAll('.col-total')];
                    const totalCellOverflow = totalCells.reduce(
                        (max, c) => Math.max(max, c.scrollWidth - c.clientWidth), 0);
                    duringPrint = {
                        totalCellOverflow,
                        bodyClass: document.body.className,
                        hasStyle: !!document.getElementById('details-print-page-style'),
                        styleText: document.getElementById('details-print-page-style')?.textContent || '',
                        tableLayout: tableStyle.tableLayout,
                        tableWidth: table.getBoundingClientRect().width,
                        wrapWidth: wrap.getBoundingClientRect().width,
                        mainWidth: main.getBoundingClientRect().width,
                        /* 2.22.5: левый отступ контента Деталей в PDF задаётся padding'ом
                           .app-main (а не @page margin) → доступная ширина = content-box. */
                        mainContentWidth: main.clientWidth
                            - parseFloat(mainStyle.paddingLeft) - parseFloat(mainStyle.paddingRight),
                        mainPaddingLeft: parseFloat(mainStyle.paddingLeft),
                        wrapBackground: wrapStyle.backgroundColor,
                        wrapBorderRadius: wrapStyle.borderRadius,
                        wrapBoxShadow: wrapStyle.boxShadow,
                        wrapTransitionDuration: wrapStyle.transitionDuration,
                        tabContain: getComputedStyle(document.querySelector('.tab-pane')).contain,
                        hasRootCause: !!rootCause,
                        rootCauseText: rootCause?.textContent || '',
                        quantitySummaryDisplay: getComputedStyle(quantitySummary).display,
                        quantitySummaryText: quantitySummary.textContent,
                        vendorWidth: vendorHeader.getBoundingClientRect().width,
                        vendorWordBreak: vendorStyle.wordBreak,
                        vendorOverflowWrap: vendorStyle.overflowWrap
                    };
                    window.dispatchEvent(new Event('afterprint'));
                },
                { includeQuantitySummary: true }
            );
            printWithDetailsMode(
                () => {
                    const quantitySummary = document.querySelector('.details-quantity-print-summary');
                    withoutQuantity = {
                        bodyClass: document.body.className,
                        quantitySummaryDisplay: getComputedStyle(quantitySummary).display
                    };
                    window.dispatchEvent(new Event('afterprint'));
                },
                { includeQuantitySummary: false }
            );
            byTheme.push({
                theme,
                duringPrint,
                withoutQuantity,
                afterClass: document.body.className,
                afterStyleExists: !!document.getElementById('details-print-page-style')
            });
        }

        return {
            byTheme
        };
    });

    expect(snapshot.byTheme.map(item => item.theme)).toEqual(['dark', 'light']);
    for (const themeSnapshot of snapshot.byTheme) {
        const { duringPrint, withoutQuantity } = themeSnapshot;
        expect(duringPrint.bodyClass).toContain('printing-details');
        expect(duringPrint.hasStyle).toBe(true);
        expect(duringPrint.styleText).toContain('A4 landscape');
        expect(duringPrint.tableLayout).toBe('fixed');
        expect(duringPrint.tabContain).toBe('none');
        // Таблица заполняет доступную (content-box) ширину .app-main; с 2.22.5
        // .app-main имеет левый/правый padding для отступа контента от края листа.
        expect(duringPrint.tableWidth).toBeGreaterThan(duringPrint.mainContentWidth * 0.98);
        expect(duringPrint.wrapWidth).toBeGreaterThan(duringPrint.mainContentWidth * 0.98);
        expect(duringPrint.mainPaddingLeft).toBeGreaterThan(20);
        // Колонки ИТОГО/мес и ИТОГО/год не должны переполняться (числа не сливаются).
        expect(duringPrint.totalCellOverflow).toBeLessThanOrEqual(1);
        expect(duringPrint.wrapBackground).toBe('rgb(255, 255, 255)');
        expect(duringPrint.wrapBorderRadius).toBe('0px');
        expect(duringPrint.wrapBoxShadow).toBe('none');
        expect(duringPrint.wrapTransitionDuration).toBe('0s');
        expect(duringPrint.hasRootCause).toBe(false);
        expect(duringPrint.rootCauseText).not.toContain('Анализ факторов');
        expect(duringPrint.quantitySummaryDisplay).toBe('block');
        expect(duringPrint.quantitySummaryText).toContain('Почему столько? Проверка количества ЭК');
        expect(withoutQuantity.bodyClass).toContain('printing-details-no-quantity-summary');
        expect(withoutQuantity.quantitySummaryDisplay).toBe('none');
        expect(duringPrint.vendorWidth).toBeGreaterThan(60);
        expect(duringPrint.vendorWordBreak).toBe('keep-all');
        expect(duringPrint.vendorOverflowWrap).toBe('normal');
        expect(themeSnapshot.afterClass).not.toContain('printing-details');
        expect(themeSnapshot.afterStyleExists).toBe(false);
    }

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
        const mainStyle = getComputedStyle(main);
        return {
            bodyClass: document.body.className,
            hasStyle: !!document.getElementById('details-print-page-style'),
            styleText: document.getElementById('details-print-page-style')?.textContent || '',
            tableLayout: getComputedStyle(table).tableLayout,
            tableWidth: table.getBoundingClientRect().width,
            wrapWidth: wrap.getBoundingClientRect().width,
            mainWidth: main.getBoundingClientRect().width,
            mainContentWidth: main.clientWidth
                - parseFloat(mainStyle.paddingLeft) - parseFloat(mainStyle.paddingRight),
            mainPaddingLeft: parseFloat(mainStyle.paddingLeft)
        };
    });

    expect(snapshot.bodyClass).toContain('printing-details');
    expect(snapshot.hasStyle).toBe(true);
    expect(snapshot.styleText).toContain('A4 landscape');
    expect(snapshot.tableLayout).toBe('fixed');
    // Таблица заполняет content-box .app-main; левый отступ контента в PDF (2.22.5).
    expect(snapshot.tableWidth).toBeGreaterThan(snapshot.mainContentWidth * 0.98);
    expect(snapshot.wrapWidth).toBeGreaterThan(snapshot.mainContentWidth * 0.98);
    expect(snapshot.mainPaddingLeft).toBeGreaterThan(20);

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
        const mainStyle = getComputedStyle(main);
        return {
            bodyClass: document.body.className,
            tableLayout: getComputedStyle(table).tableLayout,
            tableWidth: table.getBoundingClientRect().width,
            wrapWidth: wrap.getBoundingClientRect().width,
            mainWidth: main.getBoundingClientRect().width,
            mainContentWidth: main.clientWidth
                - parseFloat(mainStyle.paddingLeft) - parseFloat(mainStyle.paddingRight),
            mainPaddingLeft: parseFloat(mainStyle.paddingLeft)
        };
    });

    expect(qtySnapshot.bodyClass).toContain('printing-details');
    expect(qtySnapshot.tableLayout).toBe('fixed');
    // Таблица заполняет content-box .app-main; левый отступ контента в PDF (2.22.5).
    expect(qtySnapshot.tableWidth).toBeGreaterThan(qtySnapshot.mainContentWidth * 0.98);
    expect(qtySnapshot.wrapWidth).toBeGreaterThan(qtySnapshot.mainContentWidth * 0.98);
    expect(qtySnapshot.mainPaddingLeft).toBeGreaterThan(20);
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await expect.poll(() => page.evaluate(() => document.body.classList.contains('printing-details'))).toBe(false);

    await page.emulateMedia({ media: 'screen' });
    expect(consoleErrors).toEqual([]);
});

test('Details AI summary hides no-budget rows and prints readable on dark theme', async ({ page }) => {
    const consoleErrors = await bootCleanApp(page);

    await createCalculationFromQuickStart(page, {
        name: 'Details AI summary print',
        presetId: 'high_ai'
    });
    await page.evaluate(async () => {
        const calcCtl = await import(new URL('js/controllers/calcController.js', document.baseURI).href);
        calcCtl.setAnswer('ai_requests_per_user_day', 0);
        calcCtl.setAnswer('ai_agent_mode', false);
    });

    await clickSidebarTab(page, 'details');
    await page.getByRole('button', { name: 'Объём (qty)' }).click();
    await expect(page.locator('.details-ai-summary')).toBeVisible();

    const cpuAgentsRow = page
        .locator('.details-ai-summary-table tbody tr')
        .filter({ hasText: 'CPU агентов' });
    const tokensRow = page
        .locator('.details-ai-summary-table tbody tr')
        .filter({ hasText: 'Токены' });
    await expect(cpuAgentsRow).toBeVisible();
    await expect(tokensRow).toBeVisible();
    await page.locator('.details-hide-zero').click();
    await expect(cpuAgentsRow).toHaveCount(0);
    await expect(tokensRow).toHaveCount(0);
    await expect(page.locator('.details-ai-summary-table tbody tr')).toHaveCount(2);
    await expect(page.locator('.details-ai-summary-table tbody')).toContainText('RAG-индекс');
    await expect(page.locator('.details-ai-summary-table tbody')).toContainText('Эмбеддинги');
    await expect(page.locator('.details-ai-summary-table tbody tr').first()).toBeVisible();

    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await page.emulateMedia({ media: 'print' });
    const snapshot = await page.evaluate(async () => {
        window.dispatchEvent(new Event('beforeprint'));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

        const summary = document.querySelector('.details-ai-summary');
        const title = summary?.querySelector('.details-ai-summary-title');
        const note = summary?.querySelector('.details-ai-summary-note');
        const totalCell = summary?.querySelector('.details-ai-cell-total');
        const rows = Array.from(summary?.querySelectorAll('tbody tr') || [])
            .map(row => row.textContent.trim());
        const summaryStyle = getComputedStyle(summary);

        return {
            bodyClass: document.body.className,
            rows,
            background: summaryStyle.backgroundColor,
            borderColor: summaryStyle.borderTopColor,
            titleColor: getComputedStyle(title).color,
            noteColor: getComputedStyle(note).color,
            totalColor: getComputedStyle(totalCell).color,
            text: summary?.textContent || ''
        };
    });

    expect(snapshot.bodyClass).toContain('printing-details');
    expect(snapshot.rows.length).toBeGreaterThan(0);
    expect(snapshot.text).toContain('Сводка AI-метрик');
    expect(snapshot.text).not.toContain('Токены');
    expect(snapshot.text).not.toContain('CPU агентов');
    expect(snapshot.background).toBe('rgb(255, 255, 255)');
    expect(snapshot.titleColor).toBe('rgb(0, 0, 0)');
    expect(snapshot.noteColor).toBe('rgb(0, 0, 0)');
    expect(snapshot.totalColor).toBe('rgb(0, 0, 0)');

    await page.screenshot({
        path: '.playwright-mcp/details-ai-summary-print.png',
        fullPage: true
    });
    const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true });
    const mediaBox = pdf.toString('latin1').match(/\/MediaBox\s*\[\s*([^\]]+)\]/)?.[1] || '';
    const [, , width, height] = mediaBox.trim().split(/\s+/).map(Number);
    expect(width).toBeGreaterThan(height);
    expect(pdf.length).toBeGreaterThan(10_000);

    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await expect.poll(() => page.evaluate(() => document.body.classList.contains('printing-details'))).toBe(false);

    await page.emulateMedia({ media: 'screen' });
    expect(consoleErrors).toEqual([]);
});

test('Questionnaire PDF print renders extended answers as readable landscape document', async ({ page }) => {
    await page.addInitScript(() => {
        window.__printCalls = [];
        window.print = () => {
            const area = document.getElementById('print-answers-area');
            window.__printCalls.push({
                bodyClass: document.body.className,
                text: area?.textContent || ''
            });
        };
    });
    const consoleErrors = await bootCleanApp(page);

    await createCalculationFromQuickStart(page, {
        name: 'Questionnaire PDF validation',
        presetId: 'high_ai'
    });

    await page.evaluate(async () => {
        const { printAnswers } = await import(new URL('js/ui/printAnswers.js', document.baseURI).href);
        const { store } = await import(new URL('js/state/store.js', document.baseURI).href);
        printAnswers(store.getState().activeCalc, { extended: true, landscape: true });
    });
    await expect.poll(() => page.evaluate(() => window.__printCalls?.length || 0)).toBe(1);

    await page.emulateMedia({ media: 'print' });
    const snapshot = await page.evaluate(() => {
        const area = document.getElementById('print-answers-area');
        const answerCell = area?.querySelector('.pa-a-cell');
        const explanationCell = area?.querySelector('.pa-x-cell');
        const groupCell = area?.querySelector('.pa-group-label');
        const answerHeader = area?.querySelector('.pa-th-a');
        const explanationHeader = area?.querySelector('.pa-th-x');
        const settingsAnswerCells = Array.from(area?.querySelectorAll('.pa-settings-tbody .pa-a-cell') || []);
        const settingsExplanationCells = Array.from(area?.querySelectorAll('.pa-settings-tbody .pa-x-cell') || []);
        const answerHeaderLeft = answerHeader?.getBoundingClientRect().left ?? 0;
        const explanationHeaderLeft = explanationHeader?.getBoundingClientRect().left ?? 0;
        const answerDrifts = settingsAnswerCells.map(cell =>
            Math.abs(cell.getBoundingClientRect().left - answerHeaderLeft));
        const explanationDrifts = settingsExplanationCells.map(cell =>
            Math.abs(cell.getBoundingClientRect().left - explanationHeaderLeft));
        const areaStyle = getComputedStyle(area);
        const answerStyle = getComputedStyle(answerCell);
        const explanationStyle = getComputedStyle(explanationCell);
        const groupStyle = getComputedStyle(groupCell);
        return {
            bodyClass: document.body.className,
            text: area?.textContent || '',
            rowCount: area?.querySelectorAll('.pa-row').length || 0,
            background: areaStyle.backgroundColor,
            color: areaStyle.color,
            answerColor: answerStyle.color,
            explanationColor: explanationStyle.color,
            groupBackground: groupStyle.backgroundColor,
            settingsAnswerMaxDrift: answerDrifts.length ? Math.max(...answerDrifts) : Number.POSITIVE_INFINITY,
            settingsExplanationMaxDrift: explanationDrifts.length ? Math.max(...explanationDrifts) : Number.POSITIVE_INFINITY,
            hasOverflow: area ? area.scrollWidth > area.clientWidth + 2 : true
        };
    });

    expect(snapshot.bodyClass).toContain('printing-answers');
    expect(snapshot.bodyClass).toContain('printing-answers-extended');
    expect(snapshot.text).toContain('Анкета бизнес-заказчика');
    expect(snapshot.text).toContain('Questionnaire PDF validation');
    expect(snapshot.text).toContain('Пояснение');
    expect(snapshot.text).toContain('Параметры расчёта');
    expect(snapshot.rowCount).toBeGreaterThan(50);
    expect(snapshot.background).toBe('rgb(255, 255, 255)');
    expect(snapshot.color).toBe('rgb(0, 0, 0)');
    expect(snapshot.answerColor).toBe('rgb(0, 0, 0)');
    expect(snapshot.explanationColor).toBe('rgb(68, 68, 68)');
    expect(snapshot.groupBackground).toBe('rgb(246, 246, 246)');
    expect(snapshot.settingsAnswerMaxDrift).toBeLessThanOrEqual(2);
    expect(snapshot.settingsExplanationMaxDrift).toBeLessThanOrEqual(2);
    expect(snapshot.hasOverflow).toBe(false);

    await page.screenshot({
        path: '.playwright-mcp/questionnaire-print-extended.png',
        fullPage: true
    });
    const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true });
    const mediaBox = pdf.toString('latin1').match(/\/MediaBox\s*\[\s*([^\]]+)\]/)?.[1] || '';
    const [, , width, height] = mediaBox.trim().split(/\s+/).map(Number);
    expect(width).toBeGreaterThan(height);
    expect(pdf.length).toBeGreaterThan(20_000);

    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await expect(page.locator('#print-answers-area')).toHaveCount(0);

    await page.emulateMedia({ media: 'screen' });
    expect(consoleErrors).toEqual([]);
});

test('Questionnaire PDF print keeps settings answers aligned in compact mode', async ({ page }) => {
    await page.addInitScript(() => {
        window.__printCalls = [];
        window.print = () => {
            const area = document.getElementById('print-answers-area');
            window.__printCalls.push({
                bodyClass: document.body.className,
                text: area?.textContent || ''
            });
        };
    });
    const consoleErrors = await bootCleanApp(page);

    await createCalculationFromQuickStart(page, {
        name: 'Questionnaire settings alignment',
        presetId: 'high_ai'
    });

    await page.evaluate(async () => {
        const { printAnswers } = await import(new URL('js/ui/printAnswers.js', document.baseURI).href);
        const { store } = await import(new URL('js/state/store.js', document.baseURI).href);
        printAnswers(store.getState().activeCalc, { extended: false, landscape: true });
    });
    await expect.poll(() => page.evaluate(() => window.__printCalls?.length || 0)).toBe(1);

    await page.emulateMedia({ media: 'print' });
    const geometry = await page.evaluate(() => {
        const area = document.getElementById('print-answers-area');
        const table = area?.querySelector('.pa-table');
        const mainAnswerHeader = table?.querySelector('.pa-th-a');
        const settingsAnswerCells = Array.from(table?.querySelectorAll('.pa-settings-tbody .pa-a-cell') || []);
        const tableRect = table?.getBoundingClientRect();
        const headerRect = mainAnswerHeader?.getBoundingClientRect();
        const answerRects = settingsAnswerCells.map(cell => cell.getBoundingClientRect());
        const drifts = answerRects.map(rect => Math.abs(rect.left - headerRect.left));
        return {
            bodyClass: document.body.className,
            text: area?.textContent || '',
            mainAnswerLeft: headerRect?.left ?? 0,
            settingsAnswerLefts: answerRects.map(rect => rect.left),
            maxDrift: drifts.length ? Math.max(...drifts) : Number.POSITIVE_INFINITY,
            answerColumnStartsAfterHalf: tableRect
                ? answerRects.every(rect => rect.left >= tableRect.left + tableRect.width * 0.55)
                : false,
            hasOverflow: area ? area.scrollWidth > area.clientWidth + 2 : true
        };
    });

    expect(geometry.bodyClass).toContain('printing-answers');
    expect(geometry.bodyClass).not.toContain('printing-answers-extended');
    expect(geometry.text).toContain('Параметры расчёта');
    expect(geometry.settingsAnswerLefts.length).toBeGreaterThan(5);
    expect(geometry.maxDrift).toBeLessThanOrEqual(2);
    expect(geometry.answerColumnStartsAfterHalf).toBe(true);
    expect(geometry.hasOverflow).toBe(false);

    await page.screenshot({
        path: '.playwright-mcp/questionnaire-print-settings-alignment.png',
        fullPage: true
    });
    const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true });
    const mediaBox = pdf.toString('latin1').match(/\/MediaBox\s*\[\s*([^\]]+)\]/)?.[1] || '';
    const [, , width, height] = mediaBox.trim().split(/\s+/).map(Number);
    expect(width).toBeGreaterThan(height);
    expect(pdf.length).toBeGreaterThan(15_000);

    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await expect(page.locator('#print-answers-area')).toHaveCount(0);

    await page.emulateMedia({ media: 'screen' });
    expect(consoleErrors).toEqual([]);
});
