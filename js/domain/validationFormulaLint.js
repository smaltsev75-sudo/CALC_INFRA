/**
 * Semantic formula lint helpers.
 *
 * These checks do not make a calculation invalid; they surface dangling Q.*
 * and S.* references for UI/import warnings.
 */

import { STAND_IDS } from '../utils/constants.js';
import { getAst, isAstError } from './formula/cache.js';
import { collectReferences } from './formula/evaluator.js';

/** Допустимые имена в S.* (актуальные параметры расчёта).
    12.U31: добавлены `applyRiskFactors` (master-toggle, доб. в 9.6) и
    `resourceRatio` (per-resource override, schema v3 / 12.U12). Без них
    линтер ложно ругался на любые seed-/пользовательские формулы с этими
    ссылками. */
const KNOWN_SETTINGS = new Set([
    'bufferTask', 'bufferProject', 'kInflation', 'kSeasonal', 'kScheduleShift',
    'kContingency', 'vatEnabled', 'vatRate', 'planningHorizonYears', 'daysPerMonth',
    'period', 'phaseDurationMonths', 'standSizeRatio',
    'applyRiskFactors', 'resourceRatio',
    /* Этап 13: производные агентские множители, собираются в buildContext().
       agentStepFactor — среднее число LLM-вызовов на одну пользовательскую
       задачу (=1 при выключенном master), agentToolFactor — произведение
       на долю tool-use (sandbox-нагрузка). */
    'agentStepFactor', 'agentToolFactor'
]);

/**
 * Прогнать все формулы количества по словарю и вернуть массив предупреждений
 * вида { itemId, stand, type, ref, message }, где type — `unknownQuestion`,
 * `unknownSetting`, `parseError`. Не валит расчёт — только подсвечивает в UI.
 *
 * Используется в формула-модалке и при импорте, чтобы пользователь видел
 * висящие ссылки (опечатка в Q.pcuu, переименование вопроса и т.д.).
 */
export function lintFormulas(items, questions) {
    const warnings = [];
    const knownQuestions = new Set((questions || []).map(q => q.id));

    for (const item of items || []) {
        const applicable = new Set(item.applicableStands || STAND_IDS);
        for (const stand of STAND_IDS) {
            // Пропускаем стенды, к которым ЭК не применим — формулы там никогда
            // не выполняются, поэтому warning'и на них фантомные.
            if (!applicable.has(stand)) continue;
            const src = item.qtyFormulas?.[stand];
            const ast = getAst(src);
            if (ast === null) continue;
            if (isAstError(ast)) {
                warnings.push({
                    itemId: item.id, stand,
                    type: 'parseError',
                    message: ast.__error.message
                });
                continue;
            }
            const refs = collectReferences(ast);
            for (const qid of refs.questions) {
                if (!knownQuestions.has(qid)) {
                    warnings.push({
                        itemId: item.id, stand,
                        type: 'unknownQuestion',
                        ref: qid,
                        message: `Ссылка Q.${qid} не найдена в справочнике вопросов`
                    });
                }
            }
            for (const sid of refs.settings) {
                // sid может быть точечным путём (S.standSizeRatio.DEV → 'standSizeRatio.DEV').
                // Линтер проверяет только корень — внутренние ключи (стенды, под-параметры)
                // валидируются evaluator'ом и validateSettings отдельно.
                const root = sid.split('.')[0];
                if (!KNOWN_SETTINGS.has(root)) {
                    warnings.push({
                        itemId: item.id, stand,
                        type: 'unknownSetting',
                        ref: sid,
                        message: `Ссылка S.${sid} не относится к параметрам расчёта`
                    });
                }
            }
        }
    }
    return warnings;
}

/**
 * Найти все ЭК, ссылающиеся на конкретный вопрос (через Q.<id>) в любом стенде.
 * Используется при удалении вопроса, чтобы предупредить пользователя
 * о потенциально сломанных формулах.
 *
 * Возвращает массив { itemId, itemName, stand } — каждая ссылка отдельно.
 */
export function findQuestionUsages(questionId, items) {
    const usages = [];
    if (!questionId || !items) return usages;
    for (const item of items) {
        for (const stand of STAND_IDS) {
            const src = item.qtyFormulas?.[stand];
            const ast = getAst(src);
            if (ast === null || isAstError(ast)) continue;
            const refs = collectReferences(ast);
            if (refs.questions.includes(questionId)) {
                usages.push({ itemId: item.id, itemName: item.name, stand });
            }
        }
    }
    return usages;
}
