import { expect } from '@playwright/test';

export async function bootCleanApp(page) {
    const consoleErrors = [];
    page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    await page.addInitScript(() => {
        localStorage.clear();
        sessionStorage.clear();
    });
    await page.goto('./index.html');
    await expect(page.locator('.app-layout')).toBeVisible();
    return consoleErrors;
}

export async function seedCalculations(page) {
    return page.evaluate(async () => {
        const calcCtl = await import(new URL('js/controllers/calcListController.js', document.baseURI).href);
        const { store } = await import(new URL('js/state/store.js', document.baseURI).href);

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

export async function openQuickStart(page) {
    const trigger = page
        .locator('[data-testid="quickstart-open-empty"], [data-testid="quickstart-open-toolbar"]')
        .first();
    await expect(trigger).toBeVisible();
    await trigger.click();
    await expect(page.getByTestId('quickstart-modal')).toBeVisible();
}

export async function createCalculationFromQuickStart(page, {
    name = 'Desktop click flow: B2C AI',
    presetId = 'high_ai',
    provider = null
} = {}) {
    await openQuickStart(page);
    await page.getByTestId('quickstart-name').fill(name);
    await page.getByTestId(`quickstart-preset-${presetId}`).click();
    if (provider) {
        await page.getByTestId('quickstart-provider').selectOption(provider);
    }
    await page.getByTestId('quickstart-submit').click();
    await expect(page.getByTestId('dashboard-grid')).toBeVisible();
}

export async function switchTab(page, tabId) {
    await page.evaluate(async (id) => {
        const { store } = await import(new URL('js/state/store.js', document.baseURI).href);
        store.setActiveTab(id);
    }, tabId);
}

export async function clickSidebarTab(page, tabId) {
    const item = page.getByTestId(`nav-${tabId}`);
    await expect(item).toBeVisible();
    await item.click();
    await expect(item).toHaveAttribute('aria-selected', 'true');
}

export async function expectNoHorizontalOverflow(page, selectors) {
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

export async function getAppStateSummary(page) {
    return page.evaluate(async () => {
        const { store } = await import(new URL('js/state/store.js', document.baseURI).href);
        const state = store.getState();
        const activeCalc = state.activeCalc || null;
        return {
            activeTab: state.activeTab,
            activeCalcId: activeCalc?.id || null,
            activeCalcName: activeCalc?.name || null,
            calcListLength: state.calcList.length,
            calcListNames: state.calcList.map(meta => meta.name),
            scenarioLabels: (activeCalc?.scenarios || []).map(s => s.label),
            activeScenarioId: activeCalc?.activeScenarioId || null
        };
    });
}

export async function getScenarioSummary(page) {
    return page.evaluate(async () => {
        const { store } = await import(new URL('js/state/store.js', document.baseURI).href);
        const calc = store.getState().activeCalc;
        if (!calc) throw new Error('No active calculation');
        const scenarios = Array.isArray(calc.scenarios) ? calc.scenarios : [];
        const activeScenario = scenarios.find(s => s.id === calc.activeScenarioId) || scenarios[0] || null;
        return {
            activeScenarioId: calc.activeScenarioId || activeScenario?.id || null,
            activeScenarioLabel: activeScenario?.label || null,
            scenarioLabels: scenarios.map(s => s.label),
            scenarios: scenarios.map(s => ({ id: s.id, label: s.label }))
        };
    });
}

export async function getProviderOverrideSummary(page, providerId) {
    return page.evaluate(async (pid) => {
        const persist = await import(new URL('js/state/persistence.js', document.baseURI).href);
        const overrides = persist.loadProviderOverrides() || {};
        const override = overrides[pid] || null;
        if (!override) return null;
        const cpu = override.prices?.['cpu-vcpu-shared'] || null;
        return {
            version: override.version,
            providerId: override.providerId,
            cpu: cpu ? {
                pricePerUnit: cpu.pricePerUnit,
                pricePerUnitNet: cpu.pricePerUnitNet,
                pricePerUnitGross: cpu.pricePerUnitGross,
                vatRateIncluded: cpu.vatRateIncluded,
                vatNormalized: cpu.vatNormalized,
                vatPolicyConfidence: cpu.vatPolicyConfidence
            } : null
        };
    }, providerId);
}

export async function getCalculationUiModel(page) {
    return page.evaluate(async () => {
        const { store } = await import(new URL('js/state/store.js', document.baseURI).href);
        const { calculate } = await import(new URL('js/domain/calculator.js', document.baseURI).href);
        const { applyStandFilter } = await import(new URL('js/domain/standsFilter.js', document.baseURI).href);
        const { buildDetailsCategoryOrder } = await import(new URL('js/ui/details.js', document.baseURI).href);
        const { formatRub, formatRubThousands } = await import(new URL('js/services/format.js', document.baseURI).href);
        const {
            CATEGORY_IDS,
            CATEGORY_LABELS,
            DEFAULT_PERIOD,
            MONTHS_PER_YEAR,
            PERIOD_IDS,
            STAND_IDS,
            STAND_LABELS
        } = await import(new URL('js/utils/constants.js', document.baseURI).href);

        const state = store.getState();
        const calc = state.activeCalc;
        if (!calc) throw new Error('No active calculation');

        const period = PERIOD_IDS.includes(state.ui?.dashboardPeriod)
            ? state.ui.dashboardPeriod
            : DEFAULT_PERIOD;
        const disabledStands = calc.view?.disabledStands || [];
        const result = calculate(calc, state.calcRevision);
        const filtered = applyStandFilter(result, disabledStands);

        const pickTotal = (bucket, p) => {
            if (!bucket) return 0;
            if (p === 'daily') return bucket.totalDaily || 0;
            if (p === 'annual') return bucket.totalAnnual || 0;
            return bucket.totalMonthly || 0;
        };
        const periodSlash = (p) => p === 'daily' ? '/ день' : p === 'annual' ? '/ год' : '/ мес';
        const periodMul = (p) => p === 'daily' ? 1 / 30 : p === 'annual' ? MONTHS_PER_YEAR : 1;
        const fmtDash = (value) => formatRubThousands(value, { fractionDigits: 0 });
        const activeStands = STAND_IDS.filter(sid => !disabledStands.includes(sid));

        const dashboardCategories = CATEGORY_IDS
            .filter(cat => (filtered.byCategory?.[cat] || 0) > 0)
            .sort((a, b) => (filtered.byCategory[b] || 0) - (filtered.byCategory[a] || 0))
            .map(cat => {
                const monthly = filtered.byCategory[cat] || 0;
                return {
                    id: cat,
                    label: CATEGORY_LABELS[cat],
                    monthly,
                    valueText: `${fmtDash(monthly * periodMul(period))} ${periodSlash(period)}`
                };
            });

        const dashboardStands = STAND_IDS.slice()
            .sort((a, b) => {
                const aOff = disabledStands.includes(a) ? 1 : 0;
                const bOff = disabledStands.includes(b) ? 1 : 0;
                if (aOff !== bOff) return aOff - bOff;
                return (result.stands?.[b]?.totalMonthly || 0) - (result.stands?.[a]?.totalMonthly || 0);
            })
            .map(sid => ({
                id: sid,
                label: STAND_LABELS[sid],
                disabled: disabledStands.includes(sid),
                valueText: fmtDash(pickTotal(result.stands?.[sid], period)),
                unitText: periodSlash(period)
            }));

        const byCat = Object.fromEntries(CATEGORY_IDS.map(cat => [cat, []]));
        for (const item of calc.dictionaries.items || []) {
            (byCat[item.category] || (byCat[item.category] = [])).push(item);
        }
        const detailsOrder = buildDetailsCategoryOrder(byCat, result, disabledStands);
        const detailsCategories = detailsOrder.map(cat => {
            let monthly = 0;
            for (const item of byCat[cat] || []) {
                const itemResult = result.items?.[item.id];
                if (!itemResult) continue;
                for (const sid of STAND_IDS) {
                    if (disabledStands.includes(sid)) continue;
                    monthly += itemResult.stands?.[sid]?.costFinal || 0;
                }
            }
            return {
                id: cat,
                label: CATEGORY_LABELS[cat],
                monthly,
                annual: monthly * MONTHS_PER_YEAR,
                monthlyText: formatRub(monthly),
                annualText: formatRub(monthly * MONTHS_PER_YEAR)
            };
        });

        return {
            calcName: calc.name,
            settings: {
                applyRiskFactors: calc.settings?.applyRiskFactors !== false,
                vatEnabled: calc.settings?.vatEnabled !== false,
                vatRate: Number(calc.settings?.vatRate) || 0
            },
            period,
            disabledStands,
            activeStands,
            totalMonthly: filtered.totalMonthly,
            dashboard: {
                heroAmount: fmtDash(pickTotal(filtered, period)),
                heroUnit: periodSlash(period),
                categories: dashboardCategories,
                stands: dashboardStands
            },
            details: {
                categories: detailsCategories
            }
        };
    });
}

export async function readDashboardUi(page) {
    return page.evaluate(() => ({
        heroAmount: document.querySelector('.dash-hero-value-amount')?.textContent?.trim() || '',
        heroUnit: document.querySelector('.dash-hero-value-unit')?.textContent?.trim() || '',
        categories: Array.from(document.querySelectorAll('.dash-card-categories .dash-category-row')).map(row => ({
            label: row.querySelector('.dash-category-row-label')?.textContent?.trim() || '',
            valueText: row.querySelector('.dash-category-row-value')?.textContent?.trim() || ''
        })),
        stands: Array.from(document.querySelectorAll('.dash-stand-card')).map(card => ({
            label: card.querySelector('.dash-stand-card-title')?.textContent?.trim() || '',
            disabled: card.classList.contains('dash-stand-card-disabled'),
            valueText: card.querySelector('.dash-stand-card-total-value')?.textContent?.trim() || '',
            unitText: card.querySelector('.dash-stand-card-total-unit')?.textContent?.trim() || ''
        })),
        heroBadges: Array.from(document.querySelectorAll('.dash-card-hero .dash-card-eyebrow-tag, .dash-card-hero .vat-badge'))
            .map(node => node.textContent?.trim() || '')
            .filter(Boolean)
    }));
}

export async function readDetailsCostCategoriesUi(page) {
    return page.locator('.details-table-cost tbody tr.category-row').evaluateAll((nodes) => {
        return nodes.map((row) => {
            const totalCells = row.querySelectorAll('td.col-total');
            return {
                label: row.querySelector('.category-name')?.textContent?.trim() || '',
                monthlyText: totalCells[0]?.textContent?.trim() || '',
                annualText: totalCells[1]?.textContent?.trim() || ''
            };
        });
    });
}

export async function expectDashboardMatchesModel(page) {
    const model = await getCalculationUiModel(page);
    const ui = await readDashboardUi(page);

    expect(ui.heroAmount).toBe(model.dashboard.heroAmount);
    expect(ui.heroUnit).toBe(model.dashboard.heroUnit);
    expect(ui.categories).toEqual(model.dashboard.categories.map(({ label, valueText }) => ({ label, valueText })));
    expect(ui.stands).toEqual(model.dashboard.stands.map(({ label, disabled, valueText, unitText }) => ({
        label,
        disabled,
        valueText,
        unitText
    })));
    return model;
}

export async function expectDetailsCostCategoriesMatchModel(page) {
    const model = await getCalculationUiModel(page);
    const ui = await readDetailsCostCategoriesUi(page);
    expect(ui).toEqual(model.details.categories.map(({ label, monthlyText, annualText }) => ({
        label,
        monthlyText,
        annualText
    })));
    return model;
}
