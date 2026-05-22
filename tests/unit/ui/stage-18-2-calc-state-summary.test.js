/**
 * Stage 18.2 — Сводка состояния расчёта (Calculation State Summary).
 *
 * Покрытие:
 *   1. Source-grep: новый файл, экспорты, layer-compliance.
 *   2. Dashboard wiring: 4 старых блока удалены, новый вызывается.
 *   3. Domain helper deriveSummaryState — маппинг verdict + health → green/yellow/red.
 *   4. Domain helper pickTopNextStep — берёт первый из ctx.getActiveNextSteps().
 *   5. CSS: новые .calc-state-summary-* классы присутствуют, старые orphan-классы
 *      удалены.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripJsComments, stripCssComments } from '../../_helpers/source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf-8');

const SUMMARY_SRC   = stripJsComments(read('js/ui/calculationStateSummary.js'));
const DASHBOARD_SRC = stripJsComments(read('js/ui/dashboard.js'));
const DASHBOARD_CSS = stripCssComments(read('css/dashboard.css'));

/* ============================================================
 * 1. Source-grep
 * ============================================================ */

describe('Stage 18.2 — calculationStateSummary.js source', () => {
    it('файл существует', () => {
        assert.equal(existsSync(join(ROOT, 'js/ui/calculationStateSummary.js')), true);
    });

    it('экспортирует renderCalculationStateSummary', () => {
        assert.match(SUMMARY_SRC, /export\s+function\s+renderCalculationStateSummary\s*\(/);
    });

    it('экспортирует deriveSummaryState helper', () => {
        assert.match(SUMMARY_SRC, /export\s+function\s+deriveSummaryState\s*\(/);
    });

    it('импортирует evaluateCalculationReadiness из domain', () => {
        assert.match(SUMMARY_SRC, /from\s*['"]\.\.\/domain\/calculationReadiness\.js['"]/);
    });

    it('импортирует evaluateCalculationHealth из domain', () => {
        assert.match(SUMMARY_SRC, /from\s*['"]\.\.\/domain\/calculationHealth\.js['"]/);
    });

    it('импортирует BUDGET_STATUS из domain', () => {
        assert.match(SUMMARY_SRC, /from\s*['"]\.\.\/domain\/budgetGuardrails\.js['"]/);
    });

    it('читает ctx.getBudgetGuardrailsSummary (presentation-only, не дублирует domain)', () => {
        assert.match(SUMMARY_SRC, /ctx\.getBudgetGuardrailsSummary/);
    });

    it('читает ctx.getActiveNextSteps для top next step', () => {
        assert.match(SUMMARY_SRC, /ctx\.getActiveNextSteps/);
    });
});

/* ============================================================
 * 2. Layer compliance
 * ============================================================ */

describe('Stage 18.2 — layer compliance', () => {
    it('calculationStateSummary.js НЕ импортирует controllers/', () => {
        assert.doesNotMatch(SUMMARY_SRC, /from\s*['"][^'"]*\/controllers\//);
    });

    it('calculationStateSummary.js НЕ импортирует state/', () => {
        assert.doesNotMatch(SUMMARY_SRC, /from\s*['"][^'"]*\/state\//);
    });

    it('calculationStateSummary.js НЕ содержит mutation-style помарок', () => {
        for (const w of ['setAnswer', 'setSetting', 'updateActiveCalc',
            'commit(', 'commitActiveCalc', 'store.update', 'store.openModal']) {
            assert.equal(SUMMARY_SRC.includes(w), false,
                `calculationStateSummary.js содержит mutation-pattern "${w}".`);
        }
    });
});

/* ============================================================
 * 3. Dashboard wiring
 * ============================================================ */

describe('Stage 18.2 — Dashboard wiring', () => {
    it('dashboard.js импортирует renderCalculationStateSummary', () => {
        assert.match(DASHBOARD_SRC,
            /import\s*\{\s*renderCalculationStateSummary\s*\}\s*from\s*['"]\.\/calculationStateSummary\.js['"]/);
    });

    it('dashboard.js вызывает renderCalculationStateSummary(calc, ctx) в renderDashboard', () => {
        assert.match(DASHBOARD_SRC, /renderCalculationStateSummary\s*\(\s*calc\s*,\s*ctx\s*\)/);
    });

    it('dashboard.js больше не импортирует и не вызывает renderHealthBlock', () => {
        assert.doesNotMatch(DASHBOARD_SRC, /renderHealthBlock/);
    });

    it('dashboard.js больше не импортирует и не вызывает renderReadinessBlock', () => {
        assert.doesNotMatch(DASHBOARD_SRC, /renderReadinessBlock/);
    });

    it('dashboard.js больше не импортирует и не вызывает renderBudgetBlock', () => {
        assert.doesNotMatch(DASHBOARD_SRC, /renderBudgetBlock/);
    });

    it('dashboard.js больше не импортирует и не вызывает renderNextSteps', () => {
        assert.doesNotMatch(DASHBOARD_SRC, /renderNextSteps/);
    });

    it('старые UI-файлы удалены', () => {
        assert.equal(existsSync(join(ROOT, 'js/ui/readinessBlock.js')), false);
        assert.equal(existsSync(join(ROOT, 'js/ui/budgetBlock.js')), false);
        assert.equal(existsSync(join(ROOT, 'js/ui/nextSteps.js')), false);
    });
});

/* ============================================================
 * 4. deriveSummaryState contract
 * ============================================================ */

describe('Stage 18.2 — deriveSummaryState маппинг', () => {
    /* Подгружаем helper через __test export. */
    let mod;
    it('helper доступен через named export', async () => {
        mod = await import('../../../js/ui/calculationStateSummary.js');
        assert.equal(typeof mod.deriveSummaryState, 'function');
    });

    it('READY → green', async () => {
        if (!mod) mod = await import('../../../js/ui/calculationStateSummary.js');
        const result = mod.deriveSummaryState(
            { verdict: 'ready', blockers: [], warnings: [] },
            { score: 100, counts: { error: 0, warning: 0 } }
        );
        assert.equal(result, 'green');
    });

    it('EMPTY → red', async () => {
        if (!mod) mod = await import('../../../js/ui/calculationStateSummary.js');
        const result = mod.deriveSummaryState(
            { verdict: 'empty', blockers: [{ id: 'calc_empty' }], warnings: [] },
            { score: 0, counts: {} }
        );
        assert.equal(result, 'red');
    });

    it('NEEDS_CLARIFICATION + health_errors → red', async () => {
        if (!mod) mod = await import('../../../js/ui/calculationStateSummary.js');
        const result = mod.deriveSummaryState(
            { verdict: 'needs_clarification', blockers: [{ id: 'health_errors' }], warnings: [] },
            { score: 40, counts: { error: 2 } }
        );
        assert.equal(result, 'red');
    });

    it('NEEDS_CLARIFICATION + health_score_low → red', async () => {
        if (!mod) mod = await import('../../../js/ui/calculationStateSummary.js');
        const result = mod.deriveSummaryState(
            { verdict: 'needs_clarification', blockers: [{ id: 'health_score_low' }], warnings: [] },
            { score: 50, counts: { error: 0 } }
        );
        assert.equal(result, 'red');
    });

    it('NEEDS_CLARIFICATION + budget_missing → yellow (не severe)', async () => {
        if (!mod) mod = await import('../../../js/ui/calculationStateSummary.js');
        const result = mod.deriveSummaryState(
            { verdict: 'needs_clarification', blockers: [{ id: 'budget_missing' }], warnings: [] },
            { score: 90, counts: { error: 0 } }
        );
        assert.equal(result, 'yellow');
    });

    it('null readiness → red (защитное поведение)', async () => {
        if (!mod) mod = await import('../../../js/ui/calculationStateSummary.js');
        const result = mod.deriveSummaryState(null, { score: 100, counts: {} });
        assert.equal(result, 'red');
    });
});

/* ============================================================
 * 5. pickTopNextStep contract
 * ============================================================ */

describe('Stage 18.2 — pickTopNextStep берёт первый action', () => {
    it('helper доступен через __test', async () => {
        const mod = await import('../../../js/ui/calculationStateSummary.js');
        assert.equal(typeof mod.__test.pickTopNextStep, 'function');
    });

    it('возвращает null если ctx.getActiveNextSteps не функция', async () => {
        const { __test } = await import('../../../js/ui/calculationStateSummary.js');
        assert.equal(__test.pickTopNextStep({}), null);
    });

    it('возвращает null если список пуст', async () => {
        const { __test } = await import('../../../js/ui/calculationStateSummary.js');
        assert.equal(__test.pickTopNextStep({ getActiveNextSteps: () => [] }), null);
    });

    it('возвращает первый элемент', async () => {
        const { __test } = await import('../../../js/ui/calculationStateSummary.js');
        const first = { target: 'decision_memo', title: 'Сформировать memo' };
        const result = __test.pickTopNextStep({
            getActiveNextSteps: () => [first, { target: 'health_check', title: 'Открыть проверку' }]
        });
        assert.deepEqual(result, first);
    });
});

/* ============================================================
 * 6. CSS — новые классы есть, старые orphan удалены
 * ============================================================ */

describe('Stage 18.2 — CSS .calc-state-summary-*', () => {
    it('содержит правило .calc-state-summary', () => {
        assert.match(DASHBOARD_CSS, /\.calc-state-summary\s*\{/);
    });

    it('содержит .calc-state-summary-header', () => {
        assert.match(DASHBOARD_CSS, /\.calc-state-summary-header\s*\{/);
    });

    it('содержит .calc-state-summary-badges и .calc-state-summary-badge', () => {
        assert.match(DASHBOARD_CSS, /\.calc-state-summary-badges\s*\{/);
        assert.match(DASHBOARD_CSS, /\.calc-state-summary-badge\s*\{/);
    });

    it('содержит палитру badge: -ready, -warning, -danger', () => {
        assert.match(DASHBOARD_CSS, /\.calc-state-summary-badge-ready\s*\{/);
        assert.match(DASHBOARD_CSS, /\.calc-state-summary-badge-warning\s*\{/);
        assert.match(DASHBOARD_CSS, /\.calc-state-summary-badge-danger\s*\{/);
    });

    it('содержит .calc-state-summary-verdict', () => {
        assert.match(DASHBOARD_CSS, /\.calc-state-summary-verdict\s*\{/);
    });

    it('содержит .calc-state-summary-diagnostics + -row', () => {
        assert.match(DASHBOARD_CSS, /\.calc-state-summary-diagnostics\s*\{/);
        assert.match(DASHBOARD_CSS, /\.calc-state-summary-row\s*\{/);
    });

    it('содержит .calc-state-summary-next с per-severity модификаторами', () => {
        assert.match(DASHBOARD_CSS, /\.calc-state-summary-next\s*\{/);
        assert.match(DASHBOARD_CSS, /\.calc-state-summary-next-high/);
        assert.match(DASHBOARD_CSS, /\.calc-state-summary-next-medium/);
    });

    it('старые orphan-классы .readiness-block / .readiness-pill / .readiness-row удалены', () => {
        assert.doesNotMatch(DASHBOARD_CSS, /\.readiness-block\s*\{/);
        assert.doesNotMatch(DASHBOARD_CSS, /\.readiness-pill\s*\{/);
        assert.doesNotMatch(DASHBOARD_CSS, /\.readiness-row\s*\{/);
    });

    it('старый orphan-класс .health-block удалён', () => {
        assert.doesNotMatch(DASHBOARD_CSS, /\.health-block\s*\{/);
        assert.doesNotMatch(DASHBOARD_CSS, /\.health-block-actions\s*\{/);
    });

    it('старый orphan-класс .budget-block удалён', () => {
        assert.doesNotMatch(DASHBOARD_CSS, /\.budget-block\s*\{/);
        assert.doesNotMatch(DASHBOARD_CSS, /\.budget-block-line\s*\{/);
    });

    it('старый orphan-класс .next-steps-block удалён', () => {
        assert.doesNotMatch(DASHBOARD_CSS, /\.next-steps-block\s*\{/);
        assert.doesNotMatch(DASHBOARD_CSS, /\.next-steps-item\s*\{/);
    });

    it('Stage 18.2.x — .calc-state-summary-optimization* присутствует', () => {
        assert.match(DASHBOARD_CSS, /\.calc-state-summary-optimization\s*\{/);
        assert.match(DASHBOARD_CSS, /\.calc-state-summary-optimization-title/);
        assert.match(DASHBOARD_CSS, /\.calc-state-summary-optimization-text/);
        assert.match(DASHBOARD_CSS, /\.calc-state-summary-optimization-cta/);
    });

    it('Stage 18.2.x — старый orphan-класс .cop-teaser удалён', () => {
        // Без комментариев.
        const css = DASHBOARD_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
        assert.doesNotMatch(css, /\.cop-teaser\s*\{/);
        assert.doesNotMatch(css, /\.cop-teaser-cta\s*\{/);
    });
});

/* ============================================================
 * 7. Cost Optimization teaser (Stage 18.2.x)
 * ============================================================ */

describe('Stage 18.2.x — Cost Optimization teaser встроен в composite-сводку', () => {
    it('standalone-файл js/ui/costOptimizationPlanner.js удалён', () => {
        assert.equal(existsSync(join(ROOT, 'js/ui/costOptimizationPlanner.js')), false);
    });

    it('dashboard.js больше не импортирует и не вызывает renderCostOptimizationBlock', () => {
        assert.doesNotMatch(DASHBOARD_SRC, /renderCostOptimizationBlock/);
    });

    it('calculationStateSummary.js импортирует PLAN_TIERS из domain', () => {
        assert.match(SUMMARY_SRC,
            /import\s*\{\s*PLAN_TIERS\s*\}\s*from\s*['"]\.\.\/domain\/costOptimizationPlanner\.js['"]/);
    });

    it('calculationStateSummary.js определяет renderCostOptimizationTeaser', () => {
        assert.match(SUMMARY_SRC, /function\s+renderCostOptimizationTeaser\s*\(/);
    });

    it('teaser использует ctx.openCostOptimizationPlannerModal как CTA', () => {
        assert.match(SUMMARY_SRC, /ctx\?\.openCostOptimizationPlannerModal\?\.\(\)/);
    });

    it('teaser не содержит editor-controls (Apply / Levers / Constraints)', () => {
        // Только в области teaser-функции — берём от заголовка до закрывающего "}".
        const teaserMatch = SUMMARY_SRC.match(/function\s+renderCostOptimizationTeaser[\s\S]*?\n\}\n/);
        assert.ok(teaserMatch, 'teaser-функция должна быть найдена');
        const body = teaserMatch[0];
        assert.equal(body.includes('Применить'), false);
        assert.equal(body.includes('cop-lever'), false);
        assert.equal(body.includes('Constraints'), false);
    });

    it('teaser dedup: source содержит проверку nextStep.target === "cost_optimization_planner"', () => {
        // Source-grep: контракт «если primary next-step ведёт в planner — не
        // рендерим дублирующую CTA-кнопку» зафиксирован в исходнике.
        const teaserMatch = SUMMARY_SRC.match(/function\s+renderCostOptimizationTeaser[\s\S]*?\n\}\n/);
        assert.ok(teaserMatch, 'teaser-функция должна быть найдена');
        const body = teaserMatch[0];
        assert.match(body, /nextStep\?\.target\s*===\s*['"]cost_optimization_planner['"]/,
            'Дедуп должен проверяться по nextStep.target.');
        assert.match(body, /primaryIsPlanner/,
            'helper-флаг primaryIsPlanner должен использоваться для conditional render.');
    });

    it('teaser dedup: при primaryIsPlanner кнопка-actions не рендерится', () => {
        const teaserMatch = SUMMARY_SRC.match(/function\s+renderCostOptimizationTeaser[\s\S]*?\n\}\n/);
        const body = teaserMatch[0];
        // Conditional `primaryIsPlanner ? null : el('div', { class: 'calc-state-summary-optimization-actions' }, ...)`
        assert.match(body, /primaryIsPlanner\s*\?\s*null\s*:\s*el\(\s*['"]div['"],\s*\{\s*class:\s*['"]calc-state-summary-optimization-actions['"]/,
            'При primaryIsPlanner=true должна возвращаться null вместо actions-блока.');
    });
});
