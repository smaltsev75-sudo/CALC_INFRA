/**
 * Stage 18.1 Phase 2 (v2.13.0) — UI source-grep тесты для draft-editor варианта.
 *
 * До Phase 2 здесь тестировался read-only UI: 3-tile dashboard + read-only modal.
 * После Phase 2 (полная переделка in-place):
 *   • Dashboard — одна teaser-карточка с одним CTA «Открыть план оптимизации».
 *   • Modal — editor draft с level tabs / constraints / summary / editable
 *     levers / footer с «Применить» DISABLED (Phase 3).
 *
 * Тесты source-grep — не запускают DOM (это покрыто ui-modules-smoke).
 * Проверяем только структуру кода: что нужные элементы рендерятся, что нет
 * запрещённых терминов («Применить план», «Автооптимизировать»), что UI не
 * мутирует calc напрямую (mutation идёт через ctx/controller).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripJsComments } from '../../_helpers/source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf-8');
const COP_MODAL_FILES = [
    'js/ui/modals/costOptimizationPlannerModal.js',
    'js/ui/modals/costOptimizationPlannerModalControls.js',
    'js/ui/modals/costOptimizationPlannerModalFormat.js',
    'js/ui/modals/costOptimizationPlannerModalLevers.js',
    'js/ui/modals/costOptimizationPlannerModalSummary.js'
];
const readCopModalSources = () => COP_MODAL_FILES.map(read).join('\n');

/* ============================================================
 * 1. Dashboard teaser — простая одна карточка с одним CTA
 * ============================================================ */

/* Stage 18.2.x: бывшая отдельная Dashboard-карточка «План оптимизации стоимости»
   удалена. Entry point встроен в composite-сводку как secondary-action
   (renderCostOptimizationTeaser в js/ui/calculationStateSummary.js). */
describe('Stage 18.1 Phase 2 / 18.2.x — Cost optimization teaser внутри composite-сводки', () => {
    const src = stripJsComments(read('js/ui/calculationStateSummary.js'));

    it('файл standalone-teaser удалён (js/ui/costOptimizationPlanner.js)', () => {
        assert.equal(existsSync(join(ROOT, 'js/ui/costOptimizationPlanner.js')), false,
            'Standalone Dashboard-карточка удалена в Stage 18.2.x — entry point живёт внутри composite-сводки.');
    });

    it('экспортирует helper renderCostOptimizationTeaser (через __test)', () => {
        assert.match(src, /renderCostOptimizationTeaser/);
    });

    it('teaser использует CSS-класс .calc-state-summary-optimization', () => {
        assert.match(src, /calc-state-summary-optimization/);
    });

    it('один CTA «Открыть план оптимизации»', () => {
        assert.match(src, /Открыть план оптимизации/);
    });

    it('CTA вызывает ctx.openCostOptimizationPlannerModal', () => {
        assert.match(src, /ctx\?\.openCostOptimizationPlannerModal\?\.\(\)/);
    });

    it('НЕ содержит levers / constraints / Apply controls', () => {
        assert.ok(!/cop-lever/.test(src),       'no levers in summary teaser');
        assert.ok(!/Применить/.test(src),       'no Применить button in summary teaser');
        assert.ok(!/Constraints?/i.test(src) || !/checkbox/i.test(src),
            'no constraints toggles in summary teaser');
    });

    it('aria-label на кнопке CTA', () => {
        assert.match(src, /'aria-label'\s*:\s*['"]Открыть план оптимизации[^'"]*['"]/);
    });
});

/* ============================================================
 * 2. Modal — draft editor: level tabs, constraints, summary, levers
 * ============================================================ */

describe('Stage 18.1 Phase 2 — Modal editor', () => {
    const src = stripJsComments(readCopModalSources());

    it('exports renderCostOptimizationPlannerModal', () => {
        assert.match(src, /export function renderCostOptimizationPlannerModal\s*\(/);
    });

    it('читает state.modals.costOptimizationPlanner', () => {
        assert.match(src, /state\.modals\.costOptimizationPlanner/);
    });

    it('использует groupOptimizationLevers (Stage 18.1.1 grouping; НЕ старый buildOptimizationPlans)', () => {
        /* После 18.1.1 модалка вызывает groupOptimizationLevers, который
           внутри использует buildEditableLevers. Сам импорт buildEditableLevers
           в UI больше не нужен. */
        assert.match(src, /groupOptimizationLevers/);
        assert.ok(!/buildOptimizationPlans/.test(src),
            'старый API buildOptimizationPlans не используется');
    });

    /* ---- Level tabs ---- */
    it('рендерит 3 level-tab\'а через PLAN_TIERS.map', () => {
        assert.match(src, /PLAN_TIERS\.map\s*\(\s*tier\s*=>\s*renderLevelTab/);
    });

    it('level-tab клик вызывает ctx.setOptimizationLevel', () => {
        assert.match(src, /ctx\.setOptimizationLevel\s*\(\s*tier\.id\s*\)/);
    });

    it('Level tabs имеют role=tab + aria-selected', () => {
        assert.match(src, /role:\s*['"]tab['"]/);
        assert.match(src, /'aria-selected'/);
    });

    /* ---- Constraints ---- */
    it('6 constraint-toggle\'ов в CONSTRAINT_TOGGLES', () => {
        const matches = src.match(/key:\s*['"]allow[A-Z]\w+['"]|key:\s*['"]protectCompliance['"]/g) || [];
        assert.ok(matches.length >= 6, `Got ${matches.length} constraint keys`);
    });

    it('constraint toggle вызывает ctx.toggleOptimizationConstraint', () => {
        assert.match(src, /ctx\.toggleOptimizationConstraint\s*\(\s*c\.key/);
    });

    /* ---- Summary ---- */
    it('Summary показывает before / after / saving', () => {
        assert.match(src, /Текущая стоимость/);
        assert.match(src, /После изменений/);
        assert.match(src, /Экономия/);
    });

    it('Summary использует formatRub для денежных значений', () => {
        assert.match(src, /formatRub/);
    });

    it('Summary показывает статус диапазона', () => {
        assert.match(src, /inTargetRange/);
        assert.match(src, /Попадает в диапазон/);
    });

    /* ---- Levers editor ---- */
    it('Levers — список <ol> с группировкой по category', () => {
        assert.match(src, /cop-lever-list/);
        assert.match(src, /cop-lever-group/);
    });

    it('lever editor для enum (select)', () => {
        assert.match(src, /editorType:\s*null|editor\.editorType[\s\S]{0,80}enum/);
        assert.match(src, /renderEnumEditor/);
    });

    it('lever editor для number_int/number_float/percent (decimal input)', () => {
        assert.match(src, /renderNumberEditor/);
        assert.match(src, /DECIMAL_INPUT_TYPE/);
        assert.match(src, /decimalInputAttrs/);
    });

    it('lever editor change вызывает ctx.updateOptimizationDraftValue', () => {
        assert.match(src, /ctx\.updateOptimizationDraftValue/);
    });

    it('lever имеет кнопку «Сбросить параметр»', () => {
        assert.match(src, /Сбросить параметр/);
    });

    it('Сбросить параметр вызывает ctx.removeOptimizationDraftChange', () => {
        assert.match(src, /ctx\.removeOptimizationDraftChange/);
    });

    it('lever имеет кнопку «Перейти к полю» (для answer:* fieldId)', () => {
        assert.match(src, /Перейти к полю/);
        assert.match(src, /fieldId\.startsWith\(\s*['"]answer:['"]/);
    });

    /* ---- Footer ---- */
    it('Footer содержит «Сбросить изменения»', () => {
        assert.match(src, /Сбросить изменения/);
    });

    it('Footer содержит «Применить изменения»', () => {
        assert.match(src, /Применить изменения/);
        /* Phase 3: кнопка имеет conditional disabled (applyEnabled ? undefined :
           'disabled') — не hard-coded disabled. */
        assert.match(
            src,
            /class:\s*['"][^'"]*cop-modal-apply[^'"]*['"][\s\S]*?applyEnabled\s*\?\s*undefined\s*:\s*['"]disabled['"]/,
            'Apply disabled-атрибут условный, не hard-coded'
        );
    });

    it('Apply кнопка имеет onClick → ctx.applyOptimizationDraftAction', () => {
        assert.match(src, /ctx\.applyOptimizationDraftAction\(\)/);
    });

    it('Apply активен только при hasChanges && !hasError && !confirming', () => {
        assert.match(src, /applyEnabled\s*=\s*hasChanges\s*&&\s*!hasError\s*&&\s*!confirming/);
    });

    it('«Сбросить изменения» disabled когда changes пуст', () => {
        assert.match(src, /hasChanges\s*\?\s*undefined\s*:\s*['"]disabled['"]/);
    });

    it('Reset вызывает ctx.resetOptimizationDraft', () => {
        assert.match(src, /ctx\.resetOptimizationDraft/);
    });

    it('Закрыть вызывает ctx.closeCostOptimizationPlannerModal', () => {
        assert.match(src, /ctx\.closeCostOptimizationPlannerModal/);
    });

    /* ---- Phase 2 безопасность: запрещённые термины ---- */
    it('НЕТ «Автооптимизировать»', () => {
        assert.ok(!/Автооптимизировать/.test(src));
    });

    it('НЕТ «Применить план» (только «Применить изменения»)', () => {
        assert.ok(!/Применить план/.test(src));
    });

    it('НЕТ ссылок на What-if / Optimization Playbook', () => {
        assert.ok(!/What-if|What if|Playbook/.test(src));
    });
});

/* ============================================================
 * 3. UI не делает write-операции в обход controller'а
 * ============================================================ */

describe('Stage 18.1 Phase 2 / 18.2.x — UI write-paths', () => {
    const modalSrc     = stripJsComments(readCopModalSources());
    /* Stage 18.2.x: teaser теперь часть composite-сводки. */
    const dashboardSrc = stripJsComments(read('js/ui/calculationStateSummary.js'));

    it('Modal НЕ импортирует store / persistence / setSetting напрямую', () => {
        assert.ok(!/from\s+['"][^'"]*\/state\/store/.test(modalSrc));
        assert.ok(!/from\s+['"][^'"]*\/services\/calcPersistence/.test(modalSrc));
        assert.ok(!/from\s+['"][^'"]*\/controllers\/calcController/.test(modalSrc));
    });

    it('Modal НЕ вызывает setSetting / setAnswer / updateActiveCalc / saveCalc', () => {
        assert.ok(!/\bsetSetting\(/.test(modalSrc));
        assert.ok(!/\bsetAnswer\(/.test(modalSrc));
        assert.ok(!/\bupdateActiveCalc\(/.test(modalSrc));
        assert.ok(!/\bsaveCalc\b/.test(modalSrc));
    });

    it('Summary teaser НЕ вызывает setSetting / setAnswer / commitActiveCalc', () => {
        assert.ok(!/\bsetSetting\(/.test(dashboardSrc));
        assert.ok(!/\bsetAnswer\(/.test(dashboardSrc));
        assert.ok(!/\bcommitActiveCalc\(/.test(dashboardSrc));
    });

    it('Controller — единственное место, где идёт patchModal с draft', () => {
        const ctlSrc = stripJsComments(read('js/controllers/costOptimizationPlannerController.js'));
        assert.match(ctlSrc, /store\.patchModal\(\s*MODAL_NAME/);
        /* В UI patchModal не вызывается. */
        assert.ok(!/store\.patchModal/.test(modalSrc));
    });
});

/* ============================================================
 * 4. Controller integration (ctx surface)
 * ============================================================ */

describe('Stage 18.1 Phase 2 — Controller ctx surface', () => {
    const ctlSrc = stripJsComments(read('js/controllers/costOptimizationPlannerController.js'));
    const appSrc = stripJsComments(read('js/app.js'));

    it('Controller экспортирует все необходимые мутаторы', () => {
        for (const fn of [
            'openCostOptimizationPlannerModal',
            'closeCostOptimizationPlannerModal',
            'setOptimizationLevel',
            'toggleOptimizationConstraint',
            'updateOptimizationDraftValue',
            'removeOptimizationDraftChange',
            'resetOptimizationDraft'
        ]) {
            assert.match(ctlSrc, new RegExp(`export function ${fn}\\s*\\(`), `missing ${fn}`);
        }
    });

    it('app.js проксирует ctx через costOptimizationCtl', () => {
        assert.match(appSrc, /import \* as costOptimizationCtl/);
        for (const fn of [
            'openCostOptimizationPlannerModal',
            'closeCostOptimizationPlannerModal',
            'setOptimizationLevel',
            'toggleOptimizationConstraint',
            'updateOptimizationDraftValue',
            'removeOptimizationDraftChange',
            'resetOptimizationDraft'
        ]) {
            assert.match(appSrc, new RegExp(`costOptimizationCtl\\.${fn}\\b`), `missing wiring for ${fn}`);
        }
    });

    it('Phase 3: controller импортирует applyOptimizationDraft и calcFromApplySnapshot из domain', () => {
        assert.match(ctlSrc, /applyOptimizationDraft\b/);
        assert.match(ctlSrc, /calcFromApplySnapshot\b/);
    });

    it('Phase 3: controller дисппатчит patches через стандартные setters', () => {
        assert.match(ctlSrc, /calcCtl\.setSetting\(/);
        assert.match(ctlSrc, /calcCtl\.setAnswer\(/);
    });

    it('Phase 3: controller использует commitActiveCalc для rollback', () => {
        assert.match(ctlSrc, /commitActiveCalc\b/);
    });
});

/* ============================================================
 * 5. Phase 3 — Apply / Rollback / Confirm wiring
 * ============================================================ */

describe('Stage 18.1 Phase 3 — Apply / Rollback / Confirm UI', () => {
    const modalSrc = stripJsComments(readCopModalSources());
    const ctlSrc   = stripJsComments(read('js/controllers/costOptimizationPlannerController.js'));
    const appSrc   = stripJsComments(read('js/app.js'));

    /* ---- Apply ---- */
    it('UI: Apply onClick вызывает ctx.applyOptimizationDraftAction', () => {
        assert.match(modalSrc, /ctx\.applyOptimizationDraftAction\(\)/);
    });

    it('Controller: applyOptimizationDraftAction — точка входа из UI', () => {
        assert.match(ctlSrc, /export function applyOptimizationDraftAction\s*\(/);
    });

    it('Controller: applyOptimizationDraftAction обнаруживает high-risk → confirming=true', () => {
        assert.match(ctlSrc, /draftHasHighRisk\(\s*cur\.draft\s*\)/);
        assert.match(ctlSrc, /patchModal\(\s*MODAL_NAME\s*,\s*\{\s*confirming:\s*true/);
    });

    it('Controller: _runApply применяет patches и сохраняет snapshot', () => {
        assert.match(ctlSrc, /function _runApply\s*\(/);
        assert.match(ctlSrc, /lastApplySnapshot:\s*result\.snapshot/);
    });

    /* ---- Inline high-risk confirmation ---- */
    it('UI: inline confirm panel рендерится при m.confirming', () => {
        assert.match(modalSrc, /renderInlineConfirmPanel\b/);
        assert.match(modalSrc, /m\.confirming/);
    });

    it('UI: confirm panel показывает high-risk changes через listHighRiskChanges', () => {
        assert.match(modalSrc, /listHighRiskChanges/);
    });

    it('UI: «Подтвердить изменения» → ctx.confirmOptimizationApply', () => {
        assert.match(modalSrc, /Подтвердить изменения/);
        assert.match(modalSrc, /ctx\.confirmOptimizationApply\(\)/);
    });

    it('UI: «Отмена» → ctx.cancelOptimizationApplyConfirm', () => {
        assert.match(modalSrc, /ctx\.cancelOptimizationApplyConfirm\(\)/);
    });

    it('UI: НЕ открывается вложенная модалка для confirmation', () => {
        /* Inline-panel — не store.openModal('confirm', ...). Должен быть
           внутри той же модалки. */
        assert.ok(!/store\.openModal\s*\(\s*['"]confirm['"]/.test(modalSrc));
    });

    /* ---- Rollback ---- */
    it('UI: rollback bar рендерится при m.lastApplySnapshot', () => {
        assert.match(modalSrc, /renderRollbackBar\b/);
        assert.match(modalSrc, /lastApplySnapshot/);
    });

    it('UI: «Откатить последнее применение» → ctx.rollbackOptimizationApply', () => {
        assert.match(modalSrc, /Откатить последнее применение/);
        assert.match(modalSrc, /ctx\.rollbackOptimizationApply\(\)/);
    });

    it('Controller: rollbackOptimizationApply восстанавливает snapshot и persist\'ит', () => {
        assert.match(ctlSrc, /export function rollbackOptimizationApply\s*\(/);
        assert.match(ctlSrc, /calcFromApplySnapshot/);
        assert.match(ctlSrc, /commitActiveCalc/);
        assert.match(ctlSrc, /lastApplySnapshot:\s*null/);
    });

    /* ---- ctx wiring ---- */
    it('app.js проксирует все Phase 3 методы через costOptimizationCtl', () => {
        for (const fn of [
            'applyOptimizationDraftAction',
            'confirmOptimizationApply',
            'cancelOptimizationApplyConfirm',
            'rollbackOptimizationApply'
        ]) {
            assert.match(appSrc, new RegExp(`costOptimizationCtl\\.${fn}\\b`),
                `missing wiring for ${fn}`);
        }
    });

    /* ---- Запрещённые формулировки (per Phase 3 спек, пункт 7) ---- */
    it('Нигде нет «Применить план» или «Автооптимизировать»', () => {
        for (const src of [modalSrc, ctlSrc, stripJsComments(read('js/ui/calculationStateSummary.js'))]) {
            assert.ok(!/Применить план/.test(src), '«Применить план» запрещено');
            assert.ok(!/Автооптимизировать/.test(src), '«Автооптимизировать» запрещено');
        }
    });

    /* ---- Не persist'ится (per Phase 3 спек, пункт 6) ---- */
    it('Controller не пишет draft / lastApplySnapshot в localStorage / persistence-keys', () => {
        assert.ok(!/STORAGE_KEYS/.test(ctlSrc),
            'draft и lastApplySnapshot — runtime-only, не storage');
        assert.ok(!/localStorage/.test(ctlSrc));
        assert.ok(!/persist\./.test(ctlSrc));
    });
});
