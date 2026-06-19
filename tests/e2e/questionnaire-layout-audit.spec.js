import { expect, test } from '@playwright/test';
import { bootCleanApp, clickSidebarTab, createCalculationFromQuickStart } from './helpers.js';

test.describe.configure({ mode: 'serial' });

const VIEWPORTS = [
    { name: 'tablet', width: 1024, height: 768 },
    { name: 'mobile', width: 390, height: 844 }
];

const DESKTOP_ALIGNMENT_VIEWPORT = { name: 'desktop', width: 1800, height: 900 };

async function openExpandedQuestionnaire(page, viewport) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const pageIssues = await bootCleanApp(page);
    await createCalculationFromQuickStart(page, {
        name: `Questionnaire layout ${viewport.name}`,
        presetId: 'high_ai'
    });

    await page.evaluate(async () => {
        const { store } = await import(new URL('js/state/store.js', document.baseURI).href);
        const state = store.getState();
        const sections = Array.from(new Set(
            (state.activeCalc?.dictionaries?.questions || [])
                .map(q => q.section)
                .filter(Boolean)
        ));
        store.setUi({
            questionnaireOpenSections: sections,
            questionnaireSettingsOpen: true,
            questionnaireCollapsedSubgroups: {},
            providerOverlayExpanded: true
        });
    });
    await clickSidebarTab(page, 'questionnaire');
    await expect(page.getByTestId('questionnaire-settings-panel')).toBeVisible();
    await expect(page.locator('.questionnaire-section').first()).toBeVisible();
    await page.waitForTimeout(250);
    return pageIssues;
}

async function collectQuestionnaireLayoutIssues(page) {
    return page.evaluate(() => {
        const tolerance = 2;
        const issue = (type, data) => ({ type, ...data });
        const rectOf = (el) => {
            const r = el.getBoundingClientRect();
            return {
                left: Math.round(r.left * 100) / 100,
                right: Math.round(r.right * 100) / 100,
                top: Math.round(r.top * 100) / 100,
                bottom: Math.round(r.bottom * 100) / 100,
                width: Math.round(r.width * 100) / 100,
                height: Math.round(r.height * 100) / 100
            };
        };
        const labelOf = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
        const isInsideAllowedHorizontalScroller = (el) => {
            const scroller = el.closest('.resource-ratios-table');
            if (!scroller || scroller === el) return false;
            const r = rectOf(scroller);
            return (
                scroller.scrollWidth > scroller.clientWidth + tolerance &&
                r.left >= -tolerance &&
                r.right <= window.innerWidth + tolerance
            );
        };
        const issues = [];

        const docWidth = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0);
        if (docWidth > window.innerWidth + tolerance) {
            issues.push(issue('document-overflow', { docWidth, viewportWidth: window.innerWidth }));
        }

        const selectors = [
            '.settings-panel',
            '.questionnaire-section',
            '.questionnaire-subgroup',
            '.questionnaire-grid',
            '.questionnaire-grid-explicit',
            '.field',
            '.field-label',
            '.field-description',
            '.input',
            'select.input',
            '.percent-input',
            '.switch',
            '.segmented',
            '.multiselect'
        ];

        for (const selector of selectors) {
            document.querySelectorAll(selector).forEach((el, index) => {
                const r = rectOf(el);
                if (r.width <= 0 || r.height <= 0) return;
                if (isInsideAllowedHorizontalScroller(el)) return;
                if (r.left < -tolerance || r.right > window.innerWidth + tolerance) {
                    issues.push(issue('viewport-overflow', { selector, index, rect: r, text: labelOf(el) }));
                }
            });
        }

        document.querySelectorAll('.field').forEach((field, fieldIndex) => {
            const fieldRect = rectOf(field);
            const controls = field.querySelectorAll(':scope > .switch, :scope > .input, :scope > select.input, :scope > .percent-input, :scope > .segmented, :scope > .multiselect');
            controls.forEach((control, controlIndex) => {
                const r = rectOf(control);
                if (r.width <= 0 || r.height <= 0) return;
                if (
                    r.left < fieldRect.left - tolerance ||
                    r.right > fieldRect.right + tolerance ||
                    r.top < fieldRect.top - tolerance ||
                    r.bottom > fieldRect.bottom + tolerance
                ) {
                    issues.push(issue('control-outside-field', {
                        fieldIndex,
                        controlIndex,
                        fieldRect,
                        controlRect: r,
                        text: labelOf(field)
                    }));
                }
            });
        });

        return issues;
    });
}

async function collectQuestionnaireVerticalAlignmentIssues(page) {
    return page.evaluate(() => {
        const tolerance = 3;
        const round = (value) => Math.round(value * 100) / 100;
        const rectOf = (el) => {
            const r = el.getBoundingClientRect();
            return {
                left: round(r.left),
                top: round(r.top),
                right: round(r.right),
                bottom: round(r.bottom),
                width: round(r.width),
                height: round(r.height)
            };
        };
        const labelOf = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
        const directControl = (field) => field.querySelector(
            ':scope > .switch, :scope > .input, :scope > select.input, :scope > .percent-input, :scope > .segmented, :scope > .multiselect'
        );
        const issues = [];

        document.querySelectorAll('.settings-grid, .questionnaire-grid, .questionnaire-grid-explicit').forEach((grid, gridIndex) => {
            const fields = Array.from(grid.children)
                .filter((el) => el.classList?.contains('field'))
                .map((field, fieldIndex) => {
                    const control = directControl(field);
                    if (!control) return null;
                    const fieldRect = rectOf(field);
                    const controlRect = rectOf(control);
                    if (fieldRect.width <= 0 || fieldRect.height <= 0 || controlRect.width <= 0 || controlRect.height <= 0) return null;
                    return {
                        field,
                        fieldIndex,
                        fieldRect,
                        controlRect,
                        text: labelOf(field)
                    };
                })
                .filter(Boolean)
                .sort((a, b) => a.fieldRect.top - b.fieldRect.top || a.fieldRect.left - b.fieldRect.left);

            const rows = [];
            for (const field of fields) {
                let row = rows.find((candidate) => Math.abs(candidate.top - field.fieldRect.top) <= tolerance);
                if (!row) {
                    row = { top: field.fieldRect.top, fields: [] };
                    rows.push(row);
                }
                row.fields.push(field);
            }

            rows.forEach((row, rowIndex) => {
                if (row.fields.length < 2) return;
                const controlTops = row.fields.map((field) => field.controlRect.top);
                const minTop = Math.min(...controlTops);
                const maxTop = Math.max(...controlTops);
                if (maxTop - minTop > tolerance) {
                    issues.push({
                        type: 'row-control-y-misalignment',
                        gridIndex,
                        rowIndex,
                        delta: round(maxTop - minTop),
                        controls: row.fields.map((field) => ({
                            fieldIndex: field.fieldIndex,
                            text: field.text,
                            fieldRect: field.fieldRect,
                            controlRect: field.controlRect
                        }))
                    });
                }
            });
        });

        return issues;
    });
}

for (const viewport of VIEWPORTS) {
    test(`questionnaire layout has no horizontal overflow on ${viewport.name}`, async ({ page }) => {
        const pageIssues = await openExpandedQuestionnaire(page, viewport);
        const layoutIssues = await collectQuestionnaireLayoutIssues(page);

        expect(pageIssues).toEqual([]);
        expect(layoutIssues).toEqual([]);
    });
}

test('questionnaire row controls share the same vertical baseline on desktop', async ({ page }) => {
    const pageIssues = await openExpandedQuestionnaire(page, DESKTOP_ALIGNMENT_VIEWPORT);
    const alignmentIssues = await collectQuestionnaireVerticalAlignmentIssues(page);

    expect(pageIssues).toEqual([]);
    expect(alignmentIssues).toEqual([]);
});
