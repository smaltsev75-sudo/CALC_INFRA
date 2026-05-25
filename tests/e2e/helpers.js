import { expect } from '@playwright/test';

function formatConsoleIssue(msg) {
    const loc = msg.location?.() || {};
    const url = loc.url ? ` @ ${loc.url}` : '';
    const line = loc.lineNumber ? `:${loc.lineNumber}` : '';
    const column = loc.columnNumber ? `:${loc.columnNumber}` : '';
    return `console ${msg.type()}: ${msg.text()}${url}${line}${column}`;
}

function isBrowserResourceConsoleNoise(msg) {
    return msg.type() === 'error' && /^Failed to load resource:/i.test(msg.text());
}

export function attachPageIssueCollector(page) {
    const issues = [];
    page.on('console', (msg) => {
        if (msg.type() === 'error' && !isBrowserResourceConsoleNoise(msg)) {
            issues.push(formatConsoleIssue(msg));
        }
    });
    page.on('pageerror', (err) => issues.push(`pageerror: ${err.message}`));
    page.on('response', (response) => {
        if (response.status() >= 400) {
            issues.push(`HTTP ${response.status()} ${response.statusText()}: ${response.url()}`);
        }
    });
    page.on('requestfailed', (request) => {
        issues.push(`request failed: ${request.failure()?.errorText || 'unknown'}: ${request.url()}`);
    });
    return issues;
}

export async function bootCleanApp(page) {
    const pageIssues = attachPageIssueCollector(page);

    await page.addInitScript(() => {
        localStorage.clear();
        sessionStorage.clear();
    });
    await page.goto('./index.html');
    await expect(page.locator('.app-layout')).toBeVisible();
    return pageIssues;
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

export async function expectNoHorizontalOverflow(page, selectors, { tolerance = 1 } = {}) {
    const overflow = await page.evaluate(({ checkedSelectors, allowedTolerance }) => {
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
                m.scrollWidth > m.clientWidth + allowedTolerance ||
                m.left < -allowedTolerance ||
                m.right > m.viewport + allowedTolerance
            );
    }, { checkedSelectors: selectors, allowedTolerance: tolerance });

    expect(overflow).toEqual([]);
}

export async function expectDocumentHasNoHorizontalOverflow(page, { tolerance = 2 } = {}) {
    const overflow = await page.evaluate((allowedTolerance) => {
        const width = window.innerWidth;
        const docWidth = document.documentElement.scrollWidth;
        const bodyWidth = document.body?.scrollWidth || 0;
        const maxWidth = Math.max(docWidth, bodyWidth);
        if (maxWidth <= width + allowedTolerance) return null;
        return { viewport: width, document: docWidth, body: bodyWidth };
    }, tolerance);

    expect(overflow).toBeNull();
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
        const { formatRub, formatRubThousands, percent } = await import(new URL('js/services/format.js', document.baseURI).href);
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
                annualText: formatRub(monthly * MONTHS_PER_YEAR),
                shareText: monthly > 0 && filtered.totalMonthly > 0 ? percent(monthly / filtered.totalMonthly) : '—'
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

export async function getDashboardDetailsConsistencyReport(page) {
    return page.evaluate(async () => {
        const { store } = await import(new URL('js/state/store.js', document.baseURI).href);
        const { calculate } = await import(new URL('js/domain/calculator.js', document.baseURI).href);
        const { applyStandFilter } = await import(new URL('js/domain/standsFilter.js', document.baseURI).href);
        const { SEED_ITEMS } = await import(new URL('js/domain/seed.js', document.baseURI).href);
        const {
            CATEGORY_IDS,
            CATEGORY_LABELS,
            STAND_IDS,
            STAND_LABELS
        } = await import(new URL('js/utils/constants.js', document.baseURI).href);
        const {
            aggregateAiMetrics,
            aggregateResources
        } = await import(new URL('js/ui/dashboardAggregates.js', document.baseURI).href);
        const {
            computeTotalsForItems,
            effectiveQtyForDisplay
        } = await import(new URL('js/ui/detailsSections.js', document.baseURI).href);

        const EPS_RUB = 0.01;
        const EPS_QTY = 0.000001;
        const close = (a, b, eps) => Math.abs((Number(a) || 0) - (Number(b) || 0)) <= eps;
        const issue = (type, message, extra = {}) => ({ type, message, ...extra });
        const issues = [];

        const state = store.getState();
        const calc = state.activeCalc;
        if (!calc) throw new Error('No active calculation');

        const result = calculate(calc, state.calcRevision);
        const disabledStands = calc.view?.disabledStands || [];
        const activeStands = STAND_IDS.filter(sid => !disabledStands.includes(sid));
        const applyRisks = calc.settings?.applyRiskFactors !== false;
        const filtered = applyStandFilter(result, disabledStands);
        const items = calc.dictionaries?.items || [];
        const seedById = new Map(SEED_ITEMS.map(item => [item.id, item]));

        const totals = computeTotalsForItems(items, result, disabledStands);
        if (!close(filtered.totalMonthly, totals.totalMonthly, EPS_RUB)) {
            issues.push(issue('cost-total', 'Dashboard totalMonthly != Details grand total', {
                dashboard: filtered.totalMonthly,
                details: totals.totalMonthly
            }));
        }

        for (const sid of STAND_IDS) {
            const dashboard = result.stands?.[sid]?.totalMonthly || 0;
            const details = totals.stands?.[sid]?.totalMonthly || 0;
            if (!close(dashboard, details, EPS_RUB)) {
                issues.push(issue('cost-stand', `Dashboard stand ${sid} != Details stand total`, {
                    stand: sid,
                    label: STAND_LABELS[sid],
                    dashboard,
                    details
                }));
            }
        }

        const byCategory = Object.fromEntries(CATEGORY_IDS.map(cat => [cat, []]));
        for (const item of items) (byCategory[item.category] || (byCategory[item.category] = [])).push(item);
        for (const cat of CATEGORY_IDS) {
            let details = 0;
            for (const item of byCategory[cat] || []) {
                const itemResult = result.items?.[item.id];
                if (!itemResult) continue;
                for (const sid of activeStands) details += itemResult.stands?.[sid]?.costFinal || 0;
            }
            const dashboard = filtered.byCategory?.[cat] || 0;
            if (!close(dashboard, details, EPS_RUB)) {
                issues.push(issue('cost-category', `Dashboard category ${cat} != Details category total`, {
                    category: cat,
                    label: CATEGORY_LABELS[cat],
                    dashboard,
                    details
                }));
            }

            const dashboardHasCategory = dashboard > 0;
            const detailsVisibleCount = (byCategory[cat] || [])
                .filter(item => {
                    const itemResult = result.items?.[item.id];
                    return activeStands.some(sid => (itemResult?.stands?.[sid]?.costFinal || 0) > 0);
                })
                .length;
            if (dashboardHasCategory && detailsVisibleCount <= 0) {
                issues.push(issue('category-item-count', `Dashboard category ${cat} has money but no Details ЭК rows`, {
                    category: cat,
                    label: CATEGORY_LABELS[cat],
                    dashboard,
                    detailsVisibleCount
                }));
            }
        }

        const detailResource = { total: {}, perStand: {} };
        const detailAi = { total: {}, perStand: {} };
        for (const sid of STAND_IDS) {
            detailResource.perStand[sid] = {};
            detailAi.perStand[sid] = {};
        }
        const addQty = (bucket, label, sid, qty) => {
            if (!label) return;
            bucket.perStand[sid][label] = (bucket.perStand[sid][label] || 0) + qty;
            if (!disabledStands.includes(sid)) {
                bucket.total[label] = (bucket.total[label] || 0) + qty;
            }
        };

        for (const item of items) {
            const seedItem = seedById.get(item.id);
            const resourceLabel = item.dashboardResource ?? seedItem?.dashboardResource;
            const aiLabel = item.dashboardAiMetric ?? seedItem?.dashboardAiMetric;
            if (!resourceLabel && !aiLabel) continue;
            const itemResult = result.items?.[item.id];
            if (!itemResult) continue;
            for (const sid of STAND_IDS) {
                const cell = itemResult.stands?.[sid];
                if (!cell) continue;
                const qty = effectiveQtyForDisplay(cell, applyRisks);
                addQty(detailResource, resourceLabel, sid, qty);
                addQty(detailAi, aiLabel, sid, qty);
            }
        }

        const dashboardResource = aggregateResources(result, items, disabledStands, applyRisks);
        for (const [label, entry] of Object.entries(dashboardResource.total || {})) {
            const dashboard = Number(entry?.qty) || 0;
            const details = Number(detailResource.total[label]) || 0;
            if (!close(dashboard, details, EPS_QTY)) {
                issues.push(issue('qty-resource-total', `Dashboard resource ${label} != Details qty total`, {
                    label,
                    dashboard,
                    details
                }));
            }
        }
        for (const sid of STAND_IDS) {
            for (const [label, entry] of Object.entries(dashboardResource.perStand?.[sid] || {})) {
                const dashboard = Number(entry?.qty) || 0;
                const details = Number(detailResource.perStand?.[sid]?.[label]) || 0;
                if (!close(dashboard, details, EPS_QTY)) {
                    issues.push(issue('qty-resource-stand', `Dashboard resource ${label}/${sid} != Details qty`, {
                        stand: sid,
                        label,
                        dashboard,
                        details
                    }));
                }
            }
        }

        const dashboardAi = aggregateAiMetrics(result, items, disabledStands, applyRisks, calc);
        for (const [label, entry] of Object.entries(dashboardAi.total || {})) {
            const dashboard = Math.round(Number(entry?.qty) || 0);
            const details = Math.round(Number(detailAi.total[label]) || 0);
            if (dashboard !== details) {
                issues.push(issue('qty-ai-total', `Dashboard AI ${label} != Details qty total`, {
                    label,
                    dashboard,
                    details
                }));
            }
        }

        return {
            issues,
            totals: {
                dashboardMonthly: filtered.totalMonthly,
                detailsMonthly: totals.totalMonthly,
                activeStands
            }
        };
    });
}

export async function expectDashboardDetailsConsistency(page) {
    const report = await getDashboardDetailsConsistencyReport(page);
    expect(report.issues).toEqual([]);
    return report;
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
                annualText: totalCells[1]?.textContent?.trim() || '',
                shareText: row.querySelector('td.col-share')?.textContent?.trim() || ''
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
    expect(ui).toEqual(model.details.categories.map(({ label, monthlyText, annualText, shareText }) => ({
        label,
        monthlyText,
        annualText,
        shareText
    })));
    return model;
}
