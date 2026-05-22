import { expect, test } from '@playwright/test';
import {
    bootCleanApp,
    clickSidebarTab,
    expectDocumentHasNoHorizontalOverflow,
    expectNoHorizontalOverflow,
    seedCalculations
} from './helpers.js';
import { expectElementsDoNotOverlap } from './visual-assertions.js';

test.describe.configure({ mode: 'parallel' });

const DESKTOP_VIEWPORTS = [
    { name: 'compact desktop', width: 1365, height: 768 },
    { name: 'work laptop', width: 1440, height: 900 },
    { name: 'full HD desktop', width: 1920, height: 1080 }
];

async function expectDesktopFrame(page) {
    await expectElementsDoNotOverlap(page, [
        '.app-sidebar',
        '.app-topbar',
        '.app-main'
    ]);
}

async function expectDesktopDocumentFrame(page) {
    await expectDesktopFrame(page);
    await expectDocumentHasNoHorizontalOverflow(page);
}

for (const viewport of DESKTOP_VIEWPORTS) {
    test(`${viewport.name}: core screens keep document-level desktop layout stable`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        const consoleErrors = await bootCleanApp(page);
        await seedCalculations(page);

        await expect(page.locator('.dashboard-grid')).toBeVisible();
        await expect(page.locator('.dash-card-hero')).toBeVisible();
        await expectDesktopDocumentFrame(page);
        await expectNoHorizontalOverflow(page, [
            '.app-topbar',
            '.dashboard-grid',
            '.dash-card-hero',
            '.dash-card-categories'
        ], { tolerance: 6 });

        await clickSidebarTab(page, 'details');
        await expect(page.locator('.details-table-cost')).toBeVisible();
        await expectDesktopFrame(page);

        await clickSidebarTab(page, 'comparison');
        await expect(page.locator('.comparison-table-unified')).toBeVisible();
        await expectDesktopFrame(page);

        await page.evaluate(async () => {
            const { store } = await import(new URL('js/state/store.js', document.baseURI).href);
            store.setActiveTab('questionnaire');
            store.setUi({
                questionnaireSettingsOpen: true,
                providerOverlayExpanded: true
            });
        });
        await expect(page.getByTestId('questionnaire-settings-panel')).toBeVisible();
        await expect(page.locator('.provider-price-summary.is-expanded')).toBeVisible();
        await expectDesktopDocumentFrame(page);
        await expectNoHorizontalOverflow(page, [
            '.provider-price-summary',
            '.provider-price-category-list-dense',
            '.provider-price-row'
        ], { tolerance: 2 });

        expect(consoleErrors).toEqual([]);
    });
}
