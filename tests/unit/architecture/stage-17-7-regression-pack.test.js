/**
 * Stage 17.7 — UX Regression Pack.
 *
 * Замораживает текущую IA-модель после Stage 17.2/17.3/17.4 source-grep
 * инвариантами. Дополняет [stage-17-3-dashboard-cta-dedup.test.js] (которая
 * проверяет конкретные 3 SHARED-метода) и [stage-17-4-sensitivity-advanced-gate]
 * (advanced gating sensitivity).
 *
 * Проверяемые инварианты:
 *   1. Полнота TARGET_DISPATCH — каждый ALLOWED_TARGET имеет route в nextSteps.
 *   2. Полнота ctx — каждый ctx-метод из TARGET_DISPATCH существует в app.js.
 *   3. Полнота SHARED CTA — каждый ctx-метод из TARGET_DISPATCH вызывается
 *      ровно из одного Dashboard-блока (nextSteps), не из health/budget.
 *   4. Sidebar advancedOnly секции скрыты по умолчанию (admin-вкладки).
 *   5. UserManual не содержит ссылок на удалённые модалки/команды.
 *   6. BROWSER_SMOKE.md существует и не пуст (Stage 17.7 doc).
 *
 * Защита: при добавлении нового ALLOWED_TARGET без route в nextSteps.js —
 * тест упадёт. При удалении ctx-метода без обновления TARGET_DISPATCH — тест
 * упадёт. При появлении дубль-CTA в health/budget — тест упадёт.
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

/* Внешний аудит #18 (PATCH 2.19.5, P1, выбор 1A): graceful skip BROWSER_SMOKE.md
 * блока — этот файл maintainer-only doc-артефакт, gitignored. */
const SKIP_BROWSER_SMOKE = !existsSync(join(ROOT, 'BROWSER_SMOKE.md'))
    ? 'maintainer-only: BROWSER_SMOKE.md отсутствует в clean clone'
    : false;

/* ============================================================
 * 1. Полнота TARGET_DISPATCH (recommendedActions ↔ nextSteps)
 * ============================================================ */

describe('Stage 17.7/18.2 — TARGET_DISPATCH покрывает все ALLOWED_TARGETS', () => {
    it('каждый ALLOWED_TARGET из recommendedActions имеет route в calculationStateSummary.js', async () => {
        const { ALLOWED_TARGETS } = await import('../../../js/domain/recommendedActions.js');
        const summarySrc = stripJsComments(read('js/ui/calculationStateSummary.js'));

        const dispatchMatch = summarySrc.match(/const\s+TARGET_DISPATCH\s*=\s*Object\.freeze\(\{([\s\S]+?)\}\)/);
        assert.ok(dispatchMatch, 'TARGET_DISPATCH не найден в calculationStateSummary.js');
        const dispatchBody = dispatchMatch[1];

        const missing = ALLOWED_TARGETS.filter(t => !new RegExp(`\\b${t}\\s*:`).test(dispatchBody));
        assert.deepEqual(missing, [],
            `ALLOWED_TARGETS без route в TARGET_DISPATCH: ${missing.join(', ')}. ` +
            'При добавлении нового target в recommendedActions нужно добавить route в calculationStateSummary.');
    });

    it('каждый route в TARGET_DISPATCH соответствует existing ctx-методу в app.js', () => {
        const summarySrc = stripJsComments(read('js/ui/calculationStateSummary.js'));
        const appSrc = stripJsComments(read('js/app.js'));

        const dispatchMatch = summarySrc.match(/const\s+TARGET_DISPATCH\s*=\s*Object\.freeze\(\{([\s\S]+?)\}\)/);
        const dispatchBody = dispatchMatch[1];

        // Извлекаем все ctx.<methodName>?.() вызовы из routes.
        const methodCalls = [...dispatchBody.matchAll(/ctx\.(\w+)\?\.?\(/g)].map(m => m[1]);
        assert.ok(methodCalls.length > 0, 'Не нашли ctx-вызовы в TARGET_DISPATCH');

        const missing = methodCalls.filter(m => !new RegExp(`${m}\\s*\\(`).test(appSrc));
        assert.deepEqual(missing, [],
            `ctx-методы из TARGET_DISPATCH отсутствуют в app.js: ${missing.join(', ')}. ` +
            'При удалении ctx-метода нужно убрать соответствующий route из calculationStateSummary.');
    });
});

/* ============================================================
 * 2. SHARED-CTA — расширение Stage 17.3 на ВСЕ targets
 * ============================================================ */

describe('Stage 17.7/18.2 — каждый shared ctx-метод вызывается ровно из одного Dashboard-блока', () => {
    const dashboardSrcs = {
        health:  stripJsComments(read('js/ui/healthChip.js')),
        summary: stripJsComments(read('js/ui/calculationStateSummary.js'))
    };

    /* Stage 18.2: после поглощения 4 карточек в composite-сводку все navigation-
       CTA живут именно в summary. healthChip остался только как sticky-chip
       в Опроснике (другая surface, не Dashboard), и он НЕ должен открывать
       никакие из этих модалок. */
    const STRICT_SHARED = [
        'openAssumptionsRegisterModal',
        'openSensitivityAnalysisModal',
        'openPriceImportMappingModal',
        'openScenarioComparisonModal',
        'openDecisionMemoModal',
        'openBudgetGuardrailsModal',
        'openGuidedCompletion'
    ];
    for (const method of STRICT_SHARED) {
        it(`ctx.${method} вызывается только из composite-сводки (Dashboard owner)`, () => {
            const occurrences = Object.entries(dashboardSrcs)
                .filter(([_name, src]) => src.includes(method))
                .map(([name]) => name);
            // Может не встречаться вообще (если фича не используется на Dashboard).
            assert.ok(occurrences.length <= 1,
                `Дубль CTA: ctx.${method} вызывается из ${occurrences.join(' + ')}. ` +
                'Должен быть только один Dashboard-владелец (calculationStateSummary).');
            if (occurrences.length === 1) {
                assert.equal(occurrences[0], 'summary',
                    `${method} вызван из ${occurrences[0]}, разрешён только summary.`);
            }
        });
    }

    /* Multi-owner legitimate: openCalculationHealthModal живёт и в summary
       (CTA «Открыть проверку») и в healthChip (sticky-chip «детали» в
       Опроснике, не на Dashboard, но в том же файле). Тест фиксирует
       исключение, чтобы случайное добавление 3-го caller'а упало. */
    it('ctx.openCalculationHealthModal — legit двойной владелец (summary + sticky-chip)', () => {
        const occurrences = Object.entries(dashboardSrcs)
            .filter(([_name, src]) => src.includes('openCalculationHealthModal'))
            .map(([name]) => name)
            .sort();
        assert.deepEqual(occurrences, ['health', 'summary'],
            'openCalculationHealthModal должен оставаться owned by summary + health-sticky-chip.');
    });
});

/* ============================================================
 * 3. Sidebar advancedOnly — admin-вкладки скрыты по умолчанию
 * ============================================================ */

describe('Stage 17.7 — Sidebar admin-секция помечена advancedOnly', () => {
    const src = stripJsComments(read('js/ui/sidebar.js'));

    it('NAV_SECTIONS содержит advancedOnly: true для админ-секции', () => {
        assert.match(src, /advancedOnly:\s*true/,
            'Должна быть хотя бы одна секция с advancedOnly: true (Администрирование).');
    });

    it('фильтр по advancedMode применяется', () => {
        assert.match(src, /\.advancedOnly\s*\|\|\s*advancedMode/,
            'Sidebar должен фильтровать advancedOnly секции через advancedMode-флаг.');
    });
});

/* ============================================================
 * 4. UserManual — нет ссылок на удалённые сущности
 * ============================================================ */

describe('Stage 17.7 — UserManual.md не содержит orphan-ссылок', () => {
    const src = read('UserManual.md');

    /* Терминология, которая должна была уйти с предыдущих этапов.
       Если регрессия документации — здесь упадёт. */
    const FORBIDDEN_TERMS = [
        'Optimization Playbook',     // удалено в Stage 16.6 (PATCH 2.10.1)
        'Apply playbook',
        'What-if модалка',
        'Scenario pack'
    ];

    for (const term of FORBIDDEN_TERMS) {
        it(`не содержит "${term}" (удалено в предыдущих этапах)`, () => {
            assert.equal(src.includes(term), false,
                `UserManual упоминает "${term}", который был удалён из кода. ` +
                'Документация должна оставаться в синхронизации с реальностью.');
        });
    }
});

/* ============================================================
 * 5. BROWSER_SMOKE.md существует и не пуст (Stage 17.7 doc-артефакт)
 * ============================================================ */

describe('Stage 17.7 — BROWSER_SMOKE.md — doc-артефакт UX regression checklist', { skip: SKIP_BROWSER_SMOKE }, () => {
    it('файл существует', () => {
        assert.equal(existsSync(join(ROOT, 'BROWSER_SMOKE.md')), true,
            'BROWSER_SMOKE.md — артефакт ручного regression-чека после изменений IA. ' +
            'Должен лежать в корне проекта.');
    });

    it('содержит секции A (Dashboard CTA dedup), B (Основные пути), C (IA / Sidebar)', () => {
        const src = read('BROWSER_SMOKE.md');
        assert.match(src, /## A\. Dashboard CTA dedup/);
        assert.match(src, /## B\. Основные пользовательские пути/);
        assert.match(src, /## C\. IA \/ Sidebar/);
    });

    it('явно требует Ctrl\\+Shift\\+R перед прогоном', () => {
        const src = read('BROWSER_SMOKE.md');
        assert.match(src, /Ctrl\+Shift\+R/i,
            'Без hard-reload ESM-кэш браузера держит старые модули — checklist бесполезен.');
    });
});
