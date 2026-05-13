/**
 * Stage 15.2 — Assumptions Register.
 *
 * Чистый domain-модуль (без DOM, store, services — только calc + SEED).
 * Классифицирует каждый ответ опросника по источнику и уровню доверия:
 *
 *   source:
 *     'quick_start'  — поле было заполнено мастером Quick Start
 *                      (calc.answersMeta[id] существует).
 *     'default'      — явный ответ отсутствует или совпадает с дефолтным
 *                      значением из словаря (q.defaultValue / q.defaultIfUnknown).
 *     'manual'       — пользователь явно задал значение, отличное от дефолта,
 *                      без wizard-meta.
 *
 *   confidence:
 *     'high'   — source === 'manual' (явный выбор пользователя).
 *     'medium' — source === 'quick_start', либо source === 'default' для
 *                некритичного поля.
 *     'low'    — source === 'default' + fieldId входит в CRITICAL_FIELDS
 *                (рискованное предположение: значение не верифицировано).
 *
 * Никаких per-field lastEditedAt / schema-миграций не требуется.
 * Legacy-расчёты (calc.answersMeta === {} или undefined) поддерживаются:
 * все non-default поля без wizard-meta считаются 'manual'.
 */

import { SEED_QUESTIONS } from './seed.js';
import { CRITICAL_FIELDS } from '../utils/constants.js';

/* ========================================================== */
/* Helpers (module-private)                                    */
/* ========================================================== */

/** Глубокое равенство для простых значений опросника (число/строка/bool/массив). */
function deepEqual(a, b) {
    if (a === b) return true;
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        return a.every((v, i) => deepEqual(v, b[i]));
    }
    return false;
}

/** Является ли значение «нет явного ответа» (null / undefined / пустой массив / пустая строка). */
function isBlank(v) {
    if (v === null || v === undefined) return true;
    if (Array.isArray(v) && v.length === 0) return true;
    if (v === '') return true;
    return false;
}

/** Является ли значение v «дефолтным» для данного вопроса q? */
function isDefaultValue(v, q) {
    if (isBlank(v)) return true;
    if (q.defaultValue !== undefined && deepEqual(v, q.defaultValue)) return true;
    if (q.defaultIfUnknown !== undefined && deepEqual(v, q.defaultIfUnknown)) return true;
    return false;
}

/** Эффективное значение: ответ пользователя или, если пусто, дефолт из словаря. */
function effectiveValue(answer, q) {
    if (!isBlank(answer)) return answer;
    if (q.defaultIfUnknown !== undefined) return q.defaultIfUnknown;
    if (q.defaultValue !== undefined) return q.defaultValue;
    return null;
}

/** Краткая строка-причина для UI. */
function buildReason(source, q) {
    if (source === 'manual') return 'Задано вручную';
    if (source === 'quick_start') return 'Заполнено мастером Quick Start';
    // source === 'default'
    if (isBlank(null) || true) {
        // уточняем: blank vs совпадает с дефолтом
        return 'Использовано значение по умолчанию';
    }
}

/* ========================================================== */
/* Public API                                                  */
/* ========================================================== */

/**
 * Строит регистр допущений для calc.
 *
 * @param {object|null} calc
 * @returns {Array<{
 *   fieldId: string,
 *   label: string,
 *   value: *,
 *   source: 'manual'|'quick_start'|'default',
 *   confidence: 'high'|'medium'|'low',
 *   reason: string,
 *   scenarioId: null
 * }>}
 */
export function buildAssumptionsRegister(calc) {
    if (!calc) return [];

    const questions = calc.dictionaries?.questions || SEED_QUESTIONS;
    const answers   = calc.answers     || {};
    const meta      = calc.answersMeta || {};

    const register = [];

    for (const q of questions) {
        const answer = answers[q.id];
        const hasMeta = meta[q.id] != null;

        // ---- Определяем источник ----
        let source;
        if (hasMeta) {
            source = 'quick_start';
        } else if (isDefaultValue(answer, q)) {
            source = 'default';
        } else {
            source = 'manual';
        }

        // ---- Определяем доверие ----
        let confidence;
        if (source === 'manual') {
            confidence = 'high';
        } else if (source === 'quick_start') {
            confidence = 'medium';
        } else {
            // source === 'default'
            confidence = CRITICAL_FIELDS.includes(q.id) ? 'low' : 'medium';
        }

        register.push({
            fieldId:    q.id,
            label:      q.title || q.id,
            value:      effectiveValue(answer, q),
            source,
            confidence,
            reason:     buildReason(source, q),
            scenarioId: null
        });
    }

    return register;
}

/**
 * Группирует элементы регистра по источнику.
 *
 * @param {Array} register — результат buildAssumptionsRegister
 * @returns {{ manual: Array, quick_start: Array, default: Array }}
 */
export function groupAssumptionsBySource(register) {
    const groups = { manual: [], quick_start: [], default: [] };
    for (const a of register) {
        const key = a.source;
        if (groups[key]) groups[key].push(a);
        else groups.default.push(a); // fallback
    }
    return groups;
}

/**
 * Возвращает рискованные допущения: только confidence='low'.
 *
 * @param {Array} register — результат buildAssumptionsRegister
 * @returns {Array}
 */
export function getRiskyAssumptions(register) {
    return register.filter(a => a.confidence === 'low');
}

/**
 * Возвращает краткую сводку источников данных для calc.
 *
 * @param {object|null} calc
 * @returns {{ manual: number, quick_start: number, default: number }}
 */
export function getManualOverrideSummary(calc) {
    const register = buildAssumptionsRegister(calc);
    const summary = { manual: 0, quick_start: 0, default: 0 };
    for (const a of register) {
        if (a.source in summary) summary[a.source]++;
    }
    return summary;
}
