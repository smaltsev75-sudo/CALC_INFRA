import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import {
    bootCleanApp,
    clickSidebarTab,
    createCalculationFromQuickStart,
    getAppStateSummary,
    getProviderOverrideSummary,
    getScenarioSummary
} from './helpers.js';

test.describe.configure({ mode: 'parallel' });

test('Desktop import/export/reset flow uses real downloads and file pickers', async ({ page }) => {
    const consoleErrors = await bootCleanApp(page);

    await createCalculationFromQuickStart(page, {
        name: 'Desktop IO: original',
        presetId: 'high_ai'
    });

    const calcDownloadPromise = page.waitForEvent('download');
    await page.getByTestId('header-export-json').click();
    const calcDownload = await calcDownloadPromise;
    const calcPath = await calcDownload.path();
    const exportedCalc = JSON.parse(await readFile(calcPath, 'utf8'));
    expect(exportedCalc.name).toBe('Desktop IO: original');
    expect(exportedCalc.id).toBeTruthy();

    const importChooserPromise = page.waitForEvent('filechooser');
    await page.getByTestId('header-import-json').click();
    const importChooser = await importChooserPromise;
    await importChooser.setFiles(calcPath);

    await expect(page.getByTestId('duplicate-import-modal')).toBeVisible();
    await page.getByTestId('duplicate-import-clone').click();
    await expect.poll(async () => (await getAppStateSummary(page)).calcListLength).toBe(2);

    await page.getByTestId('header-reset').click();
    await expect(page.getByTestId('reset-modal')).toBeVisible();
    await page.getByTestId('reset-confirm').click();
    await expect(page.getByTestId('quickstart-open-empty')).toBeVisible();
    await expect.poll(async () => (await getAppStateSummary(page)).calcListLength).toBe(0);

    expect(consoleErrors).toEqual([]);
});

test('Desktop bundle export/import restores all calculations after reset', async ({ page }) => {
    const consoleErrors = await bootCleanApp(page);

    await createCalculationFromQuickStart(page, {
        name: 'Desktop bundle: primary',
        presetId: 'high_ai'
    });
    await clickSidebarTab(page, 'calculations');
    await createCalculationFromQuickStart(page, {
        name: 'Desktop bundle: secondary',
        presetId: 'std_b2b'
    });

    await clickSidebarTab(page, 'calculations');
    await expect.poll(async () => (await getAppStateSummary(page)).calcListLength).toBe(2);

    const bundleDownloadPromise = page.waitForEvent('download');
    await page.getByTestId('bundle-export').click();
    const bundleDownload = await bundleDownloadPromise;
    const bundlePath = await bundleDownload.path();
    const exportedBundle = JSON.parse(await readFile(bundlePath, 'utf8'));
    expect(exportedBundle.version).toMatch(/^bundle-/);
    expect(exportedBundle.calculations).toHaveLength(2);

    await page.getByTestId('header-reset').click();
    await page.getByTestId('reset-confirm').click();
    await expect.poll(async () => (await getAppStateSummary(page)).calcListLength).toBe(0);

    const bundleImportChooserPromise = page.waitForEvent('filechooser');
    await page.getByTestId('bundle-import').click();
    const bundleImportChooser = await bundleImportChooserPromise;
    await bundleImportChooser.setFiles(bundlePath);

    await expect.poll(async () => (await getAppStateSummary(page)).calcListLength).toBe(2);
    const state = await getAppStateSummary(page);
    expect(state.calcListNames).toEqual(expect.arrayContaining([
        'Desktop bundle: primary',
        'Desktop bundle: secondary'
    ]));

    expect(consoleErrors).toEqual([]);
});

test('Desktop scenario tabs support add, rename, duplicate, switch and delete by clicks', async ({ page }) => {
    const consoleErrors = await bootCleanApp(page);

    await createCalculationFromQuickStart(page, {
        name: 'Desktop scenarios: CRUD',
        presetId: 'high_ai'
    });

    await expect(page.getByTestId('scenario-tabs')).toBeVisible();
    await page.getByTestId('scenario-add').click();
    await expect(page.getByTestId('scenario-rename-modal')).toBeVisible();
    await page.getByTestId('scenario-rename-input').fill('С GPU');
    await page.getByTestId('scenario-rename-submit').click();
    await expect.poll(async () => (await getScenarioSummary(page)).activeScenarioLabel).toBe('С GPU');

    let scenarios = await getScenarioSummary(page);
    const gpuId = scenarios.scenarios.find(s => s.label === 'С GPU')?.id;
    expect(gpuId).toBeTruthy();

    await page.getByTestId(`scenario-tab-menu-${gpuId}`).click();
    await expect(page.getByTestId('scenario-menu-modal')).toBeVisible();
    await page.getByTestId('scenario-menu-duplicate').click();
    await expect(page.getByTestId('scenario-duplicate-modal')).toBeVisible();
    await page.getByTestId('scenario-duplicate-input').fill('С GPU копия');
    await page.getByTestId('scenario-duplicate-submit').click();
    await expect.poll(async () => (await getScenarioSummary(page)).activeScenarioLabel).toBe('С GPU копия');

    scenarios = await getScenarioSummary(page);
    const copyId = scenarios.scenarios.find(s => s.label === 'С GPU копия')?.id;
    expect(copyId).toBeTruthy();

    await page.getByTestId(`scenario-tab-menu-${copyId}`).click();
    await page.getByTestId('scenario-menu-rename').click();
    await expect(page.getByTestId('scenario-rename-modal')).toBeVisible();
    await page.getByTestId('scenario-rename-input').fill('Без AI');
    await page.getByTestId('scenario-rename-submit').click();
    await expect.poll(async () => (await getScenarioSummary(page)).activeScenarioLabel).toBe('Без AI');

    scenarios = await getScenarioSummary(page);
    const baseId = scenarios.scenarios.find(s => s.label === 'Базовый')?.id;
    expect(baseId).toBeTruthy();
    await page.getByTestId(`scenario-tab-body-${baseId}`).click();
    await expect.poll(async () => (await getScenarioSummary(page)).activeScenarioLabel).toBe('Базовый');

    const renamedId = (await getScenarioSummary(page)).scenarios.find(s => s.label === 'Без AI')?.id;
    expect(renamedId).toBeTruthy();
    await page.getByTestId(`scenario-tab-menu-${renamedId}`).click();
    await page.getByTestId('scenario-menu-delete').click();
    await expect(page.getByTestId('confirm-modal')).toBeVisible();
    await page.getByTestId('confirm-submit').click();
    await expect.poll(async () => (await getScenarioSummary(page)).scenarioLabels).not.toContain('Без AI');

    expect(consoleErrors).toEqual([]);
});

test('Desktop provider price import asks VAT policy and stores normalized net prices', async ({ page }, testInfo) => {
    const consoleErrors = await bootCleanApp(page);

    await createCalculationFromQuickStart(page, {
        name: 'Desktop provider VAT import',
        presetId: 'high_ai',
        provider: 'sbercloud'
    });
    await clickSidebarTab(page, 'questionnaire');
    await expect(page.getByTestId('questionnaire-settings-panel')).toBeVisible();
    await page.getByTestId('setting-provider').selectOption('sbercloud');

    const pricePath = testInfo.outputPath('sbercloud-legacy-gross-22.json');
    await writeFile(pricePath, JSON.stringify({
        schemaVersion: 1,
        providerId: 'sbercloud',
        version: 'e2e-vat-legacy-1',
        timestamp: '2026-05-22T00:00:00.000Z',
        source: 'Playwright legacy gross VAT import',
        prices: {
            'cpu-vcpu-shared': {
                pricePerUnit: 1220,
                vendor: 'E2E',
                priceSource: 'Legacy gross 22% fixture'
            },
            'ram-gb': {
                pricePerUnit: 122,
                vendor: 'E2E',
                priceSource: 'Legacy gross 22% fixture'
            }
        }
    }, null, 2), 'utf8');

    const priceChooserPromise = page.waitForEvent('filechooser');
    await page.getByTestId('provider-price-json-import-sbercloud').click();
    const priceChooser = await priceChooserPromise;
    await priceChooser.setFiles(pricePath);

    await expect(page.getByTestId('vat-policy-choice-modal')).toBeVisible();
    await page.getByTestId('vat-policy-gross-22').click();
    await expect.poll(async () => (await getProviderOverrideSummary(page, 'sbercloud'))?.version)
        .toBe('e2e-vat-legacy-1');

    const override = await getProviderOverrideSummary(page, 'sbercloud');
    expect(override.cpu.pricePerUnit).toBeCloseTo(1000, 6);
    expect(override.cpu.pricePerUnitNet).toBeCloseTo(1000, 6);
    expect(override.cpu.pricePerUnitGross).toBe(1220);
    expect(override.cpu.vatRateIncluded).toBe(0.22);
    expect(override.cpu.vatNormalized).toBe(true);
    expect(override.cpu.vatPolicyConfidence).toBe('user-declared');
    await expect(page.locator('[data-testid="provider-update-row-sbercloud"] .provider-update-status--success'))
        .toContainText('e2e-vat-legacy-1');

    expect(consoleErrors).toEqual([]);
});
