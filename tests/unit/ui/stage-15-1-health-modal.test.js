/**
 * Stage 15.1 — Calculation Health Check: UI-источник + интеграция.
 *
 * Source-grep тесты:
 *   1. js/ui/modals/calculationHealthModal.js — экспорт + return null + modalShell.
 *   2. js/ui/healthChip.js — экспорт renderHealthStickyChip (renderHealthBlock
 *      удалён в Stage 18.2 — поглощён composite-сводкой).
 *   3. Регистрация модалки в MODAL_RENDERERS + MODAL_ORDER.
 *   4. state.modals.calculationHealth объявлен в store.
 *   5. state.ui.healthLastTab объявлен в store с дефолтом null.
 *   6. ctx.openCalculationHealthModal + ctx.setHealthLastTab в app.js.
 *   7. dashboard.js использует renderCalculationStateSummary (Stage 18.2).
 *   8. questionnaire.js импортирует и использует renderHealthStickyChip.
 *   9. CSS .health-* классы присутствуют в dashboard.css.
 *  10. persistence.js: loadHealthLastTab + saveHealthLastTab.
 *  11. STORAGE_KEYS.HEALTH_LAST_TAB и health-константы в constants.js.
 *  12. Layer-compliance: calculationHealthModal.js НЕ импортирует controllers/state.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripCssComments, stripJsComments } from '../../_helpers/source.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.resolve(__dirname, '../../..', rel), 'utf8');

const MODAL_SRC      = stripJsComments(read('js/ui/modals/calculationHealthModal.js'));
const CHIP_SRC       = stripJsComments(read('js/ui/healthChip.js'));
const INDEX_SRC      = stripJsComments(read('js/ui/index.js'));
const STORE_SRC      = stripJsComments(read('js/state/store.js'));
const APP_SRC        = stripJsComments(read('js/app.js'));
const NEXT_STEP_ACTIONS_SRC = stripJsComments(read('js/app/nextStepActions.js'));
const DASHBOARD_SRC  = stripJsComments(read('js/ui/dashboard.js'));
const QUESTIONNAIRE_SRC = stripJsComments(read('js/ui/questionnaire.js'));
const PERSIST_SRC    = stripJsComments(read('js/state/persistence.js'));
const CONSTANTS_SRC  = stripJsComments(read('js/utils/constants.js'));
const DOMAIN_SRC     = stripJsComments(read('js/domain/calculationHealth.js'));
const DASHBOARD_CSS  = stripCssComments(read('css/dashboard.css'));

/* ---------- 1. Модалка ---------- */

describe('Stage 15.1 — calculationHealthModal.js', () => {
    it('export renderCalculationHealthModal', () => {
        assert.match(MODAL_SRC, /export\s+function\s+renderCalculationHealthModal\s*\(/);
    });
    it('использует modalShell', () => {
        assert.match(MODAL_SRC, /modalShell\s*\(/);
    });
    it('return null если модалка закрыта', () => {
        assert.match(MODAL_SRC, /if\s*\(\s*!m\s*\|\|\s*!m\.open\s*\)\s*return\s+null/);
    });
    it('импортирует evaluateCalculationHealth и groupHealthFindings', () => {
        assert.match(MODAL_SRC, /evaluateCalculationHealth/);
        assert.match(MODAL_SRC, /groupHealthFindings/);
    });
    it('aria-labelledby (через modalShell) — title задан', () => {
        assert.match(MODAL_SRC, /title\s*:\s*['"]Качество расчёта['"]/);
    });
});

/* ---------- 2. Chip ---------- */

describe('Stage 15.1 — healthChip.js', () => {
    it('export renderHealthStickyChip', () => {
        assert.match(CHIP_SRC, /export\s+function\s+renderHealthStickyChip\s*\(/);
    });
    it('renderHealthBlock удалён (Stage 18.2 — поглощён composite-сводкой)', () => {
        assert.doesNotMatch(CHIP_SRC, /export\s+function\s+renderHealthBlock\s*\(/);
    });
    it('импортирует evaluateCalculationHealth из domain', () => {
        assert.match(CHIP_SRC, /from\s*['"]\.\.\/domain\/calculationHealth\.js['"]/);
    });
});

/* ---------- 3. Регистрация модалки ---------- */

describe('Stage 15.1 — модалка зарегистрирована в index.js', () => {
    it('импортирует renderCalculationHealthModal', () => {
        assert.match(INDEX_SRC,
            /import\s*\{\s*renderCalculationHealthModal\s*\}\s*from\s*['"]\.\/modals\/calculationHealthModal\.js['"]/);
    });
    it('включает calculationHealth в MODAL_ORDER', () => {
        const m = INDEX_SRC.match(/const\s+MODAL_ORDER\s*=\s*\[([^\]]+)\]/);
        assert.ok(m, 'MODAL_ORDER не найден');
        assert.match(m[1], /['"]calculationHealth['"]/);
    });
    it('включает пару [calculationHealth, renderCalculationHealthModal] в MODAL_RENDERERS', () => {
        assert.match(INDEX_SRC,
            /\[\s*['"]calculationHealth['"]\s*,\s*renderCalculationHealthModal\s*\]/);
    });
});

/* ---------- 4. Store ---------- */

describe('Stage 15.1 — store.modals.calculationHealth', () => {
    it('shape содержит open:false', () => {
        assert.match(STORE_SRC,
            /calculationHealth\s*:\s*\{[\s\S]{0,80}?open\s*:\s*false[\s\S]{0,80}?\}/);
    });
});

describe('Stage 15.1 — state.ui.healthLastTab', () => {
    it('healthLastTab: null объявлен в initialState.ui', () => {
        assert.match(STORE_SRC, /healthLastTab\s*:\s*null/);
    });
});

/* ---------- 5. ctx-методы ---------- */

describe('Stage 15.1 — ctx.openCalculationHealthModal в app.js', () => {
    it('метод объявлен и зовёт store.openModal', () => {
        assert.match(APP_SRC, /openCalculationHealthModal\s*\(\s*\)\s*\{/);
        // именно с literal 'calculationHealth'
        assert.match(APP_SRC, /store\.openModal\s*\(\s*['"]calculationHealth['"]\s*\)/);
    });
});

describe('Stage 15.1 — ctx.setHealthLastTab в app.js', () => {
    it('метод объявлен и пишет в store.setUi', () => {
        assert.match(APP_SRC, /setHealthLastTab\s*\(\s*tab\s*\)\s*\{/);
        assert.match(APP_SRC, /setHealthLastTabAction\s*\(/);
        assert.match(NEXT_STEP_ACTIONS_SRC, /healthLastTab\s*:\s*tab/);
    });
});

/* ---------- 6. Dashboard / Questionnaire подключены ---------- */

describe('Stage 18.2 — Dashboard composite summary вместо health-block', () => {
    it('dashboard.js импортирует renderCalculationStateSummary', () => {
        assert.match(DASHBOARD_SRC,
            /import\s*\{[^}]*renderCalculationStateSummary[^}]*\}\s*from\s*['"]\.\/calculationStateSummary\.js['"]/);
    });
    it('renderDashboard вызывает renderCalculationStateSummary', () => {
        assert.match(DASHBOARD_SRC, /renderCalculationStateSummary\s*\(/);
    });
    it('dashboard.js больше не использует renderHealthBlock', () => {
        assert.doesNotMatch(DASHBOARD_SRC, /renderHealthBlock/);
    });
});

describe('Stage 15.1 — Questionnaire sticky-chip', () => {
    it('questionnaire.js импортирует renderHealthStickyChip', () => {
        assert.match(QUESTIONNAIRE_SRC,
            /import\s*\{[^}]*renderHealthStickyChip[^}]*\}\s*from\s*['"]\.\/healthChip\.js['"]/);
    });
    it('renderQuestionnaire вызывает renderHealthStickyChip', () => {
        assert.match(QUESTIONNAIRE_SRC, /renderHealthStickyChip\s*\(/);
    });
});

/* ---------- 7. CSS ---------- */

describe('Stage 15.1 — CSS classes', () => {
    it('.health-score-chip объявлен', () => {
        assert.match(DASHBOARD_CSS, /\.health-score-chip\s*\{/);
    });
    it('.health-score-good / -warning / -critical объявлены', () => {
        assert.match(DASHBOARD_CSS, /\.health-score-good\s*\{/);
        assert.match(DASHBOARD_CSS, /\.health-score-warning\s*\{/);
        assert.match(DASHBOARD_CSS, /\.health-score-critical\s*\{/);
    });
    it('.health-finding-card + per-severity модификаторы', () => {
        assert.match(DASHBOARD_CSS, /\.health-finding-card\s*\{/);
        assert.match(DASHBOARD_CSS, /\.health-finding-error\s*\{/);
        assert.match(DASHBOARD_CSS, /\.health-finding-warning\s*\{/);
        assert.match(DASHBOARD_CSS, /\.health-finding-recommendation\s*\{/);
        assert.match(DASHBOARD_CSS, /\.health-finding-info\s*\{/);
    });
    it('.health-sticky-chip — компакт для опросника', () => {
        assert.match(DASHBOARD_CSS, /\.health-sticky-chip\s*\{/);
    });
    it('.health-modal-tabs — навигация по severity', () => {
        assert.match(DASHBOARD_CSS, /\.health-modal-tabs\s*\{/);
    });
});

/* ---------- 8. Persistence ---------- */

describe('Stage 15.1 — persistence loadHealthLastTab/saveHealthLastTab', () => {
    it('export loadHealthLastTab', () => {
        assert.match(PERSIST_SRC, /export\s+function\s+loadHealthLastTab\s*\(/);
    });
    it('export saveHealthLastTab', () => {
        assert.match(PERSIST_SRC, /export\s+function\s+saveHealthLastTab\s*\(/);
    });
    it('пишет в STORAGE_KEYS.HEALTH_LAST_TAB', () => {
        assert.match(PERSIST_SRC, /STORAGE_KEYS\.HEALTH_LAST_TAB/);
    });
});

/* ---------- 9. Constants ---------- */

describe('Stage 15.1 — constants.js', () => {
    it('STORAGE_KEYS.HEALTH_LAST_TAB объявлен', () => {
        assert.match(CONSTANTS_SRC, /HEALTH_LAST_TAB\s*:\s*['"]calc\.healthLastTab['"]/);
    });
    it('STALE_BUNDLE_THRESHOLD_MONTHS экспортирован', () => {
        assert.match(CONSTANTS_SRC,
            /export\s+const\s+STALE_BUNDLE_THRESHOLD_MONTHS\s*=\s*6/);
    });
    it('DEFAULT_THRESHOLD_RATIO экспортирован', () => {
        assert.match(CONSTANTS_SRC,
            /export\s+const\s+DEFAULT_THRESHOLD_RATIO\s*=\s*0\.7/);
    });
    it('HEALTH_PENALTY с тремя ненулевыми полями', () => {
        assert.match(CONSTANTS_SRC, /HEALTH_PENALTY\s*=\s*Object\.freeze\(/);
        assert.match(CONSTANTS_SRC, /error\s*:\s*20/);
        assert.match(CONSTANTS_SRC, /warning\s*:\s*8/);
        assert.match(CONSTANTS_SRC, /recommendation\s*:\s*3/);
    });
    it('HEALTH_SCORE_THRESHOLDS exported', () => {
        assert.match(CONSTANTS_SRC, /HEALTH_SCORE_THRESHOLDS/);
    });
});

/* ---------- 10. Domain (sanity-check экспортов) ---------- */

describe('Stage 15.1 — domain/calculationHealth.js', () => {
    it('export evaluateCalculationHealth', () => {
        assert.match(DOMAIN_SRC, /export\s+function\s+evaluateCalculationHealth\s*\(/);
    });
    it('export getHealthScore', () => {
        assert.match(DOMAIN_SRC, /export\s+function\s+getHealthScore\s*\(/);
    });
    it('export groupHealthFindings', () => {
        assert.match(DOMAIN_SRC, /export\s+function\s+groupHealthFindings\s*\(/);
    });
    it('export evaluateScenarioHealth', () => {
        assert.match(DOMAIN_SRC, /export\s+function\s+evaluateScenarioHealth\s*\(/);
    });
});

/* ---------- 11. Layer-compliance ---------- */

describe('Stage 15.1 — Layer compliance', () => {
    it('calculationHealthModal.js НЕ импортирует controllers/state', () => {
        assert.doesNotMatch(MODAL_SRC, /from\s*['"][^'"]*\/controllers\//);
        assert.doesNotMatch(MODAL_SRC, /from\s*['"][^'"]*\/state\//);
    });
    it('healthChip.js НЕ импортирует controllers/state', () => {
        assert.doesNotMatch(CHIP_SRC, /from\s*['"][^'"]*\/controllers\//);
        assert.doesNotMatch(CHIP_SRC, /from\s*['"][^'"]*\/state\//);
    });
    it('domain/calculationHealth.js НЕ импортирует ui/controllers/state/services', () => {
        assert.doesNotMatch(DOMAIN_SRC, /from\s*['"][^'"]*\/ui\//);
        assert.doesNotMatch(DOMAIN_SRC, /from\s*['"][^'"]*\/controllers\//);
        assert.doesNotMatch(DOMAIN_SRC, /from\s*['"][^'"]*\/state\//);
        assert.doesNotMatch(DOMAIN_SRC, /from\s*['"][^'"]*\/services\//);
    });
});
