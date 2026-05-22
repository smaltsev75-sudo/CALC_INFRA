/**
 * Stage 15.5 — Decision Memo Modal: source + integration.
 *
 * Source-grep тесты:
 *   1. modal: экспорт + return null + modalShell + title + actions.
 *   2. Регистрация в MODAL_RENDERERS + MODAL_ORDER + import.
 *   3. state.modals.decisionMemo в store.
 *   4. ctx-методы в app.js: openDecisionMemoModal, buildDecisionMemo,
 *      copyDecisionMemo, downloadDecisionMemo.
 *   5. Entry-кнопка в healthChip.js (Сформировать memo).
 *   6. Entry-кнопка в budgetGuardrailsModal.js.
 *   7. Entry-кнопка в calculationHealthModal.js.
 *   8. CSS: .decision-memo-preview / .decision-memo-actions / .decision-memo-empty.
 *   9. Layer-compliance: модалка не импортирует controllers/state.
 *  10. APP_VERSION = 2.8.4 (constants.js + package.json).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripCssComments, stripJsComments } from '../../_helpers/source.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.resolve(__dirname, '../../..', rel), 'utf8');

const MODAL_SRC      = stripJsComments(read('js/ui/modals/decisionMemoModal.js'));
const INDEX_SRC      = stripJsComments(read('js/ui/index.js'));
const STORE_SRC      = stripJsComments(read('js/state/store.js'));
const APP_SRC        = stripJsComments(read('js/app.js'));
const CHIP_SRC       = stripJsComments(read('js/ui/healthChip.js'));
const BUDGET_MODAL   = stripJsComments(read('js/ui/modals/budgetGuardrailsModal.js'));
const HEALTH_MODAL   = stripJsComments(read('js/ui/modals/calculationHealthModal.js'));
const DASHBOARD_CSS  = stripCssComments(read('css/dashboard.css'));
const CONSTANTS_SRC  = stripJsComments(read('js/utils/constants.js'));
const PACKAGE_JSON   = read('package.json');

/* ---------- 1. Модалка ---------- */

describe('Stage 15.5 — decisionMemoModal.js', () => {
    it('экспортирует renderDecisionMemoModal', () => {
        assert.match(MODAL_SRC, /export\s+function\s+renderDecisionMemoModal\s*\(/);
    });

    it('использует modalShell', () => {
        assert.match(MODAL_SRC, /modalShell\s*\(/);
    });

    it('return null если модалка закрыта', () => {
        assert.match(MODAL_SRC, /if\s*\(\s*!m\s*\|\|\s*!m\.open\s*\)\s*return\s+null/);
    });

    it('title содержит «Обоснование расчёта»', () => {
        assert.match(MODAL_SRC, /Обоснование расчёта/);
    });

    it('содержит кнопку «Скопировать Markdown»', () => {
        assert.match(MODAL_SRC, /Скопировать Markdown/);
    });

    it('содержит кнопку «Скачать .md»', () => {
        assert.match(MODAL_SRC, /Скачать \.md/);
    });

    it('использует renderMarkdown из services/markdown.js', () => {
        assert.match(MODAL_SRC, /from\s*['"]\.\.\/\.\.\/services\/markdown\.js['"]/);
    });

    it('использует setTrustedHtml + trustedHtml из dom.js', () => {
        assert.match(MODAL_SRC, /setTrustedHtml/);
        assert.match(MODAL_SRC, /trustedHtml/);
    });

    it('обрабатывает empty state (нет активного расчёта)', () => {
        assert.match(MODAL_SRC, /Нет активного расчёта/);
    });
});

/* ---------- 2. Регистрация ---------- */

describe('Stage 15.5 — модалка зарегистрирована', () => {
    it('импортирует renderDecisionMemoModal в index.js', () => {
        assert.match(INDEX_SRC,
            /import\s*\{\s*renderDecisionMemoModal\s*\}\s*from\s*['"]\.\/modals\/decisionMemoModal\.js['"]/);
    });

    it('decisionMemo в MODAL_ORDER', () => {
        const m = INDEX_SRC.match(/const\s+MODAL_ORDER\s*=\s*\[([^\]]+)\]/);
        assert.ok(m);
        assert.match(m[1], /['"]decisionMemo['"]/);
    });

    it('пара [decisionMemo, renderDecisionMemoModal] в MODAL_RENDERERS', () => {
        assert.match(INDEX_SRC,
            /\[\s*['"]decisionMemo['"]\s*,\s*renderDecisionMemoModal\s*\]/);
    });
});

/* ---------- 3. Store ---------- */

describe('Stage 15.5 — store.modals.decisionMemo', () => {
    it('содержит decisionMemo: { open: false }', () => {
        assert.match(STORE_SRC, /decisionMemo\s*:\s*\{\s*open\s*:\s*false\s*\}/);
    });
});

/* ---------- 4. App.js ctx ---------- */

describe('Stage 15.5 — app.js ctx-методы', () => {
    it('openDecisionMemoModal', () => {
        assert.match(APP_SRC, /openDecisionMemoModal\s*\(/);
    });

    it('buildDecisionMemo', () => {
        assert.match(APP_SRC, /buildDecisionMemo\s*\(/);
    });

    it('copyDecisionMemo (async)', () => {
        assert.match(APP_SRC, /copyDecisionMemo\s*\(/);
    });

    it('downloadDecisionMemo', () => {
        assert.match(APP_SRC, /downloadDecisionMemo\s*\(/);
    });

    it('импортирует decisionMemoController', () => {
        assert.match(APP_SRC,
            /from\s*['"]\.\/controllers\/decisionMemoController\.js['"]/);
    });
});

/* ---------- 5. Entry-точки ---------- */

describe('Stage 15.5 — entry buttons', () => {
    it('calculationStateSummary.js владеет CTA «Decision Memo» (Stage 17.3 dedup)', () => {
        const NEXT_STEPS_SRC = stripJsComments(read('js/ui/calculationStateSummary.js'));
        assert.match(NEXT_STEPS_SRC, /openDecisionMemoModal/);
    });

    it('healthChip.js НЕ содержит «Сформировать memo» (Stage 17.3 dedup)', () => {
        assert.equal(CHIP_SRC.includes('Сформировать memo'), false,
            'CTA «Сформировать memo» должен жить только в Next Steps.');
    });

    it('budgetGuardrailsModal.js содержит cross-link в Decision Memo', () => {
        assert.match(BUDGET_MODAL, /Сформировать memo/);
        assert.match(BUDGET_MODAL, /openDecisionMemoModal/);
    });

    it('calculationHealthModal.js содержит cross-link в Decision Memo', () => {
        assert.match(HEALTH_MODAL, /Сформировать memo/);
        assert.match(HEALTH_MODAL, /openDecisionMemoModal/);
    });
});

/* ---------- 6. CSS ---------- */

describe('Stage 15.5 — CSS', () => {
    it('содержит .decision-memo-preview', () => {
        assert.match(DASHBOARD_CSS, /\.decision-memo-preview\s*\{/);
    });

    it('содержит .decision-memo-actions', () => {
        assert.match(DASHBOARD_CSS, /\.decision-memo-actions\s*\{/);
    });

    it('содержит .decision-memo-empty', () => {
        assert.match(DASHBOARD_CSS, /\.decision-memo-empty\s*\{/);
    });

    it('содержит .decision-memo-section-title', () => {
        assert.match(DASHBOARD_CSS, /\.decision-memo-section-title\s*\{/);
    });

    it('preview имеет max-height (scrollable)', () => {
        const m = DASHBOARD_CSS.match(/\.decision-memo-preview\s*\{([^}]+)\}/);
        assert.ok(m);
        assert.match(m[1], /max-height/);
        assert.match(m[1], /overflow-y/);
    });
});

/* ---------- 7. Layer-compliance ---------- */

describe('Stage 15.5 — layer compliance: modal', () => {
    it('модалка НЕ импортирует controllers/', () => {
        assert.doesNotMatch(MODAL_SRC, /from\s*['"][^'"]*\/controllers\//);
    });

    it('модалка НЕ импортирует state/', () => {
        assert.doesNotMatch(MODAL_SRC, /from\s*['"][^'"]*\/state\//);
    });
});

/* ---------- 8. Версия ---------- */

describe('Stage 15.5 — APP_VERSION ≥ 2.8.4 (введено в 2.8.4)', () => {
    // После Stage 16.1 версия bumped до 2.9.0; раньше было strict-equal '2.8.4'.
    // Логика: feature Decision Memo появилась в 2.8.4, нельзя downgrade ниже —
    // future-MINOR/MAJOR должны проходить проверку без ручной правки теста.
    it('constants.js содержит APP_VERSION ≥ 2.8.4', () => {
        const m = CONSTANTS_SRC.match(/export\s+const\s+APP_VERSION\s*=\s*['"]([\d.]+)['"]/);
        assert.ok(m, 'APP_VERSION literal не найден');
        const [maj, min, pat] = m[1].split('.').map(n => parseInt(n, 10));
        const ge = (maj > 2) || (maj === 2 && min > 8) || (maj === 2 && min === 8 && pat >= 4);
        assert.ok(ge, `APP_VERSION=${m[1]} < 2.8.4`);
    });

    it('package.json содержит "version" ≥ 2.8.4', () => {
        const m = PACKAGE_JSON.match(/"version"\s*:\s*"([\d.]+)"/);
        assert.ok(m, '"version" literal не найден');
        const [maj, min, pat] = m[1].split('.').map(n => parseInt(n, 10));
        const ge = (maj > 2) || (maj === 2 && min > 8) || (maj === 2 && min === 8 && pat >= 4);
        assert.ok(ge, `package.json version=${m[1]} < 2.8.4`);
    });
});
