/**
 * Stage 18.1.1 — accordion lever-групп.
 *
 * Контракт:
 *   - openCostOptimizationPlannerModal заполняет m.openGroups дефолтом:
 *     группы с changedCount>0 ИЛИ с availableLeverCount>0 (unblocked) → open;
 *     blocked-only группы → closed.
 *   - toggleOptimizationLeverGroup(groupId) — добавляет/убирает groupId
 *     в m.openGroups. Невалидный groupId — no-op. При закрытой модалке — no-op.
 *   - Повторный open после patchModal(open:false) сохраняет ранее выбранные
 *     openGroups (если в них валидные id).
 *   - Source-grep: модалка рендерит accordion (cop-lever-groups / cop-lever-group),
 *     blocked-группы показывают inline-кнопку Разрешить.
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

let store, ctl, seed;

before(async () => {
    const m = new Map();
    globalThis.localStorage = {
        getItem: k => m.has(k) ? m.get(k) : null,
        setItem: (k, v) => m.set(k, String(v)),
        removeItem: k => m.delete(k),
        key: i => Array.from(m.keys())[i] ?? null,
        get length() { return m.size; }
    };
    const storeModule = await import('../../../js/state/store.js');
    const ctlModule   = await import('../../../js/controllers/costOptimizationPlannerController.js');
    seed              = await import('../../../js/domain/seed.js');
    store = storeModule.store;
    ctl   = ctlModule;
});

function bootstrapCalc() {
    const dict = seed.buildSeedDictionaries();
    const answers = seed.defaultAnswersFrom(dict.questions);
    const settings = { ...seed.SEED_SETTINGS, provider: 'sbercloud' };
    store.setActiveCalc({
        id: 'lg-accordion-test',
        name: 'lg-accordion-test',
        version: '1.0',
        schemaVersion: 16,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        settings,
        answers,
        answersMeta: {},
        dictionaries: dict,
        view: {}
    });
}

describe('toggleOptimizationLeverGroup + init openGroups', () => {
    beforeEach(() => {
        store.closeAllModals();
        store.setUi({ dashboardPeriod: 'monthly' });
        bootstrapCalc();
    });

    it('open инициализирует openGroups дефолтом (unblocked, есть levers)', () => {
        ctl.openCostOptimizationPlannerModal();
        const m = store.getState().modals.costOptimizationPlanner;
        assert.ok(Array.isArray(m.openGroups));
        /* infrastructure и risk ВКЛЮЧЕНЫ в дефолте AMBITIOUS — должны быть open. */
        assert.ok(m.openGroups.includes('infrastructure'), 'infrastructure open');
        assert.ok(m.openGroups.includes('risk'), 'risk open');
        /* reliability — заблокирована (allowReliabilityTradeoff=false default) → closed. */
        assert.ok(!m.openGroups.includes('reliability'), 'reliability closed (blocked)');
    });

    it('toggle сворачивает раскрытую группу', () => {
        ctl.openCostOptimizationPlannerModal();
        assert.ok(store.getState().modals.costOptimizationPlanner.openGroups.includes('infrastructure'));
        ctl.toggleOptimizationLeverGroup('infrastructure');
        assert.ok(!store.getState().modals.costOptimizationPlanner.openGroups.includes('infrastructure'));
    });

    it('toggle раскрывает свёрнутую группу (повторный клик)', () => {
        ctl.openCostOptimizationPlannerModal();
        ctl.toggleOptimizationLeverGroup('infrastructure');
        ctl.toggleOptimizationLeverGroup('infrastructure');
        assert.ok(store.getState().modals.costOptimizationPlanner.openGroups.includes('infrastructure'));
    });

    it('невалидный groupId — no-op', () => {
        ctl.openCostOptimizationPlannerModal();
        const before = [...store.getState().modals.costOptimizationPlanner.openGroups];
        ctl.toggleOptimizationLeverGroup('mystery_group');
        ctl.toggleOptimizationLeverGroup(null);
        ctl.toggleOptimizationLeverGroup(undefined);
        const after = store.getState().modals.costOptimizationPlanner.openGroups;
        assert.deepEqual(after, before);
    });

    it('toggle при закрытой модалке — no-op', () => {
        ctl.toggleOptimizationLeverGroup('infrastructure');
        const m = store.getState().modals.costOptimizationPlanner;
        assert.ok(!m.open);
    });

    it('close (patchModal) сохраняет openGroups, reopen восстанавливает', () => {
        ctl.openCostOptimizationPlannerModal();
        ctl.toggleOptimizationLeverGroup('infrastructure');
        const expectedAfterToggle = [...store.getState().modals.costOptimizationPlanner.openGroups];
        ctl.closeCostOptimizationPlannerModal();
        const closed = store.getState().modals.costOptimizationPlanner;
        assert.equal(closed.open, false);
        assert.deepEqual(closed.openGroups, expectedAfterToggle);
        ctl.openCostOptimizationPlannerModal();
        assert.deepEqual(
            store.getState().modals.costOptimizationPlanner.openGroups,
            expectedAfterToggle
        );
    });
});

describe('source-grep: модалка рендерит accordion', () => {
    const src = stripJsComments(readCopModalSources());

    it('импортирует groupOptimizationLevers вместо buildEditableLevers', () => {
        assert.match(src, /groupOptimizationLevers/);
        assert.ok(!/from '\.\.\/\.\.\/domain[^']*';[\s\S]*buildEditableLevers,/.test(src),
            'buildEditableLevers больше не в импортах');
    });

    it('empty-группы (без применимых параметров) опускаются вниз списка', () => {
        /* Партиция filter(!isEmpty) + filter(isEmpty) — empty-группы в конце. */
        assert.match(src, /isEmpty\s*=\s*\(g\)\s*=>\s*!g\.blocked\s*&&\s*g\.availableLeverCount\s*===\s*0\s*&&\s*g\.changedCount\s*===\s*0/);
        assert.match(src,
            /orderedGroups\s*=\s*\[\s*\.\.\.groups\.filter\s*\(\s*g\s*=>\s*!isEmpty\(g\)\s*\)\s*,\s*\.\.\.groups\.filter\s*\(\s*isEmpty\s*\)\s*\]/);
    });

    it('renderLeversBlock использует groupOptimizationLevers(calc, draft)', () => {
        assert.match(src, /groupOptimizationLevers\s*\(\s*calc\s*,\s*draft\s*\)/);
    });

    it('контейнер групп с классом cop-lever-groups', () => {
        assert.match(src, /cop-lever-groups/);
    });

    it('renderLeverGroup рендерит header + body', () => {
        assert.match(src, /renderLeverGroup\s*\(/);
        assert.match(src, /cop-lever-group-header/);
        assert.match(src, /cop-lever-group-body/);
    });

    it('header вызывает ctx.toggleOptimizationLeverGroup', () => {
        assert.match(src, /ctx\.toggleOptimizationLeverGroup\?\.\(/);
    });

    it('заблокированная группа имеет inline-кнопку «Разрешить ...»', () => {
        assert.match(src, /cop-lever-group-unblock/);
        assert.match(src, /ctx\.toggleOptimizationConstraint\?\.\(\s*group\.constraintKey\s*,\s*true\s*\)/);
    });

    it('aria-expanded на header attaches с openSet проверкой', () => {
        assert.match(src, /'aria-expanded'/);
        assert.match(src, /aria-controls/);
    });
});

describe('source-grep: app.js ctx и controller', () => {
    const appSrc = stripJsComments(read('js/app.js'));
    const ctlSrc = stripJsComments(read('js/controllers/costOptimizationPlannerController.js'));

    it('ctx.toggleOptimizationLeverGroup проброшен в costOptimizationCtl', () => {
        assert.match(appSrc,
            /toggleOptimizationLeverGroup\s*\([^)]*\)\s*\{\s*costOptimizationCtl\.toggleOptimizationLeverGroup\(/);
    });

    it('controller экспортирует toggleOptimizationLeverGroup', () => {
        assert.match(ctlSrc, /export function toggleOptimizationLeverGroup\s*\(/);
    });

    it('controller init использует _defaultOpenGroups при отсутствии cur.openGroups', () => {
        assert.match(ctlSrc, /_defaultOpenGroups\s*\(/);
    });
});

describe('source-grep: CSS', () => {
    const css = read('css/dashboard.css');

    it('содержит .cop-lever-groups контейнер', () => {
        assert.match(css, /\.cop-lever-groups\s*\{/);
    });

    it('содержит .cop-lever-group-header (кнопка accordion)', () => {
        assert.match(css, /\.cop-lever-group-header\s*\{/);
    });

    it('содержит .cop-lever-group-body с is-collapsed', () => {
        assert.match(css, /\.cop-lever-group-body\.is-collapsed/);
    });

    it('содержит .cop-lever-group-blocked стилизацию', () => {
        assert.match(css, /\.cop-lever-group-blocked\s*\{/);
    });
});
