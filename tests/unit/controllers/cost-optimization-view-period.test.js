/**
 * Stage 18.1 follow-up — period switcher в модалке «План оптимизации стоимости».
 *
 * Контракт:
 *   - При открытии модалки viewPeriod заполняется: текущим dashboardPeriod
 *     (если есть), иначе DEFAULT_PERIOD ('monthly').
 *   - setOptimizationViewPeriod('daily'|'monthly'|'annual') меняет m.viewPeriod.
 *   - Невалидное значение — no-op.
 *   - При закрытой модалке — no-op.
 *   - Повторное открытие после close сохраняет ранее выбранный viewPeriod
 *     (через patchModal({ open:false })).
 *   - Source-grep: модалка форматирует суммы с period-суффиксом и рендерит
 *     сегментный переключатель.
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

let store, ctl, calcCtl, seed, dictMod;

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
    const calcModule  = await import('../../../js/controllers/calcController.js');
    seed              = await import('../../../js/domain/seed.js');
    dictMod           = await import('../../../js/domain/costOptimizationPlanner.js');
    store = storeModule.store;
    ctl   = ctlModule;
    calcCtl = calcModule;
});

function bootstrapCalc() {
    const dict = seed.buildSeedDictionaries();
    const answers = seed.defaultAnswersFrom(dict.questions);
    const settings = { ...seed.SEED_SETTINGS, provider: 'sbercloud' };
    const calc = {
        id: 'view-period-test',
        name: 'view-period-test',
        version: '1.0',
        schemaVersion: 16,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        settings,
        answers,
        answersMeta: {},
        dictionaries: dict,
        view: {}
    };
    store.setActiveCalc(calc);
}

describe('costOptimizationPlannerController: setOptimizationViewPeriod', () => {
    beforeEach(() => {
        store.closeAllModals();
        store.setUi({ dashboardPeriod: 'monthly' });
        bootstrapCalc();
    });

    it('open initialises viewPeriod from dashboardPeriod', () => {
        store.setUi({ dashboardPeriod: 'annual' });
        ctl.openCostOptimizationPlannerModal();
        const m = store.getState().modals.costOptimizationPlanner;
        assert.equal(m.open, true);
        assert.equal(m.viewPeriod, 'annual');
    });

    it('open falls back to DEFAULT_PERIOD when dashboardPeriod missing', () => {
        store.setUi({ dashboardPeriod: null });
        ctl.openCostOptimizationPlannerModal();
        assert.equal(
            store.getState().modals.costOptimizationPlanner.viewPeriod,
            'monthly'
        );
    });

    it('setOptimizationViewPeriod meняет viewPeriod на валидное значение', () => {
        ctl.openCostOptimizationPlannerModal();
        ctl.setOptimizationViewPeriod('daily');
        assert.equal(
            store.getState().modals.costOptimizationPlanner.viewPeriod,
            'daily'
        );
        ctl.setOptimizationViewPeriod('annual');
        assert.equal(
            store.getState().modals.costOptimizationPlanner.viewPeriod,
            'annual'
        );
    });

    it('setOptimizationViewPeriod невалидное значение — no-op', () => {
        ctl.openCostOptimizationPlannerModal();
        ctl.setOptimizationViewPeriod('weekly');
        ctl.setOptimizationViewPeriod(null);
        ctl.setOptimizationViewPeriod(undefined);
        assert.equal(
            store.getState().modals.costOptimizationPlanner.viewPeriod,
            'monthly'
        );
    });

    it('setOptimizationViewPeriod при закрытой модалке — no-op', () => {
        ctl.setOptimizationViewPeriod('daily');
        const m = store.getState().modals.costOptimizationPlanner;
        assert.ok(!m.open);
    });

    it('close (patchModal open=false) сохраняет viewPeriod, reopen восстанавливает', () => {
        ctl.openCostOptimizationPlannerModal();
        ctl.setOptimizationViewPeriod('annual');
        ctl.closeCostOptimizationPlannerModal();
        const closed = store.getState().modals.costOptimizationPlanner;
        assert.equal(closed.open, false);
        assert.equal(closed.viewPeriod, 'annual');
        ctl.openCostOptimizationPlannerModal();
        assert.equal(
            store.getState().modals.costOptimizationPlanner.viewPeriod,
            'annual'
        );
    });
});

describe('costOptimizationPlannerModal (source-grep): period switcher', () => {
    const src = stripJsComments(readCopModalSources());

    it('импортирует PERIOD_IDS / PERIOD_LABELS / DEFAULT_PERIOD из constants', () => {
        assert.match(src, /PERIOD_IDS[\s\S]*PERIOD_LABELS[\s\S]*DEFAULT_PERIOD/);
    });

    it('renderSummary читает m.viewPeriod', () => {
        assert.match(src, /m\.viewPeriod/);
    });

    it('renderPeriodSwitcher рендерит кнопки для PERIOD_IDS.map', () => {
        assert.match(src, /renderPeriodSwitcher\s*\(/);
        assert.match(src, /PERIOD_IDS\.map\s*\(/);
    });

    it('кнопка периода вызывает ctx.setOptimizationViewPeriod', () => {
        assert.match(src, /ctx\.setOptimizationViewPeriod\?\.\(/);
    });

    it('суммы домножаются на periodMul(viewPeriod) перед форматированием', () => {
        assert.match(src, /periodMul\s*\(/);
        assert.match(src, /preview\.beforeTotalMonthly\s*\*\s*mul/);
        assert.match(src, /preview\.afterTotalMonthly\s*\*\s*mul/);
        assert.match(src, /preview\.savingMonthly\s*\*\s*mul/);
    });

    it('formatRubPeriod добавляет period-суффикс (/мес, /год, /день)', () => {
        assert.match(src, /formatRubPeriod\s*\(/);
        assert.match(src, /periodSlash\s*\(/);
    });
});

describe('costOptimizationPlannerController (source-grep): viewPeriod init + setter', () => {
    const src = stripJsComments(read('js/controllers/costOptimizationPlannerController.js'));

    it('экспортирует setOptimizationViewPeriod', () => {
        assert.match(src, /export function setOptimizationViewPeriod\s*\(/);
    });

    it('init viewPeriod из state.ui.dashboardPeriod', () => {
        assert.match(src, /state\.ui\?\.dashboardPeriod/);
    });

    it('valid period через PERIOD_IDS.includes', () => {
        assert.match(src, /PERIOD_IDS\.includes\s*\(/);
    });
});

describe('app.js ctx: setOptimizationViewPeriod подключён', () => {
    const src = stripJsComments(read('js/app.js'));

    it('ctx.setOptimizationViewPeriod проксирует в costOptimizationCtl', () => {
        assert.match(
            src,
            /setOptimizationViewPeriod\s*\([^)]*\)\s*\{\s*costOptimizationCtl\.setOptimizationViewPeriod\(/
        );
    });
});
