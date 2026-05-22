import { expect, test } from '@playwright/test';

test.describe.configure({ mode: 'parallel' });

async function bootCleanApp(page) {
    const consoleErrors = [];
    page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    await page.addInitScript(() => {
        localStorage.clear();
        sessionStorage.clear();
    });
    await page.goto('/index.html');
    await expect(page.locator('.app-layout')).toBeVisible();
    return consoleErrors;
}

async function seedCalculations(page) {
    return page.evaluate(async () => {
        const calcCtl = await import('/js/controllers/calcListController.js');
        const { store } = await import('/js/state/store.js');

        const primary = calcCtl.createCalcFromWizard('Desktop smoke: B2C AI нагрузка', {
            product_type: 'b2c',
            industry: 'consumer',
            scale: 'l',
            geography: 'global',
            provider: 'sbercloud',
            pdn: true,
            activity: 'high',
            ai_used: true
        });
        const secondary = calcCtl.createCalcFromWizard('Desktop smoke: B2B baseline', {
            product_type: 'b2b',
            industry: 'corporate',
            scale: 'm',
            geography: 'ru',
            provider: 'sbercloud',
            pdn: true,
            activity: 'medium',
            ai_used: false
        });
        if (!primary || !secondary) throw new Error('Failed to create smoke calculations');

        calcCtl.openCalc(primary.id);
        store.setComparisonIds([primary.id, secondary.id]);
        store.setActiveTab('dashboard');
        return { primaryId: primary.id, secondaryId: secondary.id };
    });
}

async function expectNoHorizontalOverflow(page, selectors) {
    const overflow = await page.evaluate((checkedSelectors) => {
        return checkedSelectors
            .flatMap((selector) => Array.from(document.querySelectorAll(selector)).map((node, index) => {
                const rect = node.getBoundingClientRect();
                return {
                    selector,
                    index,
                    scrollWidth: node.scrollWidth,
                    clientWidth: node.clientWidth,
                    left: rect.left,
                    right: rect.right,
                    viewport: window.innerWidth
                };
            }))
            .filter((m) =>
                m.scrollWidth > m.clientWidth + 1 ||
                m.left < -1 ||
                m.right > m.viewport + 1
            );
    }, selectors);

    expect(overflow).toEqual([]);
}

async function expectDetailsCategoriesSortedByAnnualTotal(page) {
    const rows = await page.locator('.details-table-cost tbody tr.category-row').evaluateAll((nodes) => {
        const parseRub = (text) => {
            const normalized = String(text || '')
                .replace(/[^\d,.-]/g, '')
                .replace(',', '.');
            const value = Number(normalized);
            return Number.isFinite(value) ? value : 0;
        };
        return nodes.map((row) => {
            const name = row.querySelector('.category-name')?.textContent?.trim() || '';
            const totalCells = row.querySelectorAll('td.col-total');
            return {
                name,
                annual: parseRub(totalCells[1]?.textContent || '')
            };
        });
    });

    expect(rows.length).toBeGreaterThan(1);
    for (let i = 1; i < rows.length; i += 1) {
        expect(
            rows[i - 1].annual,
            `${rows[i - 1].name} must be >= ${rows[i].name} by ИТОГО / год`
        ).toBeGreaterThanOrEqual(rows[i].annual);
    }
}

test('dashboard and cost optimization planner render cleanly on desktop', async ({ page }) => {
    const consoleErrors = await bootCleanApp(page);
    await seedCalculations(page);

    await expect(page.locator('.dashboard-grid')).toBeVisible();
    await expect(page.locator('.dash-card-hero')).toBeVisible();

    await page.evaluate(async () => {
        const plannerCtl = await import('/js/controllers/costOptimizationPlannerController.js');
        plannerCtl.openCostOptimizationPlannerModal();
    });

    await expect(page.locator('.modal .cop-modal-body')).toBeVisible();
    await expect(page.locator('.cop-level-tabs')).toBeVisible();
    await expect(page.locator('.cop-summary-cards')).toBeVisible();
    await page.screenshot({ path: '.playwright-mcp/desktop-smoke-planner.png', fullPage: true });

    await expectNoHorizontalOverflow(page, [
        '.modal',
        '.modal-header',
        '.modal-footer-actions',
        '.cop-modal-footer',
        '.cop-level-tabs',
        '.cop-modal-constraints-grid',
        '.cop-summary-cards',
        '.cop-lever-group-header',
        '.cop-lever-head',
        '.cop-rollback-bar'
    ]);
    expect(consoleErrors).toEqual([]);
});

test('decision memo preview renders markdown tables on desktop', async ({ page }) => {
    const consoleErrors = await bootCleanApp(page);
    await seedCalculations(page);

    await page.evaluate(async () => {
        const memoCtl = await import('/js/controllers/decisionMemoController.js');
        memoCtl.openDecisionMemoModal();
    });

    await expect(page.locator('.decision-memo-preview')).toBeVisible();
    await expect(page.locator('.decision-memo-preview table').first()).toBeVisible();
    await page.screenshot({ path: '.playwright-mcp/desktop-smoke-decision-memo.png', fullPage: true });

    await expectNoHorizontalOverflow(page, [
        '.modal',
        '.modal-header',
        '.modal-footer-actions',
        '.decision-memo-modal-body',
        '.decision-memo-actions',
        '.decision-memo-preview'
    ]);
    expect(consoleErrors).toEqual([]);
});

test('details and comparison desktop tables render with seeded calculations', async ({ page }) => {
    const consoleErrors = await bootCleanApp(page);
    await seedCalculations(page);

    await page.evaluate(async () => {
        const { store } = await import('/js/state/store.js');
        store.setActiveTab('details');
    });
    await expect(page.locator('.details-table-cost')).toBeVisible();
    await expect(page.locator('.details-table-cost tbody tr').first()).toBeVisible();
    await expectDetailsCategoriesSortedByAnnualTotal(page);
    await page.screenshot({ path: '.playwright-mcp/desktop-smoke-details.png', fullPage: true });

    await page.evaluate(async () => {
        const { store } = await import('/js/state/store.js');
        store.setActiveTab('comparison');
    });
    await expect(page.locator('.comparison-table-unified')).toBeVisible();
    await expect(page.locator('.comparison-table-unified tbody tr').first()).toBeVisible();
    await page.screenshot({ path: '.playwright-mcp/desktop-smoke-comparison.png', fullPage: true });

    expect(consoleErrors).toEqual([]);
});
