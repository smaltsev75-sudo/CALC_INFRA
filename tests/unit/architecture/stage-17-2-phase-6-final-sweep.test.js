/**
 * Stage 17.2 Phase 6 — Final consistency sweep.
 *
 * Закрывает финальную приёмку Stage 17.2:
 *   1. Forbidden patterns в live-коде (js/, css/, index.html) отсутствуют.
 *   2. Live UI содержит все целевые labels (Stage 17.2 rename'ов).
 *   3. User-facing документация (UserManual.md, ReadMe.md) не упоминает
 *      удалённые workflow.
 *   4. data/providers/<id>-latest.json фикстуры остались (maintainer reference).
 *
 * Все absence-проверки используют stripJsComments / stripCssComments —
 * historical-комменты допустимы (Phase 4 §6 принцип).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripJsComments, stripCssComments } from '../../_helpers/source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf-8');

/* Внешний аудит #18 (PATCH 2.19.5, P1, выбор 1A): graceful skip для блоков,
 * читающих maintainer-only fixtures (MAINTAINER_GUIDE.md, data/providers/). */
const SKIP_USER_DOCS = !existsSync(join(ROOT, 'MAINTAINER_GUIDE.md'))
    ? 'maintainer-only: MAINTAINER_GUIDE.md отсутствует в clean clone'
    : false;
const SKIP_PROVIDERS_FIXTURES = !existsSync(join(ROOT, 'data/providers'))
    ? 'maintainer-only: data/providers/ отсутствует в clean clone'
    : false;

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

function listCssFiles(dir) {
    const out = [];
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        if (e.isFile() && e.name.endsWith('.css')) out.push(join(ROOT, dir, e.name));
    }
    return out;
}

/* ============================================================
 * 1. Forbidden patterns в live JS / CSS / HTML
 * ============================================================ */

describe('Phase 6 — Forbidden patterns в live-коде отсутствуют (stripJsComments/stripCssComments)', () => {
    /* Удалённые UI-labels и technical names. Допустимы только в historical
       комментариях (стрип убирает их перед grep'ом). */
    const FORBIDDEN_LABELS = [
        'Обновить с сервера',
        'Обновить выбранных',
        'Пустой расчёт',
        'Сравнение провайдеров',
        'Загрузить из JSON',
        'Рекомендованные действия',
        'Изменения расчёта (Stage 17.1)'
    ];

    const FORBIDDEN_TECH = [
        'Scenario Pack',
        'whatIfPriceSim',
        'priceSim',
        'recommendedActionsModal',
        'calculationDiffModal',
        'qs-preset-card-empty',
        'quickstart-empty-hint',
        'updateProviderPricesFromFetch',
        'updateMultipleProviderPrices',
        'applyProviderPriceUpdate',
        'fetchProviderPriceJson',
        'providerLatestUrl',
        'rollbackProviderPriceUpdate'
    ];

    const jsFiles = listJsFiles('js');
    const cssFiles = listCssFiles('css');

    for (const pattern of [...FORBIDDEN_LABELS, ...FORBIDDEN_TECH]) {
        it(`live JS не содержит "${pattern}"`, () => {
            const offenders = [];
            for (const f of jsFiles) {
                const src = stripJsComments(readFileSync(f, 'utf-8'));
                if (src.includes(pattern)) {
                    offenders.push(f.slice(ROOT.length + 1).replace(/\\/g, '/'));
                }
            }
            assert.deepEqual(offenders, [],
                `${pattern} живёт в живом коде: ${offenders.join(', ')}.`);
        });
    }

    for (const pattern of FORBIDDEN_TECH.filter(p => !p.includes(' '))) {
        it(`live CSS не содержит "${pattern}"`, () => {
            const offenders = [];
            for (const f of cssFiles) {
                const src = stripCssComments(readFileSync(f, 'utf-8'));
                if (src.includes(pattern)) {
                    offenders.push(f.slice(ROOT.length + 1).replace(/\\/g, '/'));
                }
            }
            assert.deepEqual(offenders, [],
                `${pattern} живёт в живом CSS: ${offenders.join(', ')}.`);
        });
    }

    it('index.html не содержит ни одного forbidden pattern', () => {
        const html = read('index.html');
        for (const p of [...FORBIDDEN_LABELS, ...FORBIDDEN_TECH]) {
            assert.equal(html.includes(p), false,
                `index.html содержит forbidden "${p}".`);
        }
    });
});

/* ============================================================
 * 2. Целевые UI labels присутствуют в live JS
 * ============================================================ */

describe('Phase 6 — Целевые UI labels присутствуют', () => {
    const jsFiles = listJsFiles('js');

    function liveContains(label) {
        return jsFiles.some(f => stripJsComments(readFileSync(f, 'utf-8')).includes(label));
    }

    const TARGET_LABELS = [
        // Stage 18.2: «Следующие шаги» больше не отдельная карточка — её
        // поглотила composite-сводка. Embedded action использует label
        // «Следующий шаг» (одно действие, не список).
        'Следующий шаг',
        'Сводка состояния расчёта',
        'Сравнение расчётов',
        'Прайс-бенчмарк',
        'Импорт JSON',
        'Экспорт JSON',
        'Импорт прайса JSON',
        'Расширенные настройки',
        'Администрирование',
        'История прайсов',
        'Тарифы активного провайдера'
    ];

    for (const label of TARGET_LABELS) {
        it(`live JS содержит target label "${label}"`, () => {
            assert.equal(liveContains(label), true,
                `Target label "${label}" не найден в живом UI-коде.`);
        });
    }
});

/* ============================================================
 * 3. User-facing docs не обещают удалённое
 * ============================================================ */

describe('Phase 6 — UserManual.md / ReadMe.md hygiene', { skip: SKIP_USER_DOCS }, () => {
    const um = read('UserManual.md');
    const rm = read('ReadMe.md');

    const FORBIDDEN_IN_USER_DOCS = [
        'Обновить с сервера',
        'Обновить выбранных',
        'Пустой расчёт',
        'Сравнение провайдеров',
        'Загрузить из JSON',
        'Рекомендованные действия',
        'Scenario Pack',
        'What-if',
        'Optimization Playbook',
        'simulateProviderPriceImpact',
        'applyProviderPriceUpdate'
    ];

    for (const p of FORBIDDEN_IN_USER_DOCS) {
        it(`UserManual.md не содержит "${p}"`, () => {
            assert.equal(um.includes(p), false,
                `UserManual.md обещает удалённый функционал «${p}».`);
        });
        it(`ReadMe.md не содержит "${p}"`, () => {
            assert.equal(rm.includes(p), false,
                `ReadMe.md обещает удалённый функционал «${p}».`);
        });
    }

    it('UserManual.md содержит все ключевые user-facing labels Stage 17.2', () => {
        for (const label of [
            'Следующие шаги', 'Прайс-бенчмарк', 'Импорт прайса JSON',
            'Расширенные настройки', 'Администрирование'
        ]) {
            assert.match(um, new RegExp(label),
                `UserManual.md не описывает label "${label}".`);
        }
    });

    it('MAINTAINER_GUIDE.md существует и описывает Provider Price Update Workflow', () => {
        assert.equal(existsSync(join(ROOT, 'MAINTAINER_GUIDE.md')), true);
        const mg = read('MAINTAINER_GUIDE.md');
        assert.match(mg, /Provider Price Update Workflow/);
    });
});

/* ============================================================
 * 4. data/providers/<id>-latest.json — maintainer-shipped reference
 * ============================================================ */

describe('Phase 6 — data/providers/* фикстуры остались', { skip: SKIP_PROVIDERS_FIXTURES }, () => {
    for (const id of ['sbercloud', 'yandex', 'vk']) {
        it(`data/providers/${id}-latest.json существует`, () => {
            assert.equal(existsSync(join(ROOT, `data/providers/${id}-latest.json`)), true);
        });
    }
});

/* ============================================================
 * 5. Удалённые тест-файлы: контроль того, что они НЕ вернулись случайно
 * ============================================================ */

describe('Phase 6 — Sweep: удалённые test-файлы не возвращены', () => {
    const REMOVED_TESTS = [
        // Phase 3a
        'tests/unit/ui/stage-17-1-calculation-diff-modal.test.js',
        'tests/unit/controllers/calculation-diff-controller.test.js',
        'tests/unit/ui/stage-4-14-quickstart-empty.test.js',
        'tests/unit/controllers/provider-universal-update.test.js',
        'tests/unit/controllers/provider-controller.test.js',
        'tests/unit/controllers/stage-10-1-bulk-update.test.js',
        'tests/unit/ui/stage-8-2-provider-update-button.test.js',
        // Phase 3b
        'tests/unit/ui/stage-16-6-recommended-actions.test.js',
        // Phase 5
        'tests/integration/provider-latest-end-to-end.test.js',
        'tests/unit/services/provider-price-rollback.test.js'
    ];

    for (const f of REMOVED_TESTS) {
        it(`${f} удалён`, () => {
            assert.equal(existsSync(join(ROOT, f)), false,
                `${f} тестировал удалённый workflow — должен быть удалён.`);
        });
    }
});
