/**
 * Валидация структур данных. Используется при импорте JSON, CRUD ЭК/вопросов
 * и сохранении расчётов. Возвращает { valid, errors[] }.
 */

import {
    STAND_IDS, CATEGORY_IDS, BILLING_INTERVAL_IDS, RESOURCE_CLASS_IDS,
    SECTION_IDS, QUESTION_TYPES, PERIOD_IDS, COST_TYPE_IDS,
    DASHBOARD_RESOURCE_LABELS, VALIDATION
} from '../utils/constants.js';
import { getAst, isAstError } from './formula/cache.js';
import { collectReferences } from './formula/evaluator.js';

/* ---------- Утилиты ---------- */

const isString = v => typeof v === 'string';
const isNumber = v => typeof v === 'number' && Number.isFinite(v);
const isBool   = v => typeof v === 'boolean';
const isArray  = v => Array.isArray(v);
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

function err(errors, path, message) {
    errors.push({ path, message });
}

/* ---------- ЭК ---------- */

/**
 * Валидация одного ЭК.
 */
export function validateItem(item, errors = [], path = '') {
    if (!isObject(item)) { err(errors, path, 'Элемент должен быть объектом'); return errors; }

    if (!isString(item.id) || item.id.trim() === '') err(errors, `${path}.id`, 'id обязателен');
    if (!isString(item.name) || item.name.trim() === '') err(errors, `${path}.name`, 'Название обязательно');
    if (isString(item.name) && item.name.length > VALIDATION.NAME_MAX) err(errors, `${path}.name`, `≤ ${VALIDATION.NAME_MAX} симв.`);
    if (!isString(item.unit) || item.unit.trim() === '') err(errors, `${path}.unit`, 'Единица измерения обязательна');
    if (isString(item.unit) && item.unit.length > VALIDATION.UNIT_MAX) err(errors, `${path}.unit`, `≤ ${VALIDATION.UNIT_MAX} симв.`);
    if (!isNumber(item.pricePerUnit)) err(errors, `${path}.pricePerUnit`, 'Цена за единицу должна быть числом');
    if (isNumber(item.pricePerUnit) && (item.pricePerUnit < VALIDATION.PRICE_MIN || item.pricePerUnit > VALIDATION.PRICE_MAX))
        err(errors, `${path}.pricePerUnit`, `Цена в диапазоне ${VALIDATION.PRICE_MIN}…${VALIDATION.PRICE_MAX}`);
    if (!CATEGORY_IDS.includes(item.category)) err(errors, `${path}.category`, `Категория должна быть из ${CATEGORY_IDS.join('/')}`);
    if (!BILLING_INTERVAL_IDS.includes(item.billingInterval))
        err(errors, `${path}.billingInterval`, `Интервал тарификации должен быть из ${BILLING_INTERVAL_IDS.join('/')}`);
    if (item.resourceClass === undefined || item.resourceClass === null || item.resourceClass === '')
        err(errors, `${path}.resourceClass`, 'resourceClass обязателен');
    else if (!RESOURCE_CLASS_IDS.includes(item.resourceClass))
        err(errors, `${path}.resourceClass`, `Класс ресурса должен быть из ${RESOURCE_CLASS_IDS.join('/')}`);
    if (item.vendor !== undefined && item.vendor !== null) {
        if (!isString(item.vendor)) err(errors, `${path}.vendor`, 'Поставщик должен быть строкой');
        else if (item.vendor.length > VALIDATION.VENDOR_MAX) err(errors, `${path}.vendor`, `≤ ${VALIDATION.VENDOR_MAX} симв.`);
    }
    if (item.description !== undefined && item.description !== null) {
        if (!isString(item.description)) err(errors, `${path}.description`, 'Описание должно быть строкой');
        else if (item.description.length > VALIDATION.DESC_MAX) err(errors, `${path}.description`, `≤ ${VALIDATION.DESC_MAX} симв.`);
    }
    if (item.formulaHelp !== undefined && item.formulaHelp !== null) {
        if (!isString(item.formulaHelp)) err(errors, `${path}.formulaHelp`, 'Справка должна быть строкой');
        else if (item.formulaHelp.length > VALIDATION.HELP_MAX) err(errors, `${path}.formulaHelp`, `≤ ${VALIDATION.HELP_MAX} симв.`);
    }
    // Метаданные актуальности цены (опциональные).
    if (item.priceUpdatedAt !== undefined && item.priceUpdatedAt !== null) {
        if (!isString(item.priceUpdatedAt))
            err(errors, `${path}.priceUpdatedAt`, 'priceUpdatedAt должно быть строкой ISO-даты');
        else if (Number.isNaN(Date.parse(item.priceUpdatedAt)))
            err(errors, `${path}.priceUpdatedAt`, 'priceUpdatedAt должно быть распарсимой ISO-датой');
    }
    if (item.priceSource !== undefined && item.priceSource !== null) {
        /* Внешний аудит #3 (2026-05-18, P1): добавлено 'provider' —
         * applyOverrideToItems нормализует priceSource из provider overlay
         * к этому значению. Раньше переносил сырой `cloud.ru/2026-Q3` и
         * validateBundle падал на 19 ошибок при re-import. */
        if (!['manual', 'csv', 'seed', 'provider'].includes(item.priceSource))
            err(errors, `${path}.priceSource`, 'priceSource: manual | csv | seed | provider');
    }
    // Тип расхода (CAPEX/OPEX) — опционально; если задан, должен быть из COST_TYPE_IDS.
    // Отсутствие значения = автоопределение по billingInterval (см. domain/costType.js).
    if (item.costType !== undefined && item.costType !== null && item.costType !== '') {
        if (!COST_TYPE_IDS.includes(item.costType))
            err(errors, `${path}.costType`, `costType: ${COST_TYPE_IDS.join(' | ')}`);
    }

    if (!isArray(item.applicableStands)) err(errors, `${path}.applicableStands`, 'Список совместимых стендов обязателен');
    else for (const s of item.applicableStands) {
        if (!STAND_IDS.includes(s)) err(errors, `${path}.applicableStands`, `Неизвестный стенд: ${s}`);
    }

    if (!isObject(item.qtyFormulas)) err(errors, `${path}.qtyFormulas`, 'qtyFormulas обязательно');
    else for (const stand of STAND_IDS) {
        const f = item.qtyFormulas[stand];
        if (f !== undefined && f !== null && f !== '' && !isString(f))
            err(errors, `${path}.qtyFormulas.${stand}`, 'Формула должна быть строкой');
        if (isString(f) && f.length > VALIDATION.FORMULA_MAX)
            err(errors, `${path}.qtyFormulas.${stand}`, `≤ ${VALIDATION.FORMULA_MAX} симв.`);
        if (isString(f) && f.trim() !== '') {
            const ast = getAst(f);
            if (isAstError(ast)) {
                err(errors, `${path}.qtyFormulas.${stand}`, `Ошибка формулы: ${ast.__error.message}`);
            }
        }
    }
    return errors;
}

/* ---------- Вопрос ---------- */

const QUESTION_ID_RE = /^[a-z][a-z0-9_]*$/;

export function validateQuestion(q, errors = [], path = '') {
    if (!isObject(q)) { err(errors, path, 'Вопрос должен быть объектом'); return errors; }
    if (!isString(q.id) || !QUESTION_ID_RE.test(q.id))
        err(errors, `${path}.id`, 'id вопроса: snake_case (только [a-z0-9_], начинается с буквы)');
    if (!SECTION_IDS.includes(q.section)) err(errors, `${path}.section`, `Раздел из ${SECTION_IDS.join('/')}`);
    if (!isString(q.title) || q.title.trim() === '') err(errors, `${path}.title`, 'Заголовок обязателен');
    if (isString(q.title) && q.title.length > VALIDATION.QUESTION_TITLE_MAX) err(errors, `${path}.title`, `≤ ${VALIDATION.QUESTION_TITLE_MAX} симв.`);
    if (!QUESTION_TYPES.includes(q.type)) err(errors, `${path}.type`, `Тип из ${QUESTION_TYPES.join('/')}`);
    if (!isNumber(q.order)) err(errors, `${path}.order`, 'Порядок должен быть числом');

    if (q.type === 'number') {
        if (q.min !== undefined && q.min !== null && !isNumber(q.min))
            err(errors, `${path}.min`, 'min должен быть числом');
        if (q.max !== undefined && q.max !== null && !isNumber(q.max))
            err(errors, `${path}.max`, 'max должен быть числом');
        if (q.step !== undefined && q.step !== null && !isNumber(q.step))
            err(errors, `${path}.step`, 'step должен быть числом');
    }

    if (q.type === 'select' || q.type === 'multiselect') {
        if (!isArray(q.options) || q.options.length === 0)
            err(errors, `${path}.options`, 'Опции обязательны');
        else if (q.options.length > VALIDATION.OPTIONS_MAX)
            err(errors, `${path}.options`, `≤ ${VALIDATION.OPTIONS_MAX} опций`);
        else for (let i = 0; i < q.options.length; i++) {
            const o = q.options[i];
            if (!isObject(o)) err(errors, `${path}.options[${i}]`, 'Опция должна быть объектом');
            else {
                if (!('value' in o)) err(errors, `${path}.options[${i}].value`, 'value обязателен');
                if (!isString(o.label) || o.label.trim() === '') err(errors, `${path}.options[${i}].label`, 'label обязателен');
            }
        }
    }
    return errors;
}

/* ---------- Расчёт ---------- */

export function validateSettings(settings, errors = [], path = 'settings') {
    if (!isObject(settings)) { err(errors, path, 'settings должен быть объектом'); return errors; }
    if (!PERIOD_IDS.includes(settings.period)) err(errors, `${path}.period`, `Период из ${PERIOD_IDS.join('/')}`);

    // Буферы и риск-коэффициенты — числа в [COEF_MIN, COEF_MAX].
    // 12.U31: null отвергаем явно — иначе Number(null) = 0 в calculator.js
    // тихо обнуляет коэффициент. undefined → дефолт через `?? DEFAULT_*`, ОК.
    for (const k of ['bufferTask', 'bufferProject', 'kInflation', 'kSeasonal', 'kScheduleShift', 'kContingency']) {
        if (settings[k] === undefined) continue;
        if (!isNumber(settings[k])) err(errors, `${path}.${k}`, `${k} должен быть числом`);
        else if (settings[k] < VALIDATION.COEF_MIN || settings[k] > VALIDATION.COEF_MAX)
            err(errors, `${path}.${k}`, `${k} в диапазоне ${VALIDATION.COEF_MIN}…${VALIDATION.COEF_MAX}`);
    }

    // НДС. 12.U31: null отвергаем (Number(null)=0 → тихое обнуление НДС).
    if (settings.vatEnabled !== undefined) {
        if (!isBool(settings.vatEnabled))
            err(errors, `${path}.vatEnabled`, 'vatEnabled должен быть булевым');
    }
    if (settings.vatRate !== undefined) {
        if (!isNumber(settings.vatRate))
            err(errors, `${path}.vatRate`, 'vatRate должен быть числом');
        else if (settings.vatRate < VALIDATION.VAT_MIN || settings.vatRate > VALIDATION.VAT_MAX)
            err(errors, `${path}.vatRate`, `vatRate в диапазоне ${VALIDATION.VAT_MIN}…${VALIDATION.VAT_MAX}`);
    }

    // 12.U31: applyRiskFactors — независимый master-toggle (см. CLAUDE.md), boolean | undefined.
    if (settings.applyRiskFactors !== undefined) {
        if (!isBool(settings.applyRiskFactors))
            err(errors, `${path}.applyRiskFactors`, 'applyRiskFactors должен быть булевым');
    }

    // Горизонт планирования.
    if (settings.planningHorizonYears !== undefined) {
        if (!isNumber(settings.planningHorizonYears))
            err(errors, `${path}.planningHorizonYears`, 'planningHorizonYears должен быть числом');
        else if (settings.planningHorizonYears < VALIDATION.PLANNING_HORIZON_MIN ||
                 settings.planningHorizonYears > VALIDATION.PLANNING_HORIZON_MAX)
            err(errors, `${path}.planningHorizonYears`,
                `planningHorizonYears в диапазоне ${VALIDATION.PLANNING_HORIZON_MIN}…${VALIDATION.PLANNING_HORIZON_MAX}`);
    }

    // Дней в месяце.
    if (settings.daysPerMonth !== undefined) {
        if (!isNumber(settings.daysPerMonth))
            err(errors, `${path}.daysPerMonth`, 'daysPerMonth должен быть числом');
        else if (settings.daysPerMonth < 1 || settings.daysPerMonth > 31)
            err(errors, `${path}.daysPerMonth`, 'daysPerMonth в диапазоне 1…31');
    }

    // Длительность фазы.
    if (settings.phaseDurationMonths !== undefined) {
        if (!isNumber(settings.phaseDurationMonths))
            err(errors, `${path}.phaseDurationMonths`, 'phaseDurationMonths должен быть числом');
        else if (settings.phaseDurationMonths < VALIDATION.PHASE_DURATION_MIN ||
                 settings.phaseDurationMonths > VALIDATION.PHASE_DURATION_MAX)
            err(errors, `${path}.phaseDurationMonths`,
                `phaseDurationMonths в диапазоне ${VALIDATION.PHASE_DURATION_MIN}…${VALIDATION.PHASE_DURATION_MAX}`);
    }

    // Доли размера стендов.
    if (settings.standSizeRatio !== undefined) {
        if (!isObject(settings.standSizeRatio))
            err(errors, `${path}.standSizeRatio`, 'standSizeRatio должен быть объектом');
        else {
            for (const stand of STAND_IDS) {
                const v = settings.standSizeRatio[stand];
                if (v === undefined) {
                    err(errors, `${path}.standSizeRatio.${stand}`, `Не задан коэффициент для ${stand}`);
                    continue;
                }
                if (!isNumber(v)) {
                    err(errors, `${path}.standSizeRatio.${stand}`, `${stand}: должно быть числом`);
                    continue;
                }
                if (v < VALIDATION.RATIO_MIN || v > VALIDATION.RATIO_MAX)
                    err(errors, `${path}.standSizeRatio.${stand}`,
                        `${stand} в диапазоне ${VALIDATION.RATIO_MIN}…${VALIDATION.RATIO_MAX}`);
            }
            // ПРОМ — эталон, всегда 1.00.
            if (settings.standSizeRatio.PROD !== undefined && settings.standSizeRatio.PROD !== 1.00)
                err(errors, `${path}.standSizeRatio.PROD`, 'PROD зафиксирован = 1.00 (эталон)');
        }
    }

    // 13.U7: aiStandFactor — независимый множитель AI-нагрузки на стенд.
    // Каждый стенд: число 0..1; PROD заперт = 1.00 как эталон. Структура опциональна —
    // legacy-расчёты до v9 заполняются миграцией.
    if (settings.aiStandFactor !== undefined) {
        if (!isObject(settings.aiStandFactor)) {
            err(errors, `${path}.aiStandFactor`, 'aiStandFactor должен быть объектом');
        } else {
            for (const stand of STAND_IDS) {
                const v = settings.aiStandFactor[stand];
                if (v === undefined) continue;
                if (!isNumber(v)) {
                    err(errors, `${path}.aiStandFactor.${stand}`, `${stand}: должно быть числом`);
                    continue;
                }
                if (v < 0 || v > 1)
                    err(errors, `${path}.aiStandFactor.${stand}`, `${stand} в диапазоне 0…1 (0 = AI выкл. на стенде, 1 = PROD-эквивалент)`);
                else if (stand === 'PROD' && v !== 1.00)
                    err(errors, `${path}.aiStandFactor.PROD`, 'PROD заперт = 1.00 (эталон AI-нагрузки)');
            }
        }
    }

    // 12.U31 (Code Review Followup, B-P1-1): per-resource ratio (12.U12 schema v3).
    // Раньше валидация полностью отсутствовала — битый resourceRatio (строка вместо
    // числа, выход из 0..5, PROD ≠ 1) проходил и попадал в state. Каждый стенд
    // опционален; внутри стенда каждый ресурс опционален; недостающие → fallback
    // в calculator.js на общий standSizeRatio (см. buildContext, 12.U12 «Вариант B»).
    if (settings.resourceRatio !== undefined) {
        if (!isObject(settings.resourceRatio)) {
            err(errors, `${path}.resourceRatio`, 'resourceRatio должен быть объектом');
        } else {
            for (const stand of STAND_IDS) {
                const row = settings.resourceRatio[stand];
                if (row === undefined) continue;
                if (!isObject(row)) {
                    err(errors, `${path}.resourceRatio.${stand}`, `${stand}: должен быть объектом ресурс→коэффициент`);
                    continue;
                }
                for (const r of DASHBOARD_RESOURCE_LABELS) {
                    const v = row[r];
                    if (v === undefined) continue;
                    if (!isNumber(v)) {
                        err(errors, `${path}.resourceRatio.${stand}.${r}`, `${stand}.${r}: должно быть числом`);
                        continue;
                    }
                    if (v < VALIDATION.RATIO_MIN || v > VALIDATION.RATIO_MAX)
                        err(errors, `${path}.resourceRatio.${stand}.${r}`,
                            `${stand}.${r} в диапазоне ${VALIDATION.RATIO_MIN}…${VALIDATION.RATIO_MAX}`);
                    else if (stand === 'PROD' && v !== 1.00)
                        err(errors, `${path}.resourceRatio.PROD.${r}`,
                            'PROD-ratio зафиксирован = 1.00 для каждого ресурса (эталон)');
                }
            }
        }
    }
    return errors;
}

/* Внутренний хелпер per-question check (PATCH 2.18.3, audit-10 P1.1).
 * Вынесен ради DRY между root.answers и scenarios[*].answers. */
function _validateAnswersAgainstQuestions(answers, qById, errors, basePath) {
    for (const [id, value] of Object.entries(answers)) {
        if (value === null) continue; // «Не знаю»
        const q = qById.get(id);
        if (!q) continue; // ответ на удалённый вопрос — не наша зона (lintFormulas/cleanup)
        const ePath = `${basePath}.${id}`;
        if (q.type === 'number' && typeof value !== 'number') {
            err(errors, ePath, `Ожидается число (тип вопроса: number)`);
        } else if (q.type === 'number' && typeof value === 'number') {
            if (typeof q.min === 'number' && value < q.min) {
                err(errors, ePath,
                    `Значение ${value} вне допустимого диапазона: меньше min=${q.min}`);
            } else if (typeof q.max === 'number' && value > q.max) {
                err(errors, ePath,
                    `Значение ${value} вне допустимого диапазона: больше max=${q.max}`);
            }
        } else if (q.type === 'boolean' && typeof value !== 'boolean') {
            err(errors, ePath, `Ожидается boolean (тип вопроса: boolean)`);
        } else if (q.type === 'select') {
            if (typeof value !== 'string' && typeof value !== 'number') {
                err(errors, ePath, `Ожидается строка/число (тип вопроса: select)`);
            } else if (isArray(q.options) && q.options.length > 0) {
                const allowed = q.options.map(o =>
                    (o && typeof o === 'object' && 'value' in o) ? o.value : o
                );
                if (!allowed.includes(value)) {
                    err(errors, ePath,
                        `Значение "${value}" вне допустимых options: [${allowed.join(', ')}]`);
                }
            }
        } else if (q.type === 'multiselect') {
            if (!isArray(value)) {
                err(errors, ePath, `Ожидается массив (тип вопроса: multiselect)`);
            } else if (isArray(q.options) && q.options.length > 0) {
                const allowed = q.options.map(o =>
                    (o && typeof o === 'object' && 'value' in o) ? o.value : o
                );
                const bad = value.filter(v => !allowed.includes(v));
                if (bad.length > 0) {
                    err(errors, ePath,
                        `Значения [${bad.join(', ')}] вне допустимых options: [${allowed.join(', ')}]`);
                }
            }
        } else if (q.type === 'text' && typeof value !== 'string') {
            err(errors, ePath, `Ожидается строка (тип вопроса: text)`);
        }
    }
}

export function validateCalculation(calc, errors = [], path = '') {
    if (!isObject(calc)) { err(errors, path || 'calc', 'Расчёт должен быть объектом'); return errors; }
    if (!isString(calc.id) || calc.id.trim() === '') err(errors, `${path}.id`, 'id обязателен');
    if (!isString(calc.name) || calc.name.trim() === '') err(errors, `${path}.name`, 'name обязателен');
    if (calc.name && calc.name.length > VALIDATION.NAME_MAX) err(errors, `${path}.name`, `≤ ${VALIDATION.NAME_MAX} симв.`);
    if (!isString(calc.version)) err(errors, `${path}.version`, 'version обязателен');

    validateSettings(calc.settings, errors, `${path}settings`);

    if (!isObject(calc.answers)) err(errors, `${path}answers`, 'answers должен быть объектом');
    else {
        // 12.U31 (Code Review Followup, A-P1-2): size-limit на строки.
        // Защита от 10MB нагрузки, которая ломает localStorage пользователя.
        for (const [k, v] of Object.entries(calc.answers)) {
            if (typeof v === 'string' && v.length > VALIDATION.ANSWER_STR_MAX)
                err(errors, `${path}answers.${k}`,
                    `Длина значения превышает ${VALIDATION.ANSWER_STR_MAX} симв.`);
        }
    }

    // view — опциональный блок настроек отображения, привязанных к расчёту
    // (например, выключенные стенды). Переносится через JSON-экспорт.
    if (calc.view !== undefined && calc.view !== null) {
        if (!isObject(calc.view)) err(errors, `${path}view`, 'view должен быть объектом');
        else if (calc.view.disabledStands !== undefined && calc.view.disabledStands !== null) {
            if (!isArray(calc.view.disabledStands))
                err(errors, `${path}view.disabledStands`, 'view.disabledStands должен быть массивом');
            else for (const s of calc.view.disabledStands) {
                if (!STAND_IDS.includes(s))
                    err(errors, `${path}view.disabledStands`, `Неизвестный стенд: ${s}`);
            }
        }
    }

    if (!isObject(calc.dictionaries)) err(errors, `${path}dictionaries`, 'dictionaries обязателен');
    else {
        if (!isArray(calc.dictionaries.items)) err(errors, `${path}dictionaries.items`, 'items должен быть массивом');
        else {
            if (calc.dictionaries.items.length > VALIDATION.ITEMS_MAX)
                err(errors, `${path}dictionaries.items`, `≤ ${VALIDATION.ITEMS_MAX} элементов`);
            const seenIds = new Set();
            calc.dictionaries.items.forEach((it, i) => {
                validateItem(it, errors, `${path}dictionaries.items[${i}]`);
                if (it && isString(it.id)) {
                    if (seenIds.has(it.id)) err(errors, `${path}dictionaries.items[${i}].id`, `Дубликат id: ${it.id}`);
                    seenIds.add(it.id);
                }
            });
        }
        if (!isArray(calc.dictionaries.questions)) err(errors, `${path}dictionaries.questions`, 'questions должен быть массивом');
        else {
            if (calc.dictionaries.questions.length > VALIDATION.QUESTIONS_MAX)
                err(errors, `${path}dictionaries.questions`, `≤ ${VALIDATION.QUESTIONS_MAX} вопросов`);
            const seenIds = new Set();
            calc.dictionaries.questions.forEach((q, i) => {
                validateQuestion(q, errors, `${path}dictionaries.questions[${i}]`);
                if (q && isString(q.id)) {
                    if (seenIds.has(q.id)) err(errors, `${path}dictionaries.questions[${i}].id`, `Дубликат id: ${q.id}`);
                    seenIds.add(q.id);
                }
            });

            // 12.U31 (Code Review Followup, A-P1-3): per-question type-check.
            // answers[id] = {nested:1} для number-вопроса раньше проходил → в PDF
            // показывался [object Object], в формулах через toNum давал 0.
            // null для любого типа = «Не знаю» (CLAUDE.md countAnswered),
            // допустимо. Проверяем только когда answers и questions согласованы.
            //
            // PATCH 2.18.3 (audit-10, P1.1): тот же per-question check применяется
            // к КАЖДОМУ scenarios[*].answers. До фикса inactive scenario
            // с invalid value давал `validationErrors 0`, и потом switchScenario
            // копировал invalid в root.
            const qById = new Map(
                calc.dictionaries.questions.filter(q => q && isString(q.id)).map(q => [q.id, q])
            );
            if (isObject(calc.answers)) {
                _validateAnswersAgainstQuestions(calc.answers, qById, errors, `${path}answers`);
            }
            if (isArray(calc.scenarios)) {
                calc.scenarios.forEach((sc, i) => {
                    if (sc && isObject(sc.answers)) {
                        _validateAnswersAgainstQuestions(
                            sc.answers, qById, errors,
                            `${path}scenarios[${i}].answers`
                        );
                    }
                });
            }
        }
    }
    return errors;
}

/**
 * Аггрегирующая обёртка: возвращает { valid, errors }.
 */
export function validate(target, kind = 'calculation') {
    const errors = [];
    if (kind === 'calculation') validateCalculation(target, errors);
    else if (kind === 'item')   validateItem(target, errors);
    else if (kind === 'question') validateQuestion(target, errors);
    else if (kind === 'settings') validateSettings(target, errors);
    return { valid: errors.length === 0, errors };
}

/* ============================================================
 * СЕМАНТИЧЕСКИЙ ЛИНТЕР ФОРМУЛ
 * ============================================================ */

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
