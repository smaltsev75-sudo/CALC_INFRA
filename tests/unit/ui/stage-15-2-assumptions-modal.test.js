/**
 * Stage 15.2 — Assumptions Register: UI-источник + интеграция.
 *
 * Source-grep тесты:
 *   1. js/ui/modals/assumptionsRegisterModal.js — экспорт + return null + modalShell.
 *   2. Регистрация модалки в MODAL_RENDERERS + MODAL_ORDER.
 *   3. state.modals.assumptionsRegister в store.
 *   4. ctx.openAssumptionsRegisterModal в app.js.
  *   5. calculationStateSummary.js (Dashboard «Следующие шаги») вызывает openAssumptionsRegisterModal
 *      (Stage 17.3: владение CTA перенесено с healthChip.js на calculationStateSummary.js).
 *   6. calculationHealthModal.js содержит кнопку «Допущения» cross-link.
 *   7. constants.js: CRITICAL_FIELDS экспортирован, длина >= 10.
 *   8. CSS: .assumption-card + .assumption-confidence-* в dashboard.css.
 *   9. Domain imports в assumptionsRegisterModal.js.
 *  10. Layer-compliance: modal НЕ импортирует controllers/state.
 *  11. Domain: buildAssumptionsRegister, groupAssumptionsBySource, getRiskyAssumptions.
 *  12. APP_VERSION синхронизирована с 2.8.1.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripCssComments, stripJsComments } from '../../_helpers/source.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.resolve(__dirname, '../../..', rel), 'utf8');

const MODAL_SRC      = stripJsComments(read('js/ui/modals/assumptionsRegisterModal.js'));
const INDEX_SRC      = stripJsComments(read('js/ui/index.js'));
const STORE_SRC      = stripJsComments(read('js/state/store.js'));
const APP_SRC        = stripJsComments(read('js/app.js'));
const NEXT_STEPS_SRC = stripJsComments(read('js/ui/calculationStateSummary.js')); // Stage 18.2: TARGET_DISPATCH перенесён сюда
const HEALTH_MODAL_SRC = stripJsComments(read('js/ui/modals/calculationHealthModal.js'));
const CONSTANTS_SRC  = stripJsComments(read('js/utils/constants.js'));
const DOMAIN_SRC     = stripJsComments(read('js/domain/assumptionsRegister.js'));
const DASHBOARD_CSS  = stripCssComments(read('css/dashboard.css'));

/* ---------- 1. Модалка ---------- */

describe('Stage 15.2 — assumptionsRegisterModal.js', () => {
    it('export renderAssumptionsRegisterModal', () => {
        assert.match(MODAL_SRC, /export\s+function\s+renderAssumptionsRegisterModal\s*\(/);
    });
    it('использует modalShell', () => {
        assert.match(MODAL_SRC, /modalShell\s*\(/);
    });
    it('return null если модалка закрыта', () => {
        assert.match(MODAL_SRC, /if\s*\(\s*!m\s*\|\|\s*!m\.open\s*\)\s*return\s+null/);
    });
    it('импортирует buildAssumptionsRegister из domain', () => {
        assert.match(MODAL_SRC, /from\s*['"]\.\.\/\.\.\/domain\/assumptionsRegister\.js['"]/);
    });
    it('title содержит "Допущения расчёта"', () => {
        assert.match(MODAL_SRC, /title\s*:\s*['"]Допущения расчёта['"]/);
    });
});

/* ---------- 2. Регистрация модалки ---------- */

describe('Stage 15.2 — модалка зарегистрирована в index.js', () => {
    it('импортирует renderAssumptionsRegisterModal', () => {
        assert.match(INDEX_SRC,
            /import\s*\{\s*renderAssumptionsRegisterModal\s*\}\s*from\s*['"]\.\/modals\/assumptionsRegisterModal\.js['"]/);
    });
    it('включает assumptionsRegister в MODAL_ORDER', () => {
        const m = INDEX_SRC.match(/const\s+MODAL_ORDER\s*=\s*\[([^\]]+)\]/);
        assert.ok(m, 'MODAL_ORDER не найден');
        assert.match(m[1], /['"]assumptionsRegister['"]/);
    });
    it('включает пару [assumptionsRegister, renderAssumptionsRegisterModal] в MODAL_RENDERERS', () => {
        assert.match(INDEX_SRC,
            /\[\s*['"]assumptionsRegister['"]\s*,\s*renderAssumptionsRegisterModal\s*\]/);
    });
});

/* ---------- 3. Store ---------- */

describe('Stage 15.2 — store.modals.assumptionsRegister', () => {
    it('shape содержит open:false', () => {
        assert.match(STORE_SRC,
            /assumptionsRegister\s*:\s*\{[\s\S]{0,120}?open\s*:\s*false[\s\S]{0,120}?\}/);
    });
    it('содержит filterFieldIds: null', () => {
        assert.match(STORE_SRC, /filterFieldIds\s*:\s*null/);
    });
});

/* ---------- 4. ctx-метод ---------- */

describe('Stage 15.2 — ctx.openAssumptionsRegisterModal в app.js', () => {
    it('метод объявлен', () => {
        assert.match(APP_SRC, /openAssumptionsRegisterModal\s*\(/);
    });
    it('зовёт store.openModal с literal "assumptionsRegister"', () => {
        assert.match(APP_SRC, /store\.openModal\s*\(\s*['"]assumptionsRegister['"]/);
    });
});

/* ---------- 5. calculationStateSummary.js подключён (Stage 17.3 owner) ---------- */

describe('Stage 17.3 — calculationStateSummary.js вызывает openAssumptionsRegisterModal (CTA owner)', () => {
    it('TARGET_DISPATCH в calculationStateSummary.js диспатчит assumptions_register', () => {
        assert.match(NEXT_STEPS_SRC, /openAssumptionsRegisterModal/);
    });
    it('domain/recommendedActions.js формирует action target=assumptions_register', () => {
        const DOMAIN_RA = stripJsComments(read('js/domain/recommendedActions.js'));
        assert.match(DOMAIN_RA, /target:\s*['"]assumptions_register['"]/);
    });
});

/* ---------- 6. calculationHealthModal.js cross-link ---------- */

describe('Stage 15.2 — cross-link кнопка «Допущения» в calculationHealthModal.js', () => {
    it('вызов ctx.openAssumptionsRegisterModal c fieldIds', () => {
        assert.match(HEALTH_MODAL_SRC, /openAssumptionsRegisterModal\s*\(/);
    });
    it('CSS-класс health-finding-assumptions-link', () => {
        assert.match(HEALTH_MODAL_SRC, /health-finding-assumptions-link/);
    });
});

/* ---------- 7. CRITICAL_FIELDS ---------- */

describe('Stage 15.2 — constants.js', () => {
    it('CRITICAL_FIELDS экспортирован', () => {
        assert.match(CONSTANTS_SRC, /export\s+const\s+CRITICAL_FIELDS\s*=/);
    });
    it('CRITICAL_FIELDS содержит >= 10 элементов', () => {
        const m = CONSTANTS_SRC.match(/CRITICAL_FIELDS\s*=\s*Object\.freeze\s*\(\s*\[([^\]]+)\]/);
        assert.ok(m, 'CRITICAL_FIELDS = Object.freeze([...]) не найден');
        const items = m[1].split(',').filter(s => s.trim().length > 0);
        assert.ok(items.length >= 10, `Ожидалось >= 10 полей, нашли ${items.length}`);
    });
    it('peak_rps и sla_target присутствуют в CRITICAL_FIELDS', () => {
        assert.match(CONSTANTS_SRC, /['"]peak_rps['"]/);
        assert.match(CONSTANTS_SRC, /['"]sla_target['"]/);
    });
});

/* ---------- 8. CSS ---------- */

describe('Stage 15.2 — CSS классы в dashboard.css', () => {
    it('.assumption-card объявлен', () => {
        assert.match(DASHBOARD_CSS, /\.assumption-card\s*\{/);
    });
    it('.assumption-confidence-low/medium/high объявлены', () => {
        assert.match(DASHBOARD_CSS, /\.assumption-confidence-low\s*\{/);
        assert.match(DASHBOARD_CSS, /\.assumption-confidence-medium\s*\{/);
        assert.match(DASHBOARD_CSS, /\.assumption-confidence-high\s*\{/);
    });
    it('.assumption-source-badge объявлен', () => {
        assert.match(DASHBOARD_CSS, /\.assumption-source-badge\s*\{/);
    });
});

/* ---------- 9. Domain exports ---------- */

describe('Stage 15.2 — domain/assumptionsRegister.js', () => {
    it('export buildAssumptionsRegister', () => {
        assert.match(DOMAIN_SRC, /export\s+function\s+buildAssumptionsRegister\s*\(/);
    });
    it('export groupAssumptionsBySource', () => {
        assert.match(DOMAIN_SRC, /export\s+function\s+groupAssumptionsBySource\s*\(/);
    });
    it('export getRiskyAssumptions', () => {
        assert.match(DOMAIN_SRC, /export\s+function\s+getRiskyAssumptions\s*\(/);
    });
    it('export getManualOverrideSummary', () => {
        assert.match(DOMAIN_SRC, /export\s+function\s+getManualOverrideSummary\s*\(/);
    });
});

/* ---------- 10. Layer compliance ---------- */

describe('Stage 15.2 — Layer compliance', () => {
    it('assumptionsRegisterModal.js НЕ импортирует controllers/state', () => {
        assert.doesNotMatch(MODAL_SRC, /from\s*['"][^'"]*\/controllers\//);
        assert.doesNotMatch(MODAL_SRC, /from\s*['"][^'"]*\/state\//);
    });
    it('domain/assumptionsRegister.js НЕ импортирует ui/controllers/state/services', () => {
        assert.doesNotMatch(DOMAIN_SRC, /from\s*['"][^'"]*\/ui\//);
        assert.doesNotMatch(DOMAIN_SRC, /from\s*['"][^'"]*\/controllers\//);
        assert.doesNotMatch(DOMAIN_SRC, /from\s*['"][^'"]*\/state\//);
        assert.doesNotMatch(DOMAIN_SRC, /from\s*['"][^'"]*\/services\//);
    });
});

/* ---------- 11. Версия ---------- */

describe('Stage 15.2 — APP_VERSION ≥ 2.8.1 (введено в 2.8.1)', () => {
    it('APP_VERSION в constants.js ≥ 2.8.1', () => {
        const m = CONSTANTS_SRC.match(/APP_VERSION\s*=\s*['"]([\d.]+)['"]/);
        assert.ok(m, 'APP_VERSION literal не найден');
        const [maj, min, pat] = m[1].split('.').map(n => parseInt(n, 10));
        const ge = (maj > 2) || (maj === 2 && min > 8) || (maj === 2 && min === 8 && pat >= 1);
        assert.ok(ge, `APP_VERSION=${m[1]} < 2.8.1`);
    });
});
