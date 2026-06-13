/**
 * Stage 15.5 — Decision Memo controller.
 *
 * Собирает контекст из четырёх domain-модулей (health, assumptions, sensitivity,
 * budgetGuardrails) и передаёт в service-слой `decisionMemoExport`. Контроллер
 * — единственное место, где для memo стартует sensitivity-анализ (через
 * existing budgetGuardrailsController-кэш по revision).
 *
 * Layer compliance: импортирует только store / domain / services. UI зовёт
 * через ctx.
 */

import { store } from '../state/store.js';
import {
    buildDecisionMemo,
    buildDecisionMemoMarkdown,
    buildMemoFilename,
    copyDecisionMemoToClipboard,
    downloadDecisionMemoMarkdown
} from '../services/decisionMemoExport.js';
import { evaluateCalculationHealth } from '../domain/calculationHealth.js';
import {
    buildAssumptionsRegister,
    getRiskyAssumptions,
    getManualOverrideSummary
} from '../domain/assumptionsRegister.js';
import { runSensitivityAnalysis, rankSensitivityDrivers } from '../domain/sensitivityAnalysis.js';
import { evaluateBudgetGuardrails } from '../domain/budgetGuardrails.js';
import { getCalculationProviderPriceActuality } from '../domain/providerPriceTrust.js';
import { calculate } from '../domain/calculator.js';

/* ============================================================
 * Кэш sensitivity (module-scope, keyed by calc reference — RISK-2)
 *
 * NB: sensitivityAnalysisModal.js и budgetGuardrailsController.js держат
 * каждый свой module-scope кэш. Дублирование намеренное — изоляция модулей
 * важнее экономии 30кб; consensus pattern по проекту.
 *
 * Ключ — ИДЕНТИЧНОСТЬ объекта calc (store создаёт новый объект на каждую
 * мутацию). Прежний calc.calcRevision был всегда undefined (revision живёт
 * на store-root) → memo не срабатывал, sensitivity перебирался каждый вызов.
 * ============================================================ */

let _cachedCalc = null;
let _cachedSensitivity = null;

function getOrRunSensitivity(calc) {
    if (!calc) return { results: [], notAvailable: [] };
    if (calc === _cachedCalc && _cachedSensitivity) {
        return _cachedSensitivity;
    }
    _cachedCalc = calc;
    _cachedSensitivity = runSensitivityAnalysis(calc);
    return _cachedSensitivity;
}

/* ============================================================
 * Сборка контекста из domain
 * ============================================================ */

/**
 * Собирает context для buildDecisionMemo*. Каждая ветка устойчива к падению
 * соответствующего domain-модуля — memo всё равно соберётся (с заглушками).
 *
 * @param {object|null} calc
 * @returns {object} context
 */
export function buildDecisionMemoContext(calc) {
    if (!calc) {
        return { generatedAt: new Date().toISOString() };
    }

    const ctx = { generatedAt: new Date().toISOString() };

    // Health
    try {
        const h = evaluateCalculationHealth(calc);
        ctx.health = {
            score: h?.score,
            counts: h?.counts,
            findings: h?.findings || []
        };
    } catch (_e) { /* health недоступен — секция покажет заглушку */ }

    // Assumptions
    try {
        const register = buildAssumptionsRegister(calc);
        ctx.assumptions = {
            summary: getManualOverrideSummary(calc),
            risky: getRiskyAssumptions(register)
        };
    } catch (_e) { /* assumptions недоступны */ }

    // Sensitivity (top-5 по 'total')
    try {
        const { results } = getOrRunSensitivity(calc);
        const ranked = rankSensitivityDrivers(results, 'total');
        ctx.sensitivity = {
            topDrivers: ranked.slice(0, 5)
        };
    } catch (_e) { /* sensitivity недоступен */ }

    // Budget Guardrails — переиспользуем те же sensitivity-results.
    try {
        const sensResults = ctx.sensitivity?.topDrivers
            ? getOrRunSensitivity(calc).results : [];
        ctx.budgetGuardrails = evaluateBudgetGuardrails(calc, sensResults);
    } catch (_e) { /* budget недоступен */ }

    // Provider info — дата/версия именно того прайса, по которому посчитан calc:
    // calc.providerVersion (если зафиксирован) → bundled provider JSON.
    const priceActuality = getCalculationProviderPriceActuality(calc);
    if (priceActuality.providerId || priceActuality.version) {
        ctx.providerInfo = {
            providerId: priceActuality.providerId,
            providerLabel: priceActuality.providerLabel,
            version: priceActuality.version || null,
            updatedAt: priceActuality.date || null,
            priceActuality: priceActuality.label,
            status: calc.providerVersion ? 'unknown' : null
        };
    }

    /* Stage 18.1.7: Состав стоимости — топ-10 ЭК, агрегированных по всем стендам,
       + Pareto-метрика. Source — `calculate(calc).items[id].totalMonthly` (это
       уже агрегат по стендам, не per-stand). Исключаем items с totalMonthly = 0
       (технические/неактивные) и items без metadata в dictionaries. */
    try {
        const result = calculate(calc);
        const itemsById = Object.fromEntries(
            ((calc?.dictionaries?.items) || []).map(it => [it.id, it])
        );
        const itemsAgg = Object.entries(result?.items || {})
            .map(([id, agg]) => ({
                id,
                totalMonthly: Number(agg?.totalMonthly) || 0,
                item: itemsById[id] || null
            }))
            .filter(x => x.totalMonthly > 0 && x.item)
            .sort((a, b) => b.totalMonthly - a.totalMonthly);

        const totalAll = itemsAgg.reduce((s, x) => s + x.totalMonthly, 0);
        let acc = 0;
        let paretoNeeded = 0;
        for (const x of itemsAgg) {
            acc += x.totalMonthly;
            paretoNeeded++;
            if (totalAll > 0 && acc / totalAll >= 0.80) break;
        }
        const top10Sum = itemsAgg.slice(0, 10).reduce((s, x) => s + x.totalMonthly, 0);
        const top10Share = totalAll > 0 ? top10Sum / totalAll : 0;

        ctx.costComposition = {
            totalAll,
            topItems: itemsAgg.slice(0, 10).map(x => ({
                id:           x.id,
                name:         x.item?.name || x.id,
                category:     x.item?.category || null,
                totalMonthly: x.totalMonthly,
                share:        totalAll > 0 ? x.totalMonthly / totalAll : 0
            })),
            paretoNeeded,
            top10Share
        };
    } catch (_e) { /* costComposition недоступен — секция покажет заглушку */ }

    // Active scenario (Stage 14.x) — если в calc есть scenarios[active]
    const activeScenarioId = calc.activeScenarioId || null;
    if (activeScenarioId && Array.isArray(calc.scenarios)) {
        const sc = calc.scenarios.find(s => s.id === activeScenarioId);
        if (sc) ctx.activeScenario = { id: sc.id, name: sc.name };
    }

    return ctx;
}

/* ============================================================
 * Public API (вызывается из app.js / ctx)
 * ============================================================ */

/**
 * Открыть модалку «Обоснование расчёта».
 */
export function openDecisionMemoModal() {
    store.openModal('decisionMemo');
}

/**
 * Построить memo (Markdown + объект секций) для активного расчёта.
 * Возвращает null, если активного расчёта нет.
 */
export function buildDecisionMemoForActiveCalc() {
    const { activeCalc } = store.getState();
    if (!activeCalc) return null;
    const context = buildDecisionMemoContext(activeCalc);
    return {
        memo: buildDecisionMemo(activeCalc, context),
        markdown: buildDecisionMemoMarkdown(activeCalc, context),
        filename: buildMemoFilename(activeCalc),
        calcName: activeCalc.name || ''
    };
}

/**
 * Скопировать memo в буфер обмена. Возвращает Promise<boolean>.
 * Сам по себе НЕ показывает snackbar — UI слой решает.
 */
export async function copyDecisionMemoForActiveCalc() {
    const built = buildDecisionMemoForActiveCalc();
    if (!built) return false;
    return copyDecisionMemoToClipboard(built.markdown);
}

/**
 * Скачать memo как .md. Возвращает true если запустили download, false если нет calc.
 */
export function downloadDecisionMemoForActiveCalc() {
    const built = buildDecisionMemoForActiveCalc();
    if (!built) return false;
    downloadDecisionMemoMarkdown(built.markdown, built.filename);
    return true;
}
