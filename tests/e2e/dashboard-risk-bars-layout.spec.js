import { expect, test } from '@playwright/test';
import {
    bootCleanApp,
    createCalculationFromQuickStart
} from './helpers.js';

test.describe.configure({ mode: 'parallel' });

test('Risk contribution composition card stays aligned and non-overlapping', async ({ page }) => {
    const consoleErrors = await bootCleanApp(page);

    await createCalculationFromQuickStart(page, {
        name: 'Risk bars layout contract',
        presetId: 'high_ai'
    });
    await page.evaluate(async () => {
        const calcCtl = await import(new URL('js/controllers/calcController.js', document.baseURI).href);
        calcCtl.setSetting('applyRiskFactors', false);
    });
    await page.getByTestId('dashboard-period-annual').click();
    const riskCard = page.locator('.dash-card-risk:visible').first();
    const riskSegments = riskCard.locator('.dash-risk-segments');
    await expect(riskCard).toBeVisible();
    await expect(riskSegments).toBeVisible();
    await expect.poll(async () => riskSegments.evaluate(node => {
        const container = node.getBoundingClientRect();
        const widths = [...node.querySelectorAll('.dash-risk-segment')]
            .map(seg => seg.getBoundingClientRect().width);
        return container.width > 0 && widths.filter(width => width > 0).length >= 3;
    })).toBe(true);

    const segmentSummary = await riskSegments.evaluate(node => {
        const container = node.getBoundingClientRect();
        const segments = [...node.querySelectorAll('.dash-risk-segment')].map(seg => {
            const rect = seg.getBoundingClientRect();
            return {
                width: Math.round(rect.width * 100) / 100,
                top: Math.round(rect.top * 100) / 100,
                bottom: Math.round(rect.bottom * 100) / 100
            };
        });
        return {
            containerWidth: Math.round(container.width * 100) / 100,
            segments,
            sumWidth: Math.round(segments.reduce((sum, seg) => sum + seg.width, 0) * 100) / 100
        };
    });

    const visibleSegments = segmentSummary.segments.filter(segment => segment.width > 0);
    const visibleWidth = Math.round(visibleSegments.reduce((sum, seg) => sum + seg.width, 0) * 100) / 100;
    expect(visibleSegments.length).toBeGreaterThanOrEqual(3);
    expect(Math.abs(visibleWidth - segmentSummary.containerWidth)).toBeLessThanOrEqual(2);
    for (const segment of visibleSegments) {
        expect(Math.abs(segment.top - visibleSegments[0].top)).toBeLessThanOrEqual(1);
        expect(Math.abs(segment.bottom - visibleSegments[0].bottom)).toBeLessThanOrEqual(1);
    }

    const overflow = await riskCard.locator('.dash-risk-row')
        .evaluateAll(rows => rows.flatMap(row => {
            const cardRect = row.closest('.dash-card-risk').getBoundingClientRect();
            return [...row.querySelectorAll('.dash-risk-row-label, .dash-risk-row-amount, .dash-risk-row-value')]
                .map(node => {
                    const rect = node.getBoundingClientRect();
                    return {
                        text: node.textContent.trim(),
                        left: rect.left,
                        right: rect.right,
                        cardLeft: cardRect.left,
                        cardRight: cardRect.right
                    };
                })
                .filter(rect => rect.left < rect.cardLeft - 1 || rect.right > rect.cardRight + 1);
        }));
    expect(overflow).toEqual([]);

    const collisions = await riskCard.locator('.dash-risk-row')
        .evaluateAll(rows => rows.flatMap(row => {
            const label = row.querySelector('.dash-risk-row-label');
            const amount = row.querySelector('.dash-risk-row-amount');
            const value = row.querySelector('.dash-risk-row-value');
            if (!label || !amount || !value) return [];
            const labelRect = label.getBoundingClientRect();
            const amountRect = amount.getBoundingClientRect();
            const valueRect = value.getBoundingClientRect();
            const sameLineLabelAmount = labelRect.top < amountRect.bottom && labelRect.bottom > amountRect.top;
            const sameLineAmountValue = amountRect.top < valueRect.bottom && amountRect.bottom > valueRect.top;
            const bad = [];
            if (sameLineLabelAmount && amountRect.left - labelRect.right < 8) bad.push('label/amount');
            if (sameLineAmountValue && valueRect.left - amountRect.right < 8) bad.push('amount/value');
            return bad.map(type => ({ type, text: row.textContent.trim() }));
        }));
    expect(collisions).toEqual([]);

    const amountPctLineBreaks = await riskCard.locator('.dash-risk-row')
        .evaluateAll(rows => rows.flatMap(row => {
            const amount = row.querySelector('.dash-risk-row-amount');
            const value = row.querySelector('.dash-risk-row-value');
            if (!amount || !value) return [];
            const amountRect = amount.getBoundingClientRect();
            const valueRect = value.getBoundingClientRect();
            const centerDelta = Math.abs(
                (amountRect.top + amountRect.bottom) / 2 -
                (valueRect.top + valueRect.bottom) / 2
            );
            return centerDelta > 2 ? [{ text: row.textContent.trim(), centerDelta }] : [];
        }));
    expect(amountPctLineBreaks).toEqual([]);

    expect(consoleErrors).toEqual([]);
});

test('Category distribution composition card stays aligned and non-overlapping', async ({ page }) => {
    const consoleErrors = await bootCleanApp(page);

    await createCalculationFromQuickStart(page, {
        name: 'Category composition layout contract',
        presetId: 'high_ai'
    });
    await page.getByTestId('dashboard-period-monthly').click();
    const categoryCard = page.locator('.dash-card-categories:visible').first();
    const categorySegments = categoryCard.locator('.dash-category-segments');
    await expect(categoryCard).toBeVisible();
    await expect(categorySegments).toBeVisible();
    await expect.poll(async () => categorySegments.evaluate(node => {
        const container = node.getBoundingClientRect();
        const widths = [...node.querySelectorAll('.dash-category-segment')]
            .map(seg => seg.getBoundingClientRect().width);
        return container.width > 0 && widths.length >= 4 && widths.every(width => width > 0);
    })).toBe(true);

    const segmentSummary = await categorySegments.evaluate(node => {
        const container = node.getBoundingClientRect();
        const segments = [...node.querySelectorAll('.dash-category-segment')].map(seg => {
            const rect = seg.getBoundingClientRect();
            return {
                width: Math.round(rect.width * 100) / 100,
                top: Math.round(rect.top * 100) / 100,
                bottom: Math.round(rect.bottom * 100) / 100
            };
        });
        return {
            containerWidth: Math.round(container.width * 100) / 100,
            segments,
            sumWidth: Math.round(segments.reduce((sum, seg) => sum + seg.width, 0) * 100) / 100
        };
    });

    expect(segmentSummary.segments.length).toBeGreaterThanOrEqual(4);
    expect(Math.abs(segmentSummary.sumWidth - segmentSummary.containerWidth)).toBeLessThanOrEqual(2);
    for (const segment of segmentSummary.segments) {
        expect(segment.width).toBeGreaterThan(0);
        expect(Math.abs(segment.top - segmentSummary.segments[0].top)).toBeLessThanOrEqual(1);
        expect(Math.abs(segment.bottom - segmentSummary.segments[0].bottom)).toBeLessThanOrEqual(1);
    }

    const overflow = await categoryCard.locator('.dash-category-row')
        .evaluateAll(rows => rows.flatMap(row => {
            const cardRect = row.closest('.dash-card-categories').getBoundingClientRect();
            return [...row.querySelectorAll('.dash-category-row-label, .dash-category-row-value, .dash-category-row-pct')]
                .map(node => {
                    const rect = node.getBoundingClientRect();
                    return {
                        text: node.textContent.trim(),
                        left: rect.left,
                        right: rect.right,
                        cardLeft: cardRect.left,
                        cardRight: cardRect.right
                    };
                })
                .filter(rect => rect.left < rect.cardLeft - 1 || rect.right > rect.cardRight + 1);
        }));
    expect(overflow).toEqual([]);

    const collisions = await categoryCard.locator('.dash-category-row')
        .evaluateAll(rows => rows.flatMap(row => {
            const label = row.querySelector('.dash-category-row-label');
            const amount = row.querySelector('.dash-category-row-value');
            const value = row.querySelector('.dash-category-row-pct');
            if (!label || !amount || !value) return [];
            const labelRect = label.getBoundingClientRect();
            const amountRect = amount.getBoundingClientRect();
            const valueRect = value.getBoundingClientRect();
            const sameLineLabelAmount = labelRect.top < amountRect.bottom && labelRect.bottom > amountRect.top;
            const sameLineAmountValue = amountRect.top < valueRect.bottom && amountRect.bottom > valueRect.top;
            const bad = [];
            if (sameLineLabelAmount && amountRect.left - labelRect.right < 8) bad.push('label/amount');
            if (sameLineAmountValue && valueRect.left - amountRect.right < 8) bad.push('amount/value');
            return bad.map(type => ({ type, text: row.textContent.trim() }));
        }));
    expect(collisions).toEqual([]);

    const amountPctLineBreaks = await categoryCard.locator('.dash-category-row')
        .evaluateAll(rows => rows.flatMap(row => {
            const amount = row.querySelector('.dash-category-row-value');
            const value = row.querySelector('.dash-category-row-pct');
            if (!amount || !value) return [];
            const amountRect = amount.getBoundingClientRect();
            const valueRect = value.getBoundingClientRect();
            const centerDelta = Math.abs(
                (amountRect.top + amountRect.bottom) / 2 -
                (valueRect.top + valueRect.bottom) / 2
            );
            return centerDelta > 2 ? [{ text: row.textContent.trim(), centerDelta }] : [];
        }));
    expect(amountPctLineBreaks).toEqual([]);

    expect(consoleErrors).toEqual([]);
});

test('Dashboard top composition cards keep aligned desktop row', async ({ page }) => {
    await page.setViewportSize({ width: 1680, height: 900 });
    const consoleErrors = await bootCleanApp(page);

    await createCalculationFromQuickStart(page, {
        name: 'Top composition card height contract',
        presetId: 'high_ai'
    });
    await page.getByTestId('dashboard-period-monthly').click();

    const heights = await page.evaluate(() => {
        return ['.dash-card-hero', '.dash-card-categories', '.dash-card-risk'].map(selector => {
            const rect = document.querySelector(selector).getBoundingClientRect();
            return {
                selector,
                top: Math.round(rect.top),
                height: Math.round(rect.height)
            };
        });
    });

    const tops = heights.map(item => item.top);
    const heroHeight = heights.find(item => item.selector === '.dash-card-hero').height;
    const comparisonHeights = heights
        .filter(item => item.selector !== '.dash-card-hero')
        .map(item => item.height);
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(1);
    expect(Math.max(...comparisonHeights) - Math.min(...comparisonHeights)).toBeLessThanOrEqual(2);
    expect(heroHeight).toBeGreaterThanOrEqual(Math.max(...comparisonHeights));

    expect(consoleErrors).toEqual([]);
});

test('Dashboard total resources live inside total card and inactive risk values are struck through', async ({ page }) => {
    await page.setViewportSize({ width: 1680, height: 900 });
    const consoleErrors = await bootCleanApp(page);

    await createCalculationFromQuickStart(page, {
        name: 'Total stack ownership contract',
        presetId: 'high_ai'
    });
    await page.evaluate(async () => {
        const calcCtl = await import(new URL('js/controllers/calcController.js', document.baseURI).href);
        calcCtl.setSetting('applyRiskFactors', false);
    });
    await page.getByTestId('dashboard-period-monthly').click();

    const hero = page.getByTestId('dashboard-hero');
    await expect(hero).toBeVisible();
    await expect(hero.locator('> .dash-dashboard-metrics .dash-resources')).toBeVisible();
    await expect(hero.locator('> .dash-dashboard-metrics .dash-ai-metrics')).toBeVisible();

    const totalLayout = await page.evaluate(() => {
        const heroNode = document.querySelector('.dash-card-hero');
        const hero = heroNode.getBoundingClientRect();
        const costTypes = heroNode.querySelector('.dash-hero-cost-types').getBoundingClientRect();
        const metricsNode = heroNode.querySelector(':scope > .dash-dashboard-metrics');
        const metrics = metricsNode.getBoundingClientRect();
        return {
            metricsIsDirectHeroChild: metricsNode?.parentElement === heroNode,
            metricsInsideHero:
                metrics.left >= hero.left - 1 &&
                metrics.right <= hero.right + 1 &&
                metrics.top >= costTypes.bottom - 1 &&
                metrics.bottom <= hero.bottom + 1,
            heroTop: Math.round(hero.top)
        };
    });
    expect(totalLayout.metricsIsDirectHeroChild).toBe(true);
    expect(totalLayout.metricsInsideHero).toBe(true);

    const readHeroAmountAlignment = () => hero.evaluate(node => {
        const amountNodes = [...node.querySelectorAll(
            '.dash-hero-breakdown-amount, .dash-hero-alt-value, .dash-hero-cost-types .dash-cost-row-amount'
        )].filter(item => {
            const rect = item.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        });
        const rightEdges = amountNodes.map(item => {
            const rect = item.getBoundingClientRect();
            return {
                text: item.textContent.trim(),
                right: Math.round(rect.right * 100) / 100
            };
        });
        const rights = rightEdges.map(item => item.right);
        return {
            rightEdges,
            maxDelta: Math.max(...rights) - Math.min(...rights)
        };
    });
    await expect.poll(async () => {
        const alignment = await readHeroAmountAlignment();
        return alignment.rightEdges.length >= 5 &&
            Number.isFinite(alignment.maxDelta) &&
            alignment.maxDelta <= 2;
    }).toBe(true);
    const heroAmountAlignment = await readHeroAmountAlignment();
    expect(heroAmountAlignment.rightEdges.length).toBeGreaterThanOrEqual(5);
    expect(heroAmountAlignment.maxDelta).toBeLessThanOrEqual(2);

    await expect(page.locator('.dash-card-hero .dash-card-eyebrow-tag')).toContainText('БЕЗ РИСКОВ');
    await expect(page.locator('.dash-card-hero .dash-hero-breakdown-row-risk-potential')).toBeVisible();

    const disabledRiskDecoration = await page.locator('.dash-card-hero .dash-hero-breakdown-row-risk-potential')
        .evaluate(row => Object.fromEntries([
            ['label', '.dash-hero-breakdown-label'],
            ['amount', '.dash-hero-breakdown-amount'],
            ['value', '.dash-hero-breakdown-value']
        ].map(([key, selector]) => {
            const node = row.querySelector(selector);
            const style = getComputedStyle(node);
            return [key, style.textDecorationLine || style.textDecoration || ''];
        })));
    expect(disabledRiskDecoration.label.includes('line-through')).toBe(false);
    expect(disabledRiskDecoration.amount.includes('line-through')).toBe(true);
    expect(disabledRiskDecoration.value.includes('line-through')).toBe(true);

    await page.evaluate(async () => {
        const calcCtl = await import(new URL('js/controllers/calcController.js', document.baseURI).href);
        calcCtl.setSetting('applyRiskFactors', true);
    });
    await expect(page.locator('.dash-card-hero .dash-card-eyebrow-tag')).toContainText('С РИСКАМИ');
    await expect(page.locator('.dash-card-hero .dash-hero-breakdown-row-risk-potential')).toHaveCount(0);

    const enabledRiskDecoration = await page.locator('.dash-card-hero .dash-hero-breakdown-row-risk')
        .evaluate(row => [...row.querySelectorAll(
            '.dash-hero-breakdown-label, .dash-hero-breakdown-amount, .dash-hero-breakdown-value'
        )].map(node => getComputedStyle(node).textDecorationLine || getComputedStyle(node).textDecoration));
    expect(enabledRiskDecoration.every(decoration => !decoration.includes('line-through'))).toBe(true);

    expect(consoleErrors).toEqual([]);
});
