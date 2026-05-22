/**
 * Stage 15.3 — Sensitivity Analysis: UI-источник + интеграция.
 *
 * Source-grep тесты:
 *   1. js/ui/modals/sensitivityAnalysisModal.js — экспорт + return null + modalShell.
 *   2. Регистрация модалки в MODAL_RENDERERS + MODAL_ORDER.
 *   3. state.modals.sensitivity в store.
 *   4. state.ui.sensitivityFilters в store.
 *   5. ctx.openSensitivityAnalysisModal в app.js.
 *   6. healthChip.js вызывает openSensitivityAnalysisModal.
 *   7. constants.js: SENSITIVITY_CATEGORIES, DEFAULT_SENSITIVITY_FILTERS, STORAGE_KEY.
 *   8. CSS: .sensitivity-driver-card + .sensitivity-modal присутствуют в dashboard.css.
 *   9. domain-импорты из sensitivityAnalysis.js (не из controllers/state).
 *  10. Layer-compliance: modal НЕ импортирует controllers/ или state/.
 *  11. domain/sensitivityAnalysis.js: все 4 функции экспортированы.
 *  12. APP_VERSION синхронизирована с 2.8.2.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripCssComments, stripJsComments } from '../../_helpers/source.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.resolve(__dirname, '../../..', rel), 'utf8');

const MODAL_SRC      = stripJsComments(read('js/ui/modals/sensitivityAnalysisModal.js'));
const INDEX_SRC      = stripJsComments(read('js/ui/index.js'));
const STORE_SRC      = stripJsComments(read('js/state/store.js'));
const APP_SRC        = stripJsComments(read('js/app.js'));
const CHIP_SRC       = stripJsComments(read('js/ui/healthChip.js'));
const CONSTANTS_SRC  = stripJsComments(read('js/utils/constants.js'));
const DOMAIN_SRC     = stripJsComments(read('js/domain/sensitivityAnalysis.js'));
const DASHBOARD_CSS  = stripCssComments(read('css/dashboard.css'));

/* ---------- 1. Модалка ---------- */

describe('Stage 15.3 — sensitivityAnalysisModal.js', () => {
    it('export renderSensitivityAnalysisModal', () => {
        assert.match(MODAL_SRC, /export\s+function\s+renderSensitivityAnalysisModal\s*\(/);
    });

    it('использует modalShell', () => {
        assert.match(MODAL_SRC, /modalShell\s*\(/);
    });

    it('return null если модалка закрыта', () => {
        assert.match(MODAL_SRC, /if\s*\(\s*!m\s*\|\|\s*!m\.open\s*\)\s*return\s+null/);
    });

    it('импортирует из domain/sensitivityAnalysis', () => {
        assert.match(MODAL_SRC, /from\s*['"]\.\.\/\.\.\/domain\/sensitivityAnalysis\.js['"]/);
    });

    it('title содержит «Анализ чувствительности»', () => {
        assert.match(MODAL_SRC, /Анализ чувствительности/);
    });
});

/* ---------- 2. Регистрация модалки ---------- */

describe('Stage 15.3 — модалка зарегистрирована в index.js', () => {
    it('импортирует renderSensitivityAnalysisModal', () => {
        assert.match(INDEX_SRC,
            /import\s*\{\s*renderSensitivityAnalysisModal\s*\}\s*from\s*['"]\.\/modals\/sensitivityAnalysisModal\.js['"]/);
    });

    it('включает sensitivity в MODAL_ORDER', () => {
        const m = INDEX_SRC.match(/const\s+MODAL_ORDER\s*=\s*\[([^\]]+)\]/);
        assert.ok(m, 'MODAL_ORDER не найден');
        assert.match(m[1], /['"]sensitivity['"]/);
    });

    it('включает пару [sensitivity, renderSensitivityAnalysisModal] в MODAL_RENDERERS', () => {
        assert.match(INDEX_SRC,
            /\[\s*['"]sensitivity['"]\s*,\s*renderSensitivityAnalysisModal\s*\]/);
    });
});

/* ---------- 3. Store: modals ---------- */

describe('Stage 15.3 — store.modals.sensitivity', () => {
    it('содержит sensitivity: { open: false }', () => {
        assert.match(STORE_SRC, /sensitivity\s*:\s*\{\s*open\s*:\s*false\s*\}/);
    });
});

/* ---------- 4. Store: ui.sensitivityFilters ---------- */

describe('Stage 15.3 — store.ui.sensitivityFilters', () => {
    it('содержит sensitivityFilters: null в ui', () => {
        assert.match(STORE_SRC, /sensitivityFilters\s*:\s*null/);
    });
});

/* ---------- 5. App.js: ctx методы ---------- */

describe('Stage 15.3 — app.js ctx методы', () => {
    it('содержит openSensitivityAnalysisModal', () => {
        assert.match(APP_SRC, /openSensitivityAnalysisModal\s*\(/);
    });

    it('вызывает store.openModal с sensitivity', () => {
        assert.match(APP_SRC, /store\.openModal\s*\(\s*['"]sensitivity['"]/);
    });

    it('содержит setSensitivityFilters', () => {
        assert.match(APP_SRC, /setSensitivityFilters\s*\(/);
    });
});

/* ---------- 6. calculationStateSummary.js (Stage 17.3 owner) ---------- */

describe('Stage 17.3 — calculationStateSummary.js владеет CTA «Анализ чувствительности»', () => {
    it('TARGET_DISPATCH в calculationStateSummary.js диспатчит sensitivity_analysis', () => {
        const NEXT_STEPS_SRC = stripJsComments(read('js/ui/calculationStateSummary.js'));
        assert.match(NEXT_STEPS_SRC, /openSensitivityAnalysisModal/);
    });
    it('healthChip.js НЕ вызывает openSensitivityAnalysisModal (Stage 17.3 dedup)', () => {
        assert.equal(CHIP_SRC.includes('openSensitivityAnalysisModal'), false,
            'CTA «Анализ чувствительности» должен жить только в Next Steps.');
    });
});

/* ---------- 7. constants.js ---------- */

describe('Stage 15.3 — constants.js', () => {
    it('экспортирует SENSITIVITY_CATEGORIES', () => {
        assert.match(CONSTANTS_SRC, /export\s+const\s+SENSITIVITY_CATEGORIES\s*=/);
    });

    it('экспортирует DEFAULT_SENSITIVITY_FILTERS', () => {
        assert.match(CONSTANTS_SRC, /export\s+const\s+DEFAULT_SENSITIVITY_FILTERS\s*=/);
    });

    it('STORAGE_KEYS содержит SENSITIVITY_FILTERS', () => {
        assert.match(CONSTANTS_SRC, /SENSITIVITY_FILTERS\s*:\s*['"]calc\.sensitivityFilters['"]/);
    });

    it('APP_VERSION в constants.js ≥ 2.8.2', () => {
        const m = CONSTANTS_SRC.match(/APP_VERSION\s*=\s*['"]([\d.]+)['"]/);
        assert.ok(m, 'APP_VERSION literal не найден');
        const [maj, min, pat] = m[1].split('.').map(n => parseInt(n, 10));
        const ge = (maj > 2) || (maj === 2 && min > 8) || (maj === 2 && min === 8 && pat >= 2);
        assert.ok(ge, `APP_VERSION=${m[1]} < 2.8.2`);
    });
});

/* ---------- 8. CSS ---------- */

describe('Stage 15.3 — CSS в dashboard.css', () => {
    it('содержит .sensitivity-modal', () => {
        assert.ok(DASHBOARD_CSS.includes('.sensitivity-modal'), '.sensitivity-modal not found');
    });

    it('содержит .sensitivity-driver-card', () => {
        assert.ok(DASHBOARD_CSS.includes('.sensitivity-driver-card'), '.sensitivity-driver-card not found');
    });

    it('содержит .sensitivity-cost-toggle', () => {
        assert.ok(DASHBOARD_CSS.includes('.sensitivity-cost-toggle'), '.sensitivity-cost-toggle not found');
    });
});

/* ---------- 9. Domain imports (слой) ---------- */

describe('Stage 15.3 — layer-compliance: modal не импортирует state/controllers', () => {
    it('нет прямого импорта из controllers/', () => {
        assert.doesNotMatch(MODAL_SRC, /from\s*['"][^'"]*controllers\//);
    });

    it('нет прямого импорта из state/', () => {
        assert.doesNotMatch(MODAL_SRC, /from\s*['"][^'"]*state\//);
    });
});

/* ---------- 10. Domain module exports ---------- */

describe('Stage 15.3 — sensitivityAnalysis.js exports', () => {
    it('экспортирует simulateNumericPerturbation', () => {
        assert.match(DOMAIN_SRC, /export\s+function\s+simulateNumericPerturbation\s*\(/);
    });

    it('экспортирует simulateTogglePerturbation', () => {
        assert.match(DOMAIN_SRC, /export\s+function\s+simulateTogglePerturbation\s*\(/);
    });

    it('экспортирует runSensitivityAnalysis', () => {
        assert.match(DOMAIN_SRC, /export\s+function\s+runSensitivityAnalysis\s*\(/);
    });

    it('экспортирует rankSensitivityDrivers', () => {
        assert.match(DOMAIN_SRC, /export\s+function\s+rankSensitivityDrivers\s*\(/);
    });

    it('не импортирует из ui/ controllers/ state/ services/', () => {
        assert.doesNotMatch(DOMAIN_SRC, /from\s*['"][^'"]*(?:ui|controllers|state|services)\//);
    });
});
