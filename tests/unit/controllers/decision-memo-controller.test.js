/**
 * Stage 15.5 — Decision Memo controller: контекст + интеграция.
 *
 * Source-grep тесты + integration-сборка контекста на минимальном calc'е.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripJsComments } from '../../_helpers/source.js';
import { buildDecisionMemoContext } from '../../../js/controllers/decisionMemoController.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.resolve(__dirname, '../../..', rel), 'utf8');
const CONTROLLER_SRC = stripJsComments(read('js/controllers/decisionMemoController.js'));

/* ============================================================
 * Source-grep
 * ============================================================ */

describe('Stage 15.5 — controller exports', () => {
    it('экспортирует openDecisionMemoModal', () => {
        assert.match(CONTROLLER_SRC, /export\s+function\s+openDecisionMemoModal\s*\(/);
    });

    it('экспортирует buildDecisionMemoForActiveCalc', () => {
        assert.match(CONTROLLER_SRC, /export\s+function\s+buildDecisionMemoForActiveCalc\s*\(/);
    });

    it('экспортирует copyDecisionMemoForActiveCalc', () => {
        assert.match(CONTROLLER_SRC, /export\s+(?:async\s+)?function\s+copyDecisionMemoForActiveCalc\s*\(/);
    });

    it('экспортирует downloadDecisionMemoForActiveCalc', () => {
        assert.match(CONTROLLER_SRC, /export\s+function\s+downloadDecisionMemoForActiveCalc\s*\(/);
    });

    it('экспортирует buildDecisionMemoContext', () => {
        assert.match(CONTROLLER_SRC, /export\s+function\s+buildDecisionMemoContext\s*\(/);
    });

    it('импортирует evaluateCalculationHealth', () => {
        assert.match(CONTROLLER_SRC, /evaluateCalculationHealth/);
    });

    it('импортирует buildAssumptionsRegister', () => {
        assert.match(CONTROLLER_SRC, /buildAssumptionsRegister/);
    });

    it('импортирует runSensitivityAnalysis', () => {
        assert.match(CONTROLLER_SRC, /runSensitivityAnalysis/);
    });

    it('импортирует evaluateBudgetGuardrails', () => {
        assert.match(CONTROLLER_SRC, /evaluateBudgetGuardrails/);
    });
});

/* ============================================================
 * buildDecisionMemoContext (integration)
 * ============================================================ */

function makeCalc(answers = {}, overrides = {}) {
    return {
        id: 'memo-ctl',
        name: 'Memo Test',
        schemaVersion: 12,
        answers: {
            pcu_target: 1000,
            ai_llm_used: false,
            target_capex_rub: null,
            target_opex_monthly_rub: null,
            ...answers
        },
        answersMeta: {},
        settings: {
            applyRiskFactors: false,
            vatEnabled: false,
            planningHorizonYears: 1,
            phaseDurationMonths: 12,
            bufferTask: 0, bufferProject: 0,
            kInflation: 0, kSeasonal: 0, kScheduleShift: 0, kContingency: 0,
            vatRate: 0.2,
            standSizeRatio: { DEV: 0.1, IFT: 0.4, PSI: 0.5, PROD: 1.0, LOAD: 0.8 },
            resourceRatio: {},
            aiStandFactor: { DEV: 0.02, IFT: 0.2, PSI: 0.5, PROD: 1.0, LOAD: 1.0 },
            ...(overrides.settings || {})
        },
        dictionaries: overrides.dictionaries !== undefined ? overrides.dictionaries : {
            questions: [
                { id: 'pcu_target', type: 'number', title: 'Пиковая аудитория',
                  defaultValue: 500, defaultIfUnknown: 500 }
            ],
            items: [],
            settings: {}
        },
        view: { disabledStands: [] },
        providerVersion: 'sbercloud@2025-Q4'
    };
}

describe('buildDecisionMemoContext — integration', () => {
    it('null calc → context только с generatedAt', () => {
        const ctx = buildDecisionMemoContext(null);
        assert.ok(ctx.generatedAt);
        assert.equal(ctx.health, undefined);
        assert.equal(ctx.assumptions, undefined);
    });

    it('calc → возвращает context с health/assumptions/sensitivity/budget', () => {
        const ctx = buildDecisionMemoContext(makeCalc());
        assert.ok(ctx.health, 'health отсутствует');
        assert.ok(typeof ctx.health.score === 'number', 'health.score не число');
        assert.ok(ctx.assumptions, 'assumptions отсутствуют');
        assert.ok(ctx.assumptions.summary, 'assumptions.summary отсутствует');
        assert.ok(Array.isArray(ctx.assumptions.risky), 'assumptions.risky не массив');
        assert.ok(ctx.sensitivity, 'sensitivity отсутствует');
        assert.ok(Array.isArray(ctx.sensitivity.topDrivers), 'sensitivity.topDrivers не массив');
        assert.ok(ctx.budgetGuardrails, 'budgetGuardrails отсутствует');
    });

    it('parse providerId@version из calc.providerVersion', () => {
        const ctx = buildDecisionMemoContext(makeCalc());
        assert.equal(ctx.providerInfo.providerId, 'sbercloud');
        assert.equal(ctx.providerInfo.version, '2025-Q4');
    });

    it('calc.providerVersion=null И settings.provider не задан → нет providerInfo', () => {
        const calc = makeCalc();
        calc.providerVersion = null;
        const ctx = buildDecisionMemoContext(calc);
        assert.equal(ctx.providerInfo, undefined);
    });

    it('Stage 18.1.5: providerVersion отсутствует, но settings.provider=sbercloud → providerInfo через fallback', () => {
        /* Реальный кейс: пользователь выбрал в Опроснике «Cloud.ru» (settings.provider),
           но не применял price-overlay (providerVersion остался пустым). Memo должен
           показывать выбранного провайдера, а не «не указан». */
        const calc = makeCalc();
        calc.providerVersion = null;
        calc.settings = { ...(calc.settings || {}), provider: 'sbercloud' };
        const ctx = buildDecisionMemoContext(calc);
        assert.ok(ctx.providerInfo, 'providerInfo должен быть установлен через fallback на settings.provider');
        assert.equal(ctx.providerInfo.providerId, 'sbercloud');
        assert.equal(ctx.providerInfo.version, null, 'версия неизвестна — overlay не применялся');
    });

    it('Stage 18.1.5: providerInfo содержит pretty-label из PROVIDER_OVERLAYS, не raw id', () => {
        /* «sbercloud» — это internal id (сохранён для backward-compat persisted calc),
           а пользователь видит в Опроснике label «Cloud.ru (бывший SberCloud)».
           Memo должен показывать тот же label, не сырой id. */
        const calc = makeCalc();
        calc.providerVersion = null;
        calc.settings = { ...(calc.settings || {}), provider: 'sbercloud' };
        const ctx = buildDecisionMemoContext(calc);
        assert.match(ctx.providerInfo.providerLabel || '', /Cloud\.ru/,
            'providerLabel должен содержать «Cloud.ru», а не сырой id «sbercloud»');
    });

    it('Stage 18.1.5: providerVersion задан → providerLabel тоже резолвится (consistency)', () => {
        /* Чтобы один и тот же провайдер не выглядел по-разному в memo в зависимости
           от того, применён ли price-overlay. */
        const ctx = buildDecisionMemoContext(makeCalc()); // providerVersion='sbercloud@2025-Q4'
        assert.equal(ctx.providerInfo.providerId, 'sbercloud');
        assert.match(ctx.providerInfo.providerLabel || '', /Cloud\.ru/);
    });

    /* ============================================================
     * Stage 18.1.7 — production-path: actual.totalMonthly + costComposition
     * ============================================================ */

    it('Stage 18.1.7 (production-path): budgetGuardrails.actual.totalMonthly — число, не undefined', () => {
        /* После 18.1.6 fix `evaluateBudgetGuardrails` пробрасывает `actual` из
           `getBudgetGap`. Тест явно ловит регрессию: если кто-то снова уберёт
           проброс — Summary и %-колонка перестанут работать в production.
           Тест НЕ использует mock-ctx, идёт через реальный controller. */
        const ctx = buildDecisionMemoContext(makeCalc());
        assert.ok(ctx.budgetGuardrails, 'budgetGuardrails должен быть установлен в production-context');
        assert.ok(ctx.budgetGuardrails.actual, 'budgetGuardrails.actual должен быть в production-context');
        assert.ok(Number.isFinite(ctx.budgetGuardrails.actual.totalMonthly),
            'actual.totalMonthly должен быть числом — иначе % в разделе 4 и Итоговые суммы в Summary сломаются');
    });

    it('Stage 18.1.7 (production-path): ctx.costComposition.topItems — массив с агрегацией по всем стендам', () => {
        /* Decision Memo Stage 18.1.7 показывает Top-10 ЭК, агрегированных по
           всем стендам. Source данных — `calculate(calc).items[id].totalMonthly`.
           Тест проверяет, что controller собрал композицию из real calculation. */
        const ctx = buildDecisionMemoContext(makeCalc());
        assert.ok(ctx.costComposition, 'costComposition должен быть собран в production-context');
        assert.ok(Array.isArray(ctx.costComposition.topItems),
            'costComposition.topItems — массив');
        // topItems должны быть отсортированы по убыванию.
        const items = ctx.costComposition.topItems;
        for (let i = 1; i < items.length; i++) {
            assert.ok(items[i - 1].totalMonthly >= items[i].totalMonthly,
                `topItems должны быть отсортированы desc: items[${i - 1}]=${items[i - 1].totalMonthly} < items[${i}]=${items[i].totalMonthly}`);
        }
        // Никаких 0-стоимости items (исключаем технические/пустые).
        for (const it of items) {
            assert.ok(it.totalMonthly > 0, `topItems не должны содержать items с totalMonthly=0: ${it.id}`);
        }
    });

    it('budget с targets → budgetGuardrails.status не not_configured', () => {
        const ctx = buildDecisionMemoContext(makeCalc({
            target_opex_monthly_rub: 50_000,
            pcu_target: 1000
        }, {
            dictionaries: {
                questions: [
                    { id: 'pcu_target', type: 'number', title: 'PCU', defaultValue: 500, defaultIfUnknown: 500 }
                ],
                items: [
                    {
                        id: 'opex-item', name: 'OPEX item',
                        category: 'HW', resourceClass: 'COMPUTE',
                        billingInterval: 'monthly', pricePerUnit: 100,
                        qtyFormulas: { DEV: '0', IFT: '0', PSI: '0', PROD: 'Q.pcu_target', LOAD: '0' },
                        applicableStands: ['DEV', 'IFT', 'PSI', 'PROD', 'LOAD']
                    }
                ],
                settings: {}
            }
        }));
        assert.notEqual(ctx.budgetGuardrails.status, 'not_configured');
    });
});
