/**
 * Stage 16.6 (PATCH 2.10.1) — architecture regression tests.
 *
 * Защищают от случайного возврата удалённых workflow'ов:
 *   • Scenario Pack Generator;
 *   • Standalone What-if / Price Simulation UI;
 *   • Mutation-style Optimization Playbooks.
 *
 * Если кто-то «случайно» добавит scenarioPackController.js, или верстальщик
 * вернёт кнопку «Применить рекомендацию» в Recommended Actions modal, или
 * UserManual.md снова обзаведётся разделом про What-if — тесты здесь упадут.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

function read(rel) {
    return readFileSync(join(ROOT, rel), 'utf-8');
}

function listFiles(dir, ext = '.js') {
    const out = [];
    function walk(d) {
        for (const e of readdirSync(d, { withFileTypes: true })) {
            const full = join(d, e.name);
            if (e.isDirectory()) walk(full);
            else if (e.isFile() && full.endsWith(ext)) out.push(full);
        }
    }
    walk(join(ROOT, dir));
    return out;
}

function stripComments(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/* ============================================================
 * 1. Scenario Pack — все ключевые артефакты удалены
 * ============================================================ */

describe('Stage 16.6 — Scenario Pack полностью удалён', () => {
    const REMOVED_FILES = [
        'js/domain/scenarioPackGenerator.js',
        'js/controllers/scenarioPackController.js',
        'js/ui/modals/scenarioPackModal.js',
        'tests/unit/domain/scenario-pack-generator.test.js',
        'tests/unit/controllers/scenario-pack-controller.test.js'
    ];

    for (const f of REMOVED_FILES) {
        it(`файл удалён: ${f}`, () => {
            assert.equal(existsSync(join(ROOT, f)), false, `${f} ещё существует`);
        });
    }

    it('в js/ нет имён openScenarioPackModal / toggleScenarioPackSelection / applyScenarioPacks / addPreparedScenario', () => {
        const files = listFiles('js');
        for (const f of files) {
            const src = stripComments(read(f.replace(ROOT + '\\', '').replace(ROOT + '/', '')));
            for (const name of ['openScenarioPackModal', 'toggleScenarioPackSelection',
                'applyScenarioPacks', 'closeScenarioPackModal', 'addPreparedScenario']) {
                assert.equal(src.includes(name), false,
                    `${f} всё ещё ссылается на ${name}`);
            }
        }
    });

    it('CSS не содержит .scenario-pack-', () => {
        const css = read('css/dashboard.css');
        assert.equal(css.includes('.scenario-pack-'), false,
            'CSS dashboard.css ещё содержит .scenario-pack-');
    });

    it('store не содержит state.modals.scenarioPack / state.ui.scenarioPack', () => {
        const store = stripComments(read('js/state/store.js'));
        assert.equal(/\bscenarioPack\b/.test(store), false,
            'store.js всё ещё ссылается на scenarioPack');
    });

    it('UserManual не содержит «Создать пакет сценариев» / «Scenario Pack»', () => {
        const um = read('UserManual.md');
        assert.equal(um.includes('Создать пакет сценариев'), false,
            'UserManual.md содержит «Создать пакет сценариев»');
        assert.equal(um.includes('Scenario Pack'), false,
            'UserManual.md содержит «Scenario Pack»');
    });
});

/* ============================================================
 * 2. What-if / Price Simulation UI — удалён
 * ============================================================ */

describe('Stage 16.6 — Standalone What-if / Price Simulation UI удалён', () => {
    const REMOVED_FILES = [
        'js/ui/modals/whatIfPriceSimModal.js',
        'tests/integration/stage-13-3-price-sim-controller.test.js',
        'tests/unit/ui/stage-13-3-price-sim-modal.test.js',
        'tests/unit/domain/calc-impact.test.js'
    ];

    for (const f of REMOVED_FILES) {
        it(`файл удалён: ${f}`, () => {
            assert.equal(existsSync(join(ROOT, f)), false, `${f} ещё существует`);
        });
    }

    it('store не содержит state.modals.priceSim', () => {
        const store = stripComments(read('js/state/store.js'));
        assert.equal(/\bpriceSim\b/.test(store), false,
            'store.js всё ещё содержит priceSim');
    });

    it('app.js не содержит ctx-методов What-if', () => {
        const app = stripComments(read('js/app.js'));
        for (const name of ['openPriceSimulation', 'setSimulationDraftPrice',
            'cancelSimulation', 'refreshSimulationImpact', 'applySimulationDraft']) {
            assert.equal(app.includes(name), false,
                `app.js всё ещё ссылается на ${name}`);
        }
    });

    it('providerController не содержит What-if функций', () => {
        const src = stripComments(read('js/controllers/providerController.js'));
        for (const name of ['openPriceSimulation', 'setSimulationDraftPrice',
            'cancelSimulation', 'refreshSimulationImpact', 'applySimulationDraft',
            '_computeSimImpact', 'simulateProviderPriceImpact']) {
            assert.equal(src.includes(name), false,
                `providerController.js всё ещё содержит ${name}`);
        }
    });

    it('STORAGE_KEYS не содержит PROVIDER_PRICE_SIM_DRAFTS', () => {
        const constants = read('js/utils/constants.js');
        assert.equal(constants.includes('PROVIDER_PRICE_SIM_DRAFTS'), false,
            'STORAGE_KEYS всё ещё содержит PROVIDER_PRICE_SIM_DRAFTS');
    });

    it('persistence.js не содержит loadProviderPriceSimDraft / saveProviderPriceSimDraft / clearProviderPriceSimDraft', () => {
        const src = stripComments(read('js/state/persistence.js'));
        for (const name of ['loadProviderPriceSimDraft', 'saveProviderPriceSimDraft',
            'clearProviderPriceSimDraft', 'loadProviderPriceSimDrafts']) {
            assert.equal(src.includes(name), false,
                `persistence.js всё ещё содержит ${name}`);
        }
    });

    it('CSS не содержит .what-if- / .price-sim-', () => {
        const css = read('css/dashboard.css');
        assert.equal(css.includes('.what-if-'), false,
            'CSS содержит .what-if-');
        assert.equal(css.includes('.price-sim-'), false,
            'CSS содержит .price-sim-');
    });

    it('UserManual не содержит «Симуляция цен» / «What-if» как пользовательскую функцию', () => {
        const um = read('UserManual.md');
        // What-if в Architecture/DECISIONS как историческая ссылка — допустимо.
        // Здесь проверяем UserManual.md — пользовательский раздел.
        assert.equal(/Симуляция цен/.test(um), false,
            'UserManual содержит «Симуляция цен»');
    });
});

/* ============================================================
 * 3. Mutation-style Optimization Playbooks — заменены на navigation
 * ============================================================ */

describe('Stage 16.6 — Mutation-style Optimization Playbooks удалены', () => {
    const REMOVED_FILES = [
        'js/domain/optimizationPlaybooks.js',
        'js/controllers/optimizationPlaybookController.js',
        'js/ui/modals/optimizationPlaybookModal.js',
        'tests/unit/domain/optimization-playbooks.test.js',
        'tests/unit/controllers/optimization-playbook-controller.test.js',
        'tests/unit/ui/stage-16-4-optimization-playbook-modal.test.js'
    ];

    for (const f of REMOVED_FILES) {
        it(`файл удалён: ${f}`, () => {
            assert.equal(existsSync(join(ROOT, f)), false, `${f} ещё существует`);
        });
    }

    it('store не содержит optimizationPlaybooks', () => {
        const store = stripComments(read('js/state/store.js'));
        assert.equal(/\boptimizationPlaybooks\b/.test(store), false,
            'store.js всё ещё ссылается на optimizationPlaybooks');
    });

    it('app.js не содержит applyOptimizationPlaybook / rollbackOptimizationPlaybook', () => {
        const app = stripComments(read('js/app.js'));
        for (const name of ['applyOptimizationPlaybook', 'rollbackOptimizationPlaybook',
            'selectOptimizationPlaybook', 'openOptimizationPlaybookModal',
            'closeOptimizationPlaybookModal']) {
            assert.equal(app.includes(name), false,
                `app.js всё ещё содержит ${name}`);
        }
    });

    it('CSS не содержит .optimization-playbook- (вне комментариев)', () => {
        // Strip CSS comments — упоминание удалённого класса в комментарии-объяснении
        // допустимо. Реальные правила должны быть удалены.
        const css = read('css/dashboard.css').replace(/\/\*[\s\S]*?\*\//g, '');
        assert.equal(css.includes('.optimization-playbook-'), false,
            'CSS содержит реальные правила .optimization-playbook-');
    });

    it('domain recommendedActions существует (используется через ctx из composite-сводки)', () => {
        // Stage 17.2/18.2: модалка, контроллер и nextSteps.js удалены, осталась
        // только pure domain функция, которую читает js/ui/calculationStateSummary.js
        // через ctx.getActiveNextSteps (берёт первый action как «следующий шаг»).
        assert.equal(existsSync(join(ROOT, 'js/domain/recommendedActions.js')), true);
        assert.equal(existsSync(join(ROOT, 'js/controllers/recommendedActionsController.js')), false,
            'controller удалён в Stage 17.2 — domain теперь читается напрямую через ctx');
        assert.equal(existsSync(join(ROOT, 'js/ui/modals/recommendedActionsModal.js')), false,
            'модалка удалена в Stage 17.2');
        assert.equal(existsSync(join(ROOT, 'js/ui/nextSteps.js')), false,
            'отдельный Dashboard-блок «Следующие шаги» удалён в Stage 18.2 — поглощён composite-сводкой');
    });

    it('Composite-сводка (calculationStateSummary.js) не содержит «Применить»/«Apply»/«Откатить»', () => {
        // Stage 18.2: проверка перенесена с nextSteps.js на composite-сводку.
        // Контракт навигации без мутаций сохранён.
        const src = stripComments(read('js/ui/calculationStateSummary.js'));
        for (const word of ['Применить', 'Откатить', 'Apply', 'Rollback']) {
            assert.equal(src.includes(word), false,
                `calculationStateSummary.js содержит mutation-style слово "${word}"`);
        }
    });
});

/* ============================================================
 * 4. Quick Start / Scenario menu не импортируют удалённые модули
 * ============================================================ */

describe('Stage 16.6 — точки входа очищены', () => {
    it('Quick Start не упоминает scenarioPack / whatIf / Optimization Playbook', () => {
        if (!existsSync(join(ROOT, 'js/ui/modals/quickStartModal.js'))) return;
        const src = stripComments(read('js/ui/modals/quickStartModal.js'));
        for (const w of ['scenarioPack', 'ScenarioPack', 'whatIf', 'WhatIf', 'optimizationPlaybook']) {
            assert.equal(src.includes(w), false, `quickStartModal содержит ${w}`);
        }
    });

    it('Scenario menu не упоминает scenarioPack', () => {
        if (!existsSync(join(ROOT, 'js/ui/modals/scenarioMenuModal.js'))) return;
        const src = stripComments(read('js/ui/modals/scenarioMenuModal.js'));
        assert.equal(/scenarioPack/i.test(src), false);
    });

    it('Scenario tabs не содержат кнопку «Пакет»', () => {
        const src = stripComments(read('js/ui/scenarioTabs.js'));
        assert.equal(src.includes('renderAddPackButton'), false,
            'scenarioTabs.js всё ещё ссылается на renderAddPackButton');
    });
});

/* ============================================================
 * 5. Recommended Actions — только navigation, никакой mutation
 * ============================================================ */

describe('Stage 16.6 — Recommended Actions navigation-only contract', () => {
    it('domain не использует setAnswer / setSetting / store.updateActiveCalc / commit', () => {
        const src = stripComments(read('js/domain/recommendedActions.js'));
        for (const w of ['setAnswer', 'setSetting', 'updateActiveCalc',
            'commit(', 'commit ', 'applyChange']) {
            assert.equal(src.includes(w), false,
                `recommendedActions.js (domain) содержит mutation-pattern "${w}"`);
        }
    });

    it('Composite-сводка (calculationStateSummary.js) не импортирует mutation-controllers', () => {
        // Stage 18.2: контракт «navigation-only Dashboard-сводка» перенесён с
        // nextSteps.js на calculationStateSummary.js (последний поглотил первый).
        const src = stripComments(read('js/ui/calculationStateSummary.js'));
        for (const w of ['calcController', 'providerController', 'updateActiveCalc',
            'setAnswer', 'setSetting']) {
            assert.equal(src.includes(w), false,
                `calculationStateSummary.js содержит mutation-pattern "${w}"`);
        }
    });

    it('UserManual.md содержит раздел про «Следующие шаги» (Stage 17.2 rename Рекомендованные действия)', () => {
        const um = read('UserManual.md');
        assert.match(um, /Следующие шаги/);
    });
});
