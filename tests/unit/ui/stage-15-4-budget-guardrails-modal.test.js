/**
 * Stage 15.4 — Budget Guardrails: UI-источник + интеграция.
 *
 * Source-grep тесты:
 *   1. modal: экспорт + return null + modalShell + title.
 *   2. Регистрация модалки в MODAL_RENDERERS + MODAL_ORDER.
 *   3. state.modals.budgetGuardrails в store.
 *   4. app.js ctx-методы: openBudgetGuardrailsModal, evaluateBudgetGuardrails,
 *                          getBudgetGuardrailsSummary.
 *   5. controller: экспорты + импорт sensitivity-runner.
 *   6. dashboard-блок: budgetBlock.js удалён в Stage 18.2 — состояние бюджета
 *      теперь рендерится внутри композитной «Сводки состояния расчёта»
 *      (calculationStateSummary.js).
 *   7. domain: экспорты getBudgetGap / evaluateBudgetGuardrails / formatBudgetStatus /
 *              BUDGET_STATUS / buildOptimizationHints / rankOptimizationHints.
 *   8. CSS: .budget-block + .budget-status-chip присутствуют в dashboard.css.
 *   9. Layer-compliance: modal не импортирует controllers/state.
 *  10. Layer-compliance: calculationStateSummary.js не импортирует controllers/state.
 *  11. APP_VERSION = 2.8.3 (синхронизация constants.js + package.json).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripCssComments, stripJsComments } from '../../_helpers/source.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.resolve(__dirname, '../../..', rel), 'utf8');

const MODAL_SRC      = stripJsComments(read('js/ui/modals/budgetGuardrailsModal.js'));
const SUMMARY_SRC    = stripJsComments(read('js/ui/calculationStateSummary.js'));
const INDEX_SRC      = stripJsComments(read('js/ui/index.js'));
const STORE_SRC      = stripJsComments(read('js/state/store.js'));
const APP_SRC        = stripJsComments(read('js/app.js'));
const DASHBOARD_SRC  = stripJsComments(read('js/ui/dashboard.js'));
const CONTROLLER_SRC = stripJsComments(read('js/controllers/budgetGuardrailsController.js'));
const DOMAIN_SRC     = stripJsComments(read('js/domain/budgetGuardrails.js'));
const CONSTANTS_SRC  = stripJsComments(read('js/utils/constants.js'));
const DASHBOARD_CSS  = stripCssComments(read('css/dashboard.css'));
const PACKAGE_JSON   = read('package.json');

/* ---------- 1. Модалка ---------- */

describe('Stage 15.4 — budgetGuardrailsModal.js', () => {
    it('экспортирует renderBudgetGuardrailsModal', () => {
        assert.match(MODAL_SRC, /export\s+function\s+renderBudgetGuardrailsModal\s*\(/);
    });

    it('использует modalShell', () => {
        assert.match(MODAL_SRC, /modalShell\s*\(/);
    });

    it('return null если модалка закрыта', () => {
        assert.match(MODAL_SRC, /if\s*\(\s*!m\s*\|\|\s*!m\.open\s*\)\s*return\s+null/);
    });

    it('title содержит «Бюджетные ограничения»', () => {
        assert.match(MODAL_SRC, /Бюджетные ограничения/);
    });

    it('импортирует BUDGET_STATUS из domain/budgetGuardrails', () => {
        assert.match(MODAL_SRC,
            /from\s*['"]\.\.\/\.\.\/domain\/budgetGuardrails\.js['"]/);
    });

    it('рендерит секции CAPEX и OPEX', () => {
        assert.match(MODAL_SRC, /CAPEX/);
        assert.match(MODAL_SRC, /OPEX/);
    });

    it('содержит обработку stale-price предупреждения', () => {
        assert.match(MODAL_SRC, /stale/i);
    });
});

/* ---------- 2. Регистрация модалки ---------- */

describe('Stage 15.4 — модалка зарегистрирована в index.js', () => {
    it('импортирует renderBudgetGuardrailsModal', () => {
        assert.match(INDEX_SRC,
            /import\s*\{\s*renderBudgetGuardrailsModal\s*\}\s*from\s*['"]\.\/modals\/budgetGuardrailsModal\.js['"]/);
    });

    it('включает budgetGuardrails в MODAL_ORDER', () => {
        const m = INDEX_SRC.match(/const\s+MODAL_ORDER\s*=\s*\[([^\]]+)\]/);
        assert.ok(m, 'MODAL_ORDER не найден');
        assert.match(m[1], /['"]budgetGuardrails['"]/);
    });

    it('включает пару [budgetGuardrails, renderBudgetGuardrailsModal] в MODAL_RENDERERS', () => {
        assert.match(INDEX_SRC,
            /\[\s*['"]budgetGuardrails['"]\s*,\s*renderBudgetGuardrailsModal\s*\]/);
    });
});

/* ---------- 3. Store ---------- */

describe('Stage 15.4 — store.modals.budgetGuardrails', () => {
    it('содержит budgetGuardrails: { open: false }', () => {
        assert.match(STORE_SRC, /budgetGuardrails\s*:\s*\{\s*open\s*:\s*false\s*\}/);
    });
});

/* ---------- 4. App.js: ctx методы ---------- */

describe('Stage 15.4 — app.js ctx методы', () => {
    it('содержит openBudgetGuardrailsModal', () => {
        assert.match(APP_SRC, /openBudgetGuardrailsModal\s*\(/);
    });

    it('содержит evaluateBudgetGuardrails', () => {
        assert.match(APP_SRC, /evaluateBudgetGuardrails\s*\(/);
    });

    it('содержит getBudgetGuardrailsSummary', () => {
        assert.match(APP_SRC, /getBudgetGuardrailsSummary\s*\(/);
    });

    it('импортирует budgetGuardrailsController', () => {
        assert.match(APP_SRC,
            /from\s*['"]\.\/controllers\/budgetGuardrailsController\.js['"]/);
    });
});

/* ---------- 5. Controller ---------- */

describe('Stage 15.4 — budgetGuardrailsController.js', () => {
    it('экспортирует openBudgetGuardrailsModal', () => {
        assert.match(CONTROLLER_SRC,
            /export\s+function\s+openBudgetGuardrailsModal\s*\(/);
    });

    it('экспортирует evaluateBudgetGuardrailsForActiveCalc', () => {
        assert.match(CONTROLLER_SRC,
            /export\s+function\s+evaluateBudgetGuardrailsForActiveCalc\s*\(/);
    });

    it('экспортирует getBudgetGuardrailsSummary', () => {
        assert.match(CONTROLLER_SRC,
            /export\s+function\s+getBudgetGuardrailsSummary\s*\(/);
    });

    it('импортирует runSensitivityAnalysis', () => {
        assert.match(CONTROLLER_SRC,
            /runSensitivityAnalysis/);
    });
});

/* ---------- 6. Dashboard wiring (Stage 18.2 — через summary) ---------- */

describe('Stage 18.2 — budget-блок поглощён composite-сводкой', () => {
    it('budgetBlock.js удалён (поглощён calculationStateSummary.js)', () => {
        // Файл больше не должен импортироваться.
        assert.doesNotMatch(DASHBOARD_SRC,
            /from\s*['"]\.\/budgetBlock\.js['"]/);
    });

    it('calculationStateSummary.js использует getBudgetGuardrailsSummary', () => {
        assert.match(SUMMARY_SRC, /getBudgetGuardrailsSummary/);
    });

    it('calculationStateSummary.js использует openBudgetGuardrailsModal как CTA', () => {
        assert.match(SUMMARY_SRC, /openBudgetGuardrailsModal/);
    });

    it('dashboard.js вызывает renderCalculationStateSummary(calc, ctx)', () => {
        assert.match(DASHBOARD_SRC, /renderCalculationStateSummary\s*\(\s*calc\s*,\s*ctx\s*\)/);
    });
});

/* ---------- 7. Domain ---------- */

describe('Stage 15.4 — domain/budgetGuardrails.js', () => {
    it('экспортирует BUDGET_STATUS', () => {
        assert.match(DOMAIN_SRC, /export\s+const\s+BUDGET_STATUS/);
    });

    it('экспортирует getBudgetGap', () => {
        assert.match(DOMAIN_SRC, /export\s+function\s+getBudgetGap\s*\(/);
    });

    it('экспортирует buildOptimizationHints', () => {
        assert.match(DOMAIN_SRC, /export\s+function\s+buildOptimizationHints\s*\(/);
    });

    it('экспортирует rankOptimizationHints', () => {
        assert.match(DOMAIN_SRC, /export\s+function\s+rankOptimizationHints\s*\(/);
    });

    it('экспортирует evaluateBudgetGuardrails', () => {
        assert.match(DOMAIN_SRC, /export\s+function\s+evaluateBudgetGuardrails\s*\(/);
    });

    it('экспортирует formatBudgetStatus', () => {
        assert.match(DOMAIN_SRC, /export\s+function\s+formatBudgetStatus\s*\(/);
    });

    it('импортирует calculate из calculator', () => {
        assert.match(DOMAIN_SRC, /from\s*['"]\.\/calculator\.js['"]/);
    });
});

/* ---------- 8. CSS ---------- */

describe('Stage 15.4 — CSS budget-status-chip (модалка)', () => {
    it('содержит правило .budget-status-chip', () => {
        assert.match(DASHBOARD_CSS, /\.budget-status-chip\s*\{/);
    });

    it('содержит .budget-status-warning + .budget-status-ok', () => {
        assert.match(DASHBOARD_CSS, /\.budget-status-warning\s*\{/);
        assert.match(DASHBOARD_CSS, /\.budget-status-ok\s*\{/);
    });

    it('содержит правило .budget-section', () => {
        assert.match(DASHBOARD_CSS, /\.budget-section\s*\{/);
    });

    it('содержит правило .budget-hint-card', () => {
        assert.match(DASHBOARD_CSS, /\.budget-hint-card\s*\{/);
    });

    it('Stage 18.2 — `.budget-block` удалён (поглощён composite-сводкой)', () => {
        assert.doesNotMatch(DASHBOARD_CSS, /\.budget-block\s*\{/);
    });
});

/* ---------- 9. Layer-compliance: модалка ---------- */

describe('Stage 15.4 — layer compliance: modal', () => {
    it('модалка НЕ импортирует controllers/', () => {
        assert.doesNotMatch(MODAL_SRC, /from\s*['"][^'"]*\/controllers\//);
    });

    it('модалка НЕ импортирует state/', () => {
        assert.doesNotMatch(MODAL_SRC, /from\s*['"][^'"]*\/state\//);
    });
});

/* ---------- 10. Layer-compliance: composite-сводка ---------- */

describe('Stage 18.2 — layer compliance: calculationStateSummary', () => {
    it('calculationStateSummary.js НЕ импортирует controllers/', () => {
        assert.doesNotMatch(SUMMARY_SRC, /from\s*['"][^'"]*\/controllers\//);
    });

    it('calculationStateSummary.js НЕ импортирует state/', () => {
        assert.doesNotMatch(SUMMARY_SRC, /from\s*['"][^'"]*\/state\//);
    });
});

/* ---------- 11. Версия ---------- */

describe('Stage 15.4 — APP_VERSION ≥ 2.8.3 (введено в 2.8.3)', () => {
    // Регулярка `2\.8\.[3-9]` ломалась после bump'а до 2.9.0. Заменено на
    // semver-aware compare — теперь любой future-bump проходит без правки теста.
    it('constants.js содержит APP_VERSION ≥ 2.8.3', () => {
        const m = CONSTANTS_SRC.match(/export\s+const\s+APP_VERSION\s*=\s*['"]([\d.]+)['"]/);
        assert.ok(m, 'APP_VERSION literal не найден');
        const [maj, min, pat] = m[1].split('.').map(n => parseInt(n, 10));
        const ge = (maj > 2) || (maj === 2 && min > 8) || (maj === 2 && min === 8 && pat >= 3);
        assert.ok(ge, `APP_VERSION=${m[1]} < 2.8.3`);
    });

    it('package.json содержит "version" ≥ 2.8.3', () => {
        const m = PACKAGE_JSON.match(/"version"\s*:\s*"([\d.]+)"/);
        assert.ok(m, '"version" literal не найден');
        const [maj, min, pat] = m[1].split('.').map(n => parseInt(n, 10));
        const ge = (maj > 2) || (maj === 2 && min > 8) || (maj === 2 && min === 8 && pat >= 3);
        assert.ok(ge, `package.json version=${m[1]} < 2.8.3`);
    });
});
