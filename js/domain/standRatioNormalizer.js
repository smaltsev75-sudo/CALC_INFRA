/**
 * Post-migration нормализатор для standSizeRatio / resourceRatio.
 *
 * Контекст (PATCH 2.19.2, audit #15 P1+P1/P2): migration v11→v12 (двусторонний
 * clamp) и v2→v3 (init resourceRatio) запускаются ТОЛЬКО для legacy calc'ов
 * со schemaVersion < 12 / < 3 соответственно. Calc, уже сохранённые на
 * LATEST schemaVersion (например, созданные в 2.19.0 без resourceRatio), эти
 * шаги не пройдут — `migrateCalculation` пропускает любой step где
 * `step.to <= current_schemaVersion` ([state/migrations.js#L648-661]).
 *
 * Pattern взят из [domain/deprecatedQuestions.js#sanitizeDeprecatedQuestions]:
 * idempotent post-migration sanitizer, который применяется независимо от
 * schemaVersion. Вызывается в shared pipeline [services/loadedCalc.js#prepareLoadedCalc]
 * для всех load-paths: openCalc, initFromStorage, importCalcFromFile,
 * buildStateBundle, applyStateBundle.
 *
 * Что делает:
 *   1. resourceRatio отсутствует ИЛИ не объект → инициализирует из
 *      standSizeRatio (или DEFAULT_STAND_SIZE_RATIO). Симметрично миграции
 *      v2→v3 (state/migrations.js:142-174), но без bump'а schemaVersion.
 *   2. standSizeRatio[stand] вне [STAND_RATIO_RANGES[stand].min..max] →
 *      clamp в диапазон. Симметрично миграции v11→v12 (двусторонний после
 *      audit #14 P1#2).
 *   3. resourceRatio[stand][resource] вне диапазона → clamp.
 *   4. resourceRatio[stand] отсутствует частично → заполнить из общего
 *      standSizeRatio[stand].
 *
 * Идемпотентность: повторный вызов на нормализованном calc — no-op (clamp в
 * пределах диапазона возвращает то же значение, отсутствующие поля уже
 * заполнены).
 */

import {
    STAND_IDS,
    DASHBOARD_RESOURCE_LABELS,
    STAND_RATIO_RANGES,
    DEFAULT_STAND_SIZE_RATIO
} from '../utils/constants.js';

function _clampStandRatio(stand, value) {
    const range = STAND_RATIO_RANGES[stand];
    if (!range || !Number.isFinite(value)) return value;
    if (value < range.min) return range.min;
    if (value > range.max) return range.max;
    return value;
}

/**
 * Идемпотентная нормализация standSizeRatio и resourceRatio.
 * Мутирует переданный calc; возвращает true если что-то изменилось.
 *
 * @param {object} calc — calc-объект после migrateCalculation.
 * @returns {boolean} changed
 */
export function normalizeStandRatios(calc) {
    if (!calc || typeof calc !== 'object') return false;
    const s = calc.settings;
    if (!s || typeof s !== 'object') return false;

    let changed = false;

    // 1. standSizeRatio: clamp двусторонний.
    if (s.standSizeRatio && typeof s.standSizeRatio === 'object') {
        for (const stand of STAND_IDS) {
            const v = s.standSizeRatio[stand];
            if (!Number.isFinite(v)) continue;
            const clamped = _clampStandRatio(stand, v);
            if (clamped !== v) {
                s.standSizeRatio[stand] = clamped;
                changed = true;
            }
        }
    } else {
        // settings.standSizeRatio полностью отсутствует — берём дефолты.
        s.standSizeRatio = { ...DEFAULT_STAND_SIZE_RATIO };
        changed = true;
    }

    // 2. resourceRatio: инициализация + clamp.
    if (!s.resourceRatio || typeof s.resourceRatio !== 'object') {
        s.resourceRatio = {};
        changed = true;
    }
    for (const stand of STAND_IDS) {
        const standDefault = stand === 'PROD'
            ? 1.00
            : (Number.isFinite(s.standSizeRatio?.[stand])
                ? s.standSizeRatio[stand]
                : DEFAULT_STAND_SIZE_RATIO[stand]);
        const standDefaultClamped = _clampStandRatio(stand, standDefault);

        if (!s.resourceRatio[stand] || typeof s.resourceRatio[stand] !== 'object') {
            s.resourceRatio[stand] = {};
            changed = true;
        }
        for (const resource of DASHBOARD_RESOURCE_LABELS) {
            const v = s.resourceRatio[stand][resource];
            if (typeof v !== 'number' || !Number.isFinite(v)) {
                // Отсутствует или невалидно — наследуем общий standDefault (clamped).
                s.resourceRatio[stand][resource] = stand === 'PROD' ? 1.00 : standDefaultClamped;
                changed = true;
                continue;
            }
            // PROD — эталон, всегда 1.00.
            if (stand === 'PROD' && v !== 1.00) {
                s.resourceRatio.PROD[resource] = 1.00;
                changed = true;
                continue;
            }
            const clamped = _clampStandRatio(stand, v);
            if (clamped !== v) {
                s.resourceRatio[stand][resource] = clamped;
                changed = true;
            }
        }
    }

    return changed;
}

/**
 * Имеет ли calc какие-либо settings, выходящие за нормализованный диапазон.
 * Используется для определения needsPersist в prepareLoadedCalc — экономия
 * write-load для clean calc'ов.
 *
 * Реализация: вызываем normalize на deep-copy и сравниваем JSON-снапшоты
 * (паттерн enrichChanged из loadedCalc.js). Возвращает true если нормализация
 * меняет данные.
 */
export function hasNonNormalizedStandRatios(calc) {
    if (!calc || typeof calc !== 'object' || !calc.settings) return false;
    const before = JSON.stringify({
        standSizeRatio: calc.settings.standSizeRatio,
        resourceRatio: calc.settings.resourceRatio
    });
    const copy = JSON.parse(JSON.stringify(calc));
    normalizeStandRatios(copy);
    const after = JSON.stringify({
        standSizeRatio: copy.settings.standSizeRatio,
        resourceRatio: copy.settings.resourceRatio
    });
    return before !== after;
}
