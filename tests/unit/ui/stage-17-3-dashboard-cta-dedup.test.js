/**
 * Stage 17.3 — Dashboard CTA dedup (обновлено в Stage 18.2).
 *
 * Контракт (после Stage 18.2):
 *   • Композитная «Сводка состояния расчёта» (calculationStateSummary.js) —
 *     единственный Dashboard-блок, владеющий health / budget / next-step CTA.
 *   • Health-chip в Опроснике (renderHealthStickyChip) НЕ владеет навигацией
 *     к Допущениям / Чувствительности / Memo.
 *   • Один target — один CTA на Dashboard.
 *
 * Защитный механизм: source-grep тесты + контроль ctx-методов, которые
 * ВЫЗЫВАЮТСЯ из конкретных модулей. Без рендеринга — pure source.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripJsComments } from '../../_helpers/source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf-8');

/* ============================================================
 * 1. healthChip.js (Опросник sticky-chip) — без навигационных хабов
 * ============================================================ */

describe('Stage 17.3/18.2 — healthChip.js не владеет навигационными CTA', () => {
    const src = stripJsComments(read('js/ui/healthChip.js'));

    it('НЕ содержит «Допущения»  — owned by composite-сводкой', () => {
        assert.doesNotMatch(src, /['"`]Допущения['"`]/,
            'health-chip дублирует CTA «Допущения» — должно жить только в Сводке состояния.');
    });

    it('НЕ содержит «Анализ чувствительности» — owned by composite-сводкой', () => {
        assert.equal(src.includes('Анализ чувствительности'), false,
            'health-chip дублирует CTA «Анализ чувствительности» — должно жить только в Сводке состояния.');
    });

    it('НЕ содержит «Сформировать memo» — owned by composite-сводкой', () => {
        assert.equal(src.includes('Сформировать memo'), false,
            'health-chip дублирует CTA «Сформировать memo» — должно жить только в Сводке состояния.');
    });

    it('НЕ вызывает ctx.openAssumptionsRegisterModal / openSensitivityAnalysisModal / openDecisionMemoModal', () => {
        for (const name of ['openAssumptionsRegisterModal',
            'openSensitivityAnalysisModal', 'openDecisionMemoModal']) {
            assert.equal(src.includes(name), false,
                `healthChip.js вызывает ctx.${name} — этот target владеет Сводка состояния.`);
        }
    });
});

/* ============================================================
 * 2. Composite-сводка — единственный CTA-владелец трёх targets
 * ============================================================ */

describe('Stage 18.2 — composite-сводка владеет навигационными next-step targets', () => {
    const summarySrc = stripJsComments(read('js/ui/calculationStateSummary.js'));
    const domainSrc  = stripJsComments(read('js/domain/recommendedActions.js'));

    it('TARGET_DISPATCH в calculationStateSummary.js диспатчит assumptions_register', () => {
        assert.match(summarySrc, /assumptions_register:\s*\(ctx\)\s*=>\s*ctx\.openAssumptionsRegisterModal/);
    });

    it('TARGET_DISPATCH в calculationStateSummary.js диспатчит sensitivity_analysis', () => {
        assert.match(summarySrc, /sensitivity_analysis:\s*\(ctx\)\s*=>\s*ctx\.openSensitivityAnalysisModal/);
    });

    it('TARGET_DISPATCH в calculationStateSummary.js диспатчит decision_memo', () => {
        assert.match(summarySrc, /decision_memo:\s*\(ctx\)\s*=>\s*ctx\.openDecisionMemoModal/);
    });

    it('domain buildRecommendedActions формирует action с target=assumptions_register для risky.length >= 3', () => {
        assert.match(domainSrc, /target:\s*['"]assumptions_register['"]/);
    });

    it('domain buildRecommendedActions формирует action с target=sensitivity_analysis (budget driver)', () => {
        assert.match(domainSrc, /target:\s*['"]sensitivity_analysis['"]/);
    });

    it('domain buildRecommendedActions формирует action с target=decision_memo (default low-priority)', () => {
        assert.match(domainSrc, /target:\s*['"]decision_memo['"]/);
    });
});

/* ============================================================
 * 3. Behavioural — buildRecommendedActions выдаёт assumptions action
 *    при risky-assumptions сценарии (контракт data → CTA invariance)
 * ============================================================ */

describe('Stage 17.3 — Сводка состояния содержит assumptions-action при risky assumptions', () => {
    it('buildRecommendedActions с risky-list (≥3) включает action target=assumptions_register', async () => {
        const { buildRecommendedActions } = await import('../../../js/domain/recommendedActions.js');
        const calc = {
            id: 'cta-dedup-1', name: 't', schemaVersion: 16,
            answers: {}, answersMeta: {},
            settings: {
                applyRiskFactors: false, vatEnabled: false, vatRate: 0,
                planningHorizonYears: 1, phaseDurationMonths: 12,
                standSizeRatio: { DEV: 0.16, IFT: 0.4, PSI: 0.5, LOAD: 0.8, PROD: 1.0 },
                resourceRatio: {},
                aiStandFactor: { DEV: 0.02, IFT: 0.2, PSI: 0.5, PROD: 1.0, LOAD: 1.0 }
            },
            dictionaries: { questions: [], items: [], settings: {} },
            view: { disabledStands: [] }
        };
        const actions = buildRecommendedActions(calc, {
            healthResult: { findings: [], score: 100, counts: {} },
            assumptionsRegister: {
                all: [],
                risky: [
                    { id: 'a1', risk: 'high' },
                    { id: 'a2', risk: 'high' },
                    { id: 'a3', risk: 'high' }
                ]
            },
            budgetStatus: { status: 'ok', capex: { target: null }, opex: { target: null } }
        });
        const assumptionsAction = actions.find(a => a.target === 'assumptions_register');
        assert.ok(assumptionsAction,
            'При risky.length >= 3 в Сводке состояния обязан появиться action assumptions_register.');
    });
});

/* ============================================================
 * 4. Dashboard global invariant: один target — один CTA
 * ============================================================ */

describe('Stage 18.2 — Один target = один CTA на Dashboard', () => {
    const dashboardSrcs = {
        health:  stripJsComments(read('js/ui/healthChip.js')),
        summary: stripJsComments(read('js/ui/calculationStateSummary.js'))
    };

    /* Каждый ctx-метод из этого списка должен вызываться РОВНО в одном
       Dashboard-блоке. Если он встречается в двух — это дубль CTA.

       openCalculationHealthModal не в списке: помимо composite-сводки он
       используется sticky-chip'ом в Опроснике (другая surface, не Dashboard). */
    const SHARED_CTX_METHODS = [
        'openAssumptionsRegisterModal',
        'openSensitivityAnalysisModal',
        'openDecisionMemoModal',
        'openBudgetGuardrailsModal'
    ];

    for (const method of SHARED_CTX_METHODS) {
        it(`ctx.${method} вызывается ровно в одном Dashboard-блоке`, () => {
            const occurrences = Object.entries(dashboardSrcs)
                .filter(([_name, src]) => src.includes(method))
                .map(([name]) => name);
            assert.equal(occurrences.length, 1,
                `Дубль CTA: ctx.${method} вызывается из ${occurrences.join(' + ')}. ` +
                'Должен быть только один Dashboard-владелец (Stage 18.2).');
            assert.equal(occurrences[0], 'summary',
                `${method} должен жить только в calculationStateSummary.js, найден в ${occurrences[0]}.`);
        });
    }
});
