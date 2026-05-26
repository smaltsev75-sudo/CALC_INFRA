import { expect, test } from '@playwright/test';
import { attachPageIssueCollector } from './helpers.js';

test.describe.configure({ mode: 'parallel' });

test('Diagnostic mode ?diag=1 copies structured local bundle to clipboard', async ({ page }) => {
    const consoleErrors = attachPageIssueCollector(page);
    await page.addInitScript(() => {
        localStorage.clear();
        sessionStorage.clear();
        window.__diagCopiedText = '';
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                writeText: async (text) => {
                    window.__diagCopiedText = String(text);
                }
            }
        });
    });

    await page.goto('./index.html?diag=1');
    await expect(page.locator('.app-layout')).toBeVisible();

    await page.evaluate(async () => {
        const calcList = await import(new URL('js/controllers/calcListController.js', document.baseURI).href);
        const { store } = await import(new URL('js/state/store.js', document.baseURI).href);
        const calc = calcList.createCalcFromWizard('Diagnostic copy contract', {
            product_type: 'b2c',
            industry: 'edtech',
            scale: 'm',
            geography: 'ru',
            provider: 'sbercloud',
            pdn: true,
            activity: 'high',
            ai_used: true
        });
        if (!calc) throw new Error('Failed to create diagnostic calc');
        store.setActiveTab('dashboard');
    });

    await expect(page.getByTestId('dashboard-grid')).toBeVisible();
    await expect(page.getByTestId('header-copy-diagnostics')).toBeVisible();
    await page.getByTestId('header-copy-diagnostics').click();

    await expect.poll(
        () => page.evaluate(() => window.__diagCopiedText || ''),
        { message: 'diagnostic clipboard text should be written' }
    ).not.toBe('');

    const bundle = JSON.parse(await page.evaluate(() => window.__diagCopiedText));
    expect(bundle.schema).toBe('calc-diagnostics-v1');
    expect(bundle.warning).toContain('не отправляет');
    expect(bundle.answers.ai_llm_used).toBe(true);
    expect(bundle.normalizedAnswers.ai_avg_input_tokens).toBeGreaterThan(0);
    expect(bundle.health.score).toEqual(expect.any(Number));
    expect(bundle.aggregateAiMetrics.total.TOKENS.qty).toBeGreaterThan(0);
    expect(bundle.result.items.some(item =>
        item.itemId === 'llm-tokens-input-1m' && item.stands.PROD.qty > 0
    )).toBeTruthy();

    expect(consoleErrors).toEqual([]);
});
