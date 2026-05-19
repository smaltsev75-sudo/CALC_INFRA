/**
 * Stage 17.2 Phase 4 — Controller / state / persistence / STORAGE_KEYS cleanup.
 *
 * Защищает «хвосты», которые могли уцелеть после Phase 3a/3b/3c как orphan-refs:
 *   • ctx-методы удалённых workflow'ов (provider bundled fetch / bulk / calc-diff /
 *     recommended-actions modal).
 *   • state branches удалённых модалок и UI transient state.
 *   • orphan STORAGE_KEYS (PROVIDER_PRICE_SIM_DRAFTS / SCENARIO_PACK_* / WHAT_IF_* /
 *     RECOMMENDED_ACTIONS_* / CALCULATION_DIFF_* / OPTIMIZATION_PLAYBOOK_*).
 *   • orphan persistence helpers (load/save для удалённых workflow).
 *   • orphan controller imports (после удаления модалок).
 *   • live STORAGE_KEYS / persistence / state, которые ОБЯЗАНЫ остаться (advancedMode,
 *     provider override / history, price import).
 *
 * Все source-grep-проверки используют stripJsComments — historical комментарии
 * в исходниках допустимы, проверяем именно живой код.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripJsComments } from '../../_helpers/source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf-8');

function listJsFiles(dir) {
    const out = [];
    function walk(d) {
        for (const e of readdirSync(d, { withFileTypes: true })) {
            const full = join(d, e.name);
            if (e.isDirectory()) walk(full);
            else if (e.isFile() && full.endsWith('.js')) out.push(full);
        }
    }
    walk(join(ROOT, dir));
    return out;
}

/* ============================================================
 * 1. ctx-методы удалённых workflow'ов отсутствуют в живом коде
 * ============================================================ */

describe('Phase 4 — orphan ctx-методы отсутствуют в js/', () => {
    const REMOVED_CTX = [
        // Provider bundled fetch / bulk (Phase 3a)
        'updateProviderPricesFromFetch',
        'bulkUpdateProviderPrices',
        // Calculation Diff UI (Phase 3a)
        'openCalculationDiffModal',
        'closeCalculationDiffModal',
        'setCalculationDiffTab',
        // Recommended Actions modal (Phase 3b)
        'openRecommendedActionsModal',
        'closeRecommendedActionsModal',
        'getActiveRecommendedActions',
        // Phase 3a-deleted variants
        'recommendedActionsCtl',
        'calculationDiffCtl'
    ];

    for (const name of REMOVED_CTX) {
        it(`в js/ нет живого упоминания "${name}"`, () => {
            for (const f of listJsFiles('js')) {
                const rel = f.slice(ROOT.length + 1).replace(/\\/g, '/');
                const src = stripJsComments(readFileSync(f, 'utf-8'));
                assert.equal(src.includes(name), false,
                    `${rel} содержит живое упоминание "${name}" — должно быть удалено в Stage 17.2.`);
            }
        });
    }

    it('updateProviderPrices как router-функция (Stage 8.2 legacy) не существует в ctx app.js', () => {
        // Защита от случайного восстановления ctx-метода с этим именем.
        // Проверяем именно literal-метод объекта, не подстроку (subquery
        // updateProviderPricesFromFile содержит "updateProviderPrices").
        const src = stripJsComments(read('js/app.js'));
        assert.doesNotMatch(src, /^\s*updateProviderPrices\s*\(/m,
            'app.js не должен содержать ctx-метод updateProviderPrices(...) (legacy router).');
    });

    it('updateProviderPrices как controller export (legacy router) тоже отсутствует', () => {
        const src = stripJsComments(read('js/controllers/providerController.js'));
        assert.doesNotMatch(src, /export\s+(?:async\s+)?function\s+updateProviderPrices\s*\(/,
            'providerController.js не должен экспортировать router updateProviderPrices.');
        assert.doesNotMatch(src, /export\s+(?:async\s+)?function\s+updateMultipleProviderPrices\b/,
            'providerController.js не должен экспортировать bulk updateMultipleProviderPrices.');
        assert.doesNotMatch(src, /export\s+(?:async\s+)?function\s+updateProviderPricesFromFetch\b/,
            'providerController.js не должен экспортировать FromFetch.');
    });
});

/* ============================================================
 * 2. State branches удалённых модалок отсутствуют в store
 * ============================================================ */

describe('Phase 4 — orphan state branches удалены из store', () => {
    const src = stripJsComments(read('js/state/store.js'));

    const REMOVED_BRANCHES = [
        'calculationDiff',     // Phase 3a
        'recommendedActions',  // Phase 3b
        'priceSim',            // Stage 16.6 cleanup
        'scenarioPack',        // Stage 16.6 cleanup
        'whatIf',              // Stage 16.6 cleanup
        'simulationDraft',     // Stage 16.6 cleanup
        'optimizationPlaybooks' // Stage 16.6 cleanup
    ];

    for (const name of REMOVED_BRANCHES) {
        it(`store.js не содержит state-branch "${name}"`, () => {
            assert.equal(src.includes(name), false,
                `store.js всё ещё ссылается на удалённую state-branch "${name}".`);
        });
    }

    it('state.modals.providerAnalytics не содержит selectedIds (bulk-only)', () => {
        const m = src.match(/providerAnalytics\s*:\s*\{[^}]+\}/);
        assert.ok(m, 'state.modals.providerAnalytics должен присутствовать');
        assert.doesNotMatch(m[0], /selectedIds/);
    });

    it('state.ui не содержит calculationDiff / recommendedActions / priceSim / scenarioPack', () => {
        // Чуть строже: проверяем именно ui-секцию (по grep keys внутри ui:).
        // Берём весь файл и проверяем absence — раньше разделяли по ключам, теперь
        // полный absence гарантирует обе зоны.
        for (const name of ['calculationDiff', 'recommendedActions', 'priceSim',
            'scenarioPack', 'whatIf', 'simulationDraft', 'optimizationPlaybooks']) {
            assert.doesNotMatch(src, new RegExp(`\\b${name}\\b`),
                `store.js упоминает ${name} (state.ui или state.modals).`);
        }
    });
});

/* ============================================================
 * 3. STORAGE_KEYS — orphan ключи отсутствуют, advancedMode присутствует
 * ============================================================ */

describe('Phase 4 — STORAGE_KEYS hygiene', () => {
    const src = stripJsComments(read('js/utils/constants.js'));

    const REMOVED_KEYS = [
        'PROVIDER_PRICE_SIM_DRAFTS',
        'SCENARIO_PACK',
        'WHAT_IF',
        'RECOMMENDED_ACTIONS',
        'CALCULATION_DIFF',
        'PRICE_SIM',
        'OPTIMIZATION_PLAYBOOK'
    ];

    for (const key of REMOVED_KEYS) {
        it(`STORAGE_KEYS не содержит ${key}*`, () => {
            assert.doesNotMatch(src, new RegExp(`\\b${key}\\w*`),
                `constants.js содержит orphan ключ ${key}*.`);
        });
    }

    it('STORAGE_KEYS содержит ADVANCED_MODE_ENABLED (Phase 3c live)', () => {
        assert.match(src, /ADVANCED_MODE_ENABLED\s*:\s*['"]calc\.advancedModeEnabled['"]/);
    });

    it('STORAGE_KEYS содержит PROVIDER_OVERLAY_OVERRIDES (live: applied prices)', () => {
        assert.match(src, /PROVIDER_OVERLAY_OVERRIDES\s*:/);
    });

    it('STORAGE_KEYS содержит PROVIDER_OVERRIDE_HISTORY (live: rollback chain)', () => {
        assert.match(src, /PROVIDER_OVERRIDE_HISTORY\s*:/);
    });
});

/* ============================================================
 * 4. Persistence helpers — orphan load/save отсутствуют, advancedMode присутствует
 * ============================================================ */

describe('Phase 4 — Persistence helpers hygiene', () => {
    const src = stripJsComments(read('js/state/persistence.js'));

    const REMOVED_HELPERS = [
        'loadProviderPriceSimDraft',
        'saveProviderPriceSimDraft',
        'clearProviderPriceSimDraft',
        'loadProviderPriceSimDrafts',
        'loadScenarioPack',
        'saveScenarioPack',
        'loadRecommendedActions',
        'saveRecommendedActions',
        'loadCalculationDiff',
        'saveCalculationDiff',
        'loadWhatIf',
        'saveWhatIf',
        'loadOptimizationPlaybook',
        'saveOptimizationPlaybook'
    ];

    for (const name of REMOVED_HELPERS) {
        it(`persistence.js не содержит ${name}`, () => {
            assert.equal(src.includes(name), false,
                `persistence.js содержит orphan helper "${name}".`);
        });
    }

    it('persistence.js содержит loadAdvancedModeEnabled / saveAdvancedModeEnabled (Phase 3c live)', () => {
        assert.match(src, /export\s+function\s+loadAdvancedModeEnabled\b/);
        assert.match(src, /export\s+function\s+saveAdvancedModeEnabled\b/);
    });

    it('persistence.js содержит loadProviderOverrideHistory / loadProviderOverrides (live)', () => {
        assert.match(src, /loadProviderOverrideHistory/);
        assert.match(src, /loadProviderOverrides/);
    });
});

/* ============================================================
 * 5. Controller imports — orphan controllers не импортированы
 * ============================================================ */

describe('Phase 4 — Controller import hygiene', () => {
    const REMOVED_CONTROLLER_FILES = [
        'js/controllers/calculationDiffController.js',
        'js/controllers/recommendedActionsController.js'
    ];

    for (const f of REMOVED_CONTROLLER_FILES) {
        it(`файл удалён: ${f}`, () => {
            assert.equal(existsSync(join(ROOT, f)), false,
                `${f} ещё существует — orphan controller файл.`);
        });
    }

    it('app.js не импортирует удалённые controller-модули', () => {
        const src = stripJsComments(read('js/app.js'));
        for (const name of [
            'calculationDiffController',
            'recommendedActionsController'
        ]) {
            assert.doesNotMatch(src, new RegExp(`from\\s+['"][^'"]*${name}\\.js['"]`),
                `app.js импортирует удалённый ${name}.js.`);
            assert.doesNotMatch(src, new RegExp(`import\\s+\\*?\\s*as\\s+\\w+\\s+from\\s+['"][^'"]*${name}\\.js['"]`),
                `app.js делает namespace-импорт удалённого ${name}.js.`);
        }
    });

    it('ui/index.js не регистрирует удалённые модальные render-функции', () => {
        const src = stripJsComments(read('js/ui/index.js'));
        for (const name of [
            'renderCalculationDiffModal',
            'renderRecommendedActionsModal'
        ]) {
            assert.equal(src.includes(name), false,
                `ui/index.js всё ещё ссылается на удалённый ${name}.`);
        }
    });
});

/* ============================================================
 * 6. Live invariants — что должно остаться после cleanup
 * ============================================================ */

describe('Phase 4 — Live invariants (что НЕ удаляли)', () => {
    it('domain/recommendedActions.js остаётся (используется через ctx.getActiveNextSteps)', () => {
        assert.equal(existsSync(join(ROOT, 'js/domain/recommendedActions.js')), true);
    });

    it('domain/calculationDiff.js остаётся (internal utility, см. Architecture.md §4.7)', () => {
        assert.equal(existsSync(join(ROOT, 'js/domain/calculationDiff.js')), true);
    });

    it('app.js содержит ctx-метод getActiveNextSteps (replacement для Recommended Actions)', () => {
        const src = stripJsComments(read('js/app.js'));
        assert.match(src, /getActiveNextSteps\s*\(\s*\)/);
    });

    it('app.js содержит ctx-метод updateProviderPricesFromFile (live workflow обновления прайса)', () => {
        const src = stripJsComments(read('js/app.js'));
        assert.match(src, /updateProviderPricesFromFile\s*\(/);
    });

    it('providerController.js экспортирует updateProviderPricesFromFile + applyOverrideToActiveCalc', () => {
        const src = stripJsComments(read('js/controllers/providerController.js'));
        assert.match(src, /export\s+async\s+function\s+updateProviderPricesFromFile\b/);
        assert.match(src, /export\s+function\s+applyOverrideToActiveCalc\b/);
    });

    it('app.js содержит ctx setAdvancedMode + toggleAdvancedMode (Phase 3c live)', () => {
        const src = stripJsComments(read('js/app.js'));
        assert.match(src, /setAdvancedMode\s*\(/);
        assert.match(src, /toggleAdvancedMode\s*\(/);
    });
});

/* ============================================================
 * 7. Comments hygiene — нет «длинных списков» имён удалённых функций
 * ============================================================ */

describe('Phase 4 — Comments hygiene', () => {
    /* Не ловим historical-комменты по одному имени (они полезны для
       absence-test аннотаций), но запрещаем «список из 3+ имён в одной
       строке через слэш» — типичный паттерн orphan-комментария
       вроде «openX / closeX / setXTab». */
    it('app.js не содержит длинных списков имён удалённых ctx-методов в комментариях', () => {
        const raw = read('js/app.js');
        const matches = raw.match(/\/\/.*?\b\w{6,}\s*\/\s*\w{6,}\s*\/\s*\w{6,}/g) || [];
        const offenders = matches.filter(line =>
            /open|close|update|set|get/.test(line) &&
            /Modal|Provider|Diff|Actions|Tab/.test(line)
        );
        assert.deepEqual(offenders, [],
            'Найдены historical-комментарии «X / Y / Z» в app.js — компресировать.');
    });
});
