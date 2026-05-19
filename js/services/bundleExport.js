/**
 * Полный экспорт/импорт состояния хранилища в единый JSON-файл.
 *
 * В отличие от per-calc-экспорта (json.js), здесь сохраняется ВЕСЬ snapshot:
 *   - все расчёты;
 *   - глобальный seed-справочник;
 *   - id активного расчёта.
 *
 * Импорт ПОЛНОСТЬЮ заменяет состояние localStorage. Перед заменой делается
 * in-memory backup; при ошибке — откат, чтобы пользователь не остался без данных.
 *
 * Формат файла (version: 'bundle-1.0'):
 *   {
 *     "version": "bundle-1.0",
 *     "exportedAt": "2026-05-01T12:00:00Z",
 *     "appVersion": "1.5.0",
 *     "activeCalcId": "uuid-or-null",
 *     "defaultDictionary": { items: [...], questions: [...] },
 *     "calculations": [ {/ * full calc * / }, ... ]
 *   }
 */

import * as persist from '../state/persistence.js';
import { validateCalculation, validateItem, validateQuestion } from '../domain/validation.js';
import { migrateCalculation, MigrationError } from '../state/migrations.js';
import { APP_VERSION, STORAGE_KEYS } from '../utils/constants.js';
import { dateForFilename } from './format.js';
import { sanitizeDefaultDictionary } from '../domain/deprecatedQuestions.js';
import { prepareLoadedCalc } from './loadedCalc.js';
import { normalizeStandRatios } from '../domain/standRatioNormalizer.js';
import { removeKey } from './storage.js';

export const BUNDLE_VERSION = 'bundle-3.0';

/**
 * Текущий major bundle-формата. Bundle с major выше отвергается с понятным
 * сообщением — это «forward-compat»-сигнал: старая версия приложения не должна
 * молча применять то, что писала более новая (10.2.6). Minor-различия
 * допускаются — мы обещаем обратную совместимость в пределах major.
 *
 * Sprint 3.0 Stage 1: BUNDLE_MAJOR bumped 1 → 2 (breaking format change).
 * Calc'и в bundle-2.0 содержат scenarios[] и activeScenarioId; bundle-1.0
 * остаются читаемыми (legacy-совместимость через migrateCalculation), но
 * новый export всегда пишет 2.0. Старое приложение с BUNDLE_MAJOR=1 при
 * импорте bundle-2.0 показывает понятный error «обновите приложение».
 */
export const BUNDLE_MAJOR = 3;

/**
 * Распарсить строку версии формата 'bundle-X.Y'.
 * @param {string} version
 * @returns {{ major: number, minor: number } | null} null — если формат неузнаваем.
 */
function parseBundleVersion(version) {
    if (typeof version !== 'string') return null;
    const m = /^bundle-(\d+)\.(\d+)$/.exec(version);
    if (!m) return null;
    const major = Number(m[1]);
    const minor = Number(m[2]);
    if (!Number.isFinite(major) || !Number.isFinite(minor)) return null;
    return { major, minor };
}

/**
 * Собрать полный bundle из текущего состояния localStorage.
 */
export function buildStateBundle() {
    const list = persist.loadCalcList();
    /* Внешний аудит #12 (2026-05-19, PATCH 2.18.5): экспорт прогоняет
     * каждый calc через ПОЛНЫЙ pipeline (migrate → enrich → applyVatResolver),
     * не только sanitize. Прежняя версия делала sanitize-БЕЗ-migrate —
     * миграция 3→4 теряла dau_target → дефолт share=5%. ТИХАЯ ПОРЧА ДАННЫХ.
     *
     * Внешний аудит #13 (2026-05-19, PATCH 2.18.6, P1#2): bundle теперь
     * содержит errors[] для calc'ов, не прошедших pipeline. Раньше .filter
     * молча выкидывал такие calc'и → пользователь экспортировал bundle,
     * не зная что в нём меньше расчётов чем в state.calcList. */
    const calcs = [];
    const errors = [];
    for (const meta of list) {
        const stored = persist.loadCalc(meta.id);
        if (!stored) {
            /* meta есть, calc.<id> отсутствует — рассогласование storage.
             * Сигналим, чтобы UI мог показать warning. */
            errors.push({
                calcId: meta.id,
                name: meta.name || null,
                reason: 'missing',
                message: 'calc.<id> отсутствует в storage (рассогласование с calc.list)'
            });
            continue;
        }
        const { calc, error } = prepareLoadedCalc(stored);
        if (error) {
            errors.push({
                calcId: meta.id,
                name: meta.name || stored.name || null,
                reason: error instanceof MigrationError ? 'migration' : 'pipeline',
                step: error instanceof MigrationError ? `${error.from}→${error.to}` : null,
                message: error.message || String(error)
            });
            continue;
        }
        /* Внешний аудит #16 (2026-05-19, PATCH 2.19.3, P2, выбор пользователя 2A):
         * валидация ПЕРЕД включением в bundle. До фикса buildStateBundle отдавал
         * calc без validateCalculation — bundle.errors=[] лгал, validateBundle
         * на импорте тот же bundle отвергал. Контракт: invalid calc НЕ
         * включается в bundle, errors[] явно фиксирует потерю. Симметрично
         * applyStateBundle (тот rollback на validate-fail). */
        const validateErrors = [];
        validateCalculation(calc, validateErrors, '');
        if (validateErrors.length > 0) {
            errors.push({
                calcId: meta.id,
                name: meta.name || calc.name || null,
                reason: 'validation',
                step: null,
                message: `Не прошёл валидацию (${validateErrors.length} ошибок): ` +
                         validateErrors.slice(0, 3).map(e => `${e.path}: ${e.message}`).join('; ') +
                         (validateErrors.length > 3 ? `; +${validateErrors.length - 3} ещё` : '')
            });
            continue;
        }
        calcs.push(calc);
    }
    const rawDict = persist.loadDefaultDictionary() || { items: [], questions: [] };
    return {
        version: BUNDLE_VERSION,
        exportedAt: new Date().toISOString(),
        appVersion: APP_VERSION,
        activeCalcId: persist.loadActiveCalcId(),
        defaultDictionary: sanitizeDefaultDictionary(rawDict),
        calculations: calcs,
        errors  /* always-array; пустой [] для clean экспорта */
    };
}

/**
 * Валидация входящего bundle.
 * Возвращает { valid, errors[] }.
 */
export function validateBundle(data) {
    const errors = [];
    if (!data || typeof data !== 'object') {
        errors.push({ path: 'root', message: 'JSON не является объектом' });
        return { valid: false, errors };
    }
    // Парсинг версии (10.2.6): bundle-X.Y. Major X выше текущего → отвергаем
    // с понятным сообщением, чтобы старое приложение не применяло чужой формат.
    // Невалидный формат (нет «bundle-», не парсится) — тоже валидационная ошибка.
    if (typeof data.version !== 'string' || !data.version.startsWith('bundle-')) {
        errors.push({ path: 'version', message: 'Поле version отсутствует или не похоже на bundle-формат' });
    } else {
        const parsed = parseBundleVersion(data.version);
        if (!parsed) {
            errors.push({
                path: 'version',
                message: `Некорректный формат version: ожидается bundle-X.Y, получено «${data.version}»`
            });
        } else if (parsed.major > BUNDLE_MAJOR) {
            errors.push({
                path: 'version',
                message: 'Bundle создан в более новой версии приложения. Обновите приложение.'
            });
        }
    }
    if (!Array.isArray(data.calculations)) {
        errors.push({ path: 'calculations', message: 'calculations должен быть массивом' });
    } else {
        // Дубли calc.id внутри bundle — отдельная валидационная ошибка (10.1.4).
        // Если bundle содержит два расчёта с одинаковым id, после applyStateBundle
        // в localStorage останется только последний — для пользователя это «тихая»
        // потеря данных. Поэтому отлавливаем заранее.
        const seenCalcIds = new Set();
        data.calculations.forEach((c, i) => {
            const calcErrors = [];
            // Применяем миграцию ДО валидации, чтобы legacy-форматы прошли проверку.
            const migrated = migrateCalculation(c);
            /* Внешний аудит #15 (2026-05-19, PATCH 2.19.2, P1+P1/P2): помимо
             * migrate нужен normalize — для calc'ов уже на LATEST schemaVersion,
             * где migrate ничего не делает, но resourceRatio отсутствует или
             * standSizeRatio out-of-range. Симметрично prepareLoadedCalc. */
            normalizeStandRatios(migrated);
            validateCalculation(migrated, calcErrors, `calculations[${i}].`);
            errors.push(...calcErrors);
            if (c && typeof c.id === 'string' && c.id !== '') {
                if (seenCalcIds.has(c.id)) {
                    errors.push({
                        path: `calculations[${i}].id`,
                        message: `Дубликат id: ${c.id}`
                    });
                }
                seenCalcIds.add(c.id);
            }
        });
    }
    if (data.defaultDictionary !== undefined) {
        if (typeof data.defaultDictionary !== 'object' || data.defaultDictionary === null) {
            errors.push({ path: 'defaultDictionary', message: 'defaultDictionary должен быть объектом' });
        } else {
            // Поэлементная валидация items (10.1.2): без неё битый item
            // (отрицательная цена, отсутствующее обязательное поле) тихо доезжал
            // в localStorage и потом ломал расчёт.
            if (!Array.isArray(data.defaultDictionary.items)) {
                errors.push({ path: 'defaultDictionary.items', message: 'items должен быть массивом' });
            } else {
                const seenItemIds = new Set();
                data.defaultDictionary.items.forEach((it, i) => {
                    validateItem(it, errors, `defaultDictionary.items[${i}]`);
                    // Дубли id (10.1.4) — повтор затирает предыдущий после apply.
                    if (it && typeof it.id === 'string' && it.id !== '') {
                        if (seenItemIds.has(it.id)) {
                            errors.push({
                                path: `defaultDictionary.items[${i}].id`,
                                message: `Дубликат id: ${it.id}`
                            });
                        }
                        seenItemIds.add(it.id);
                    }
                });
            }
            // Поэлементная валидация questions (10.1.2) + дубли id (10.1.4).
            if (!Array.isArray(data.defaultDictionary.questions)) {
                errors.push({ path: 'defaultDictionary.questions', message: 'questions должен быть массивом' });
            } else {
                const seenQuestionIds = new Set();
                data.defaultDictionary.questions.forEach((q, i) => {
                    validateQuestion(q, errors, `defaultDictionary.questions[${i}]`);
                    if (q && typeof q.id === 'string' && q.id !== '') {
                        if (seenQuestionIds.has(q.id)) {
                            errors.push({
                                path: `defaultDictionary.questions[${i}].id`,
                                message: `Дубликат id: ${q.id}`
                            });
                        }
                        seenQuestionIds.add(q.id);
                    }
                });
            }
        }
    }
    if (data.activeCalcId !== undefined && data.activeCalcId !== null && typeof data.activeCalcId !== 'string') {
        errors.push({ path: 'activeCalcId', message: 'activeCalcId должен быть строкой или null' });
    }
    return { valid: errors.length === 0, errors };
}

/**
 * Атомарно применить bundle к localStorage.
 * Если что-то пошло не так — пытаемся откатиться к снимку.
 *
 * Возвращает { ok, error?, applied?: { calculations, items, questions } }.
 */
export function applyStateBundle(data) {
    // 1. Валидация. validateBundle внутри прогоняет migrateCalculation для
    //    каждого расчёта (legacy-совместимость перед validateCalculation), и
    //    после 10.1.3 миграция бросает MigrationError. Ловим её здесь, чтобы
    //    вернуть осмысленный reason='migration' вместо падения, и при этом
    //    не править саму validateBundle (она остаётся чистой валидацией).
    let v;
    try {
        v = validateBundle(data);
    } catch (e) {
        if (e instanceof MigrationError) {
            const idx = Array.isArray(data?.calculations)
                ? data.calculations.findIndex(c => {
                    try { migrateCalculation(c); return false; }
                    catch { return true; }
                })
                : -1;
            const calcId = idx >= 0 ? (data.calculations[idx]?.id ?? null) : null;
            return {
                ok: false,
                reason: 'migration',
                errors: [{
                    calcId,
                    step: `${e.from}→${e.to}`,
                    message: e.message
                }]
            };
        }
        throw e;
    }
    if (!v.valid) return { ok: false, reason: 'validation', errors: v.errors };

    // 2. In-memory backup для отката
    const backup = {
        list: persist.loadCalcList(),
        calcs: {},
        defaultDict: persist.loadDefaultDictionary(),
        activeId: persist.loadActiveCalcId()
    };
    for (const m of backup.list) {
        backup.calcs[m.id] = persist.loadCalc(m.id);
    }

    // 3. Прогон каждого расчёта через ПОЛНЫЙ pipeline (migrate → enrich →
    //    applyVatResolver) ДО любых записей в localStorage. Это даёт настоящую
    //    атомарность: если хоть один расчёт не мигрирует — мы возвращаем
    //    ошибку, а текущее состояние хранилища остаётся нетронутым.
    /* Внешний аудит #12 (2026-05-19, PATCH 2.18.5, P1#2): добавлен
     * enrichLegacyDictionaryWithAgentSeed через prepareLoadedCalc. Bundle от
     * старой версии приложения (до Этапа 13) без agent-вопросов/ЭК раньше
     * восстанавливался без них — пользователь после restore не видел
     * AI-агентов до первого open'а calc'а. Теперь enrich применяется при
     * apply ко всем calc'ам, storage сразу содержит agent-данные. */
    let migrated;
    try {
        migrated = data.calculations.map(c => {
            const { calc, error } = prepareLoadedCalc(c);
            /* prepareLoadedCalc возвращает error для MigrationError —
             * пробрасываем как throw, ловится в общем catch ниже. */
            if (error) throw error;
            if (!calc.view || typeof calc.view !== 'object') calc.view = { disabledStands: [] };
            else if (!Array.isArray(calc.view.disabledStands)) calc.view.disabledStands = [];
            return calc;
        });
    } catch (e) {
        if (e instanceof MigrationError) {
            // Поиск id того расчёта, на котором упала миграция, чтобы выдать
            // вызывающему коду понятный отчёт. data.calculations здесь —
            // массив исходных (до миграции) объектов, поэтому id берём прямо из них.
            const idx = data.calculations.findIndex(c => {
                try { migrateCalculation(c); return false; }
                catch { return true; }
            });
            const calcId = idx >= 0 ? (data.calculations[idx]?.id ?? null) : null;
            return {
                ok: false,
                reason: 'migration',
                errors: [{
                    calcId,
                    step: `${e.from}→${e.to}`,
                    message: e.message
                }]
            };
        }
        // Любая другая ошибка на этом этапе — не миграционная; пробрасываем
        // в общий catch, чтобы сработал откат backup. Технически до этого
        // момента ничего ещё не записано, но руки в карманах не держим.
        throw e;
    }

    try {
        // 4. Очистить текущие расчёты (миграция выше прошла успешно).
        for (const m of backup.list) persist.removeCalc(m.id);

        // 5. Записать новые расчёты + список. Внешний аудит 2026-05-18 (P1-2):
        //    раньше return-значения persist.save* игнорировались, и quota во
        //    время apply-фазы выдавала ok=true с реально несохранёнными
        //    расчётами (после rm на шаге 4 список расчётов уходил в null).
        //    Теперь любой false из persist.save* бросает Error, который ловит
        //    catch ниже и запускает rollback на backup.
        for (const c of migrated) {
            if (!persist.saveCalc(c)) {
                throw new Error(`persist.saveCalc failed for ${c.id} (likely quota)`);
            }
        }
        const newList = migrated.map(c => ({
            id: c.id,
            name: c.name,
            updatedAt: c.updatedAt
        }));
        if (!persist.saveCalcList(newList)) {
            throw new Error('persist.saveCalcList failed (likely quota)');
        }

        // 6. Глобальный справочник (audit #12, P2#4: sanitize ПЕРЕД save —
        //    bundle от старой версии с stale deprecated id в dict не уносит
        //    их в storage).
        if (data.defaultDictionary) {
            const cleanDict = sanitizeDefaultDictionary(data.defaultDictionary);
            if (!persist.saveDefaultDictionary(cleanDict)) {
                throw new Error('persist.saveDefaultDictionary failed (likely quota)');
            }
        }

        // 7. Активный расчёт
        const validActiveId = data.activeCalcId && migrated.some(c => c.id === data.activeCalcId)
            ? data.activeCalcId
            : (migrated[0]?.id || null);
        if (!persist.saveActiveCalcId(validActiveId)) {
            throw new Error('persist.saveActiveCalcId failed (likely quota)');
        }

        return {
            ok: true,
            applied: {
                calculations: migrated.length,
                items: data.defaultDictionary?.items?.length ?? 0,
                questions: data.defaultDictionary?.questions?.length ?? 0,
                activeCalcId: validActiveId
            }
        };
    } catch (e) {
        // Откат: восстанавливаем snapshot. Раньше здесь стоял пустой
        // `catch {}`, и если откат сам падал (например, повторный quota из
        // того же setItem), пользователь видел только первую ошибку, а
        // хранилище оставалось в полу-неопределённом виде. Теперь
        // накапливаем сообщение и отдаём в result.rollbackError (10.2.4).
        /* Внешний аудит #2 (2026-05-18, P1-2): раньше rollback вызывал
         * persist.save* без проверки false-возврата → при quota во время
         * rollback пользователь видел ok:false без rollbackError, а calc.list
         * всё ещё указывал на удалённый calc.<id>. Теперь любой false
         * накапливается как rollbackError — точно так же, как throw. */
        let rollbackError = null;
        const rollbackFailures = [];
        try {
            // Удаляем то, что успели записать
            for (const c of data.calculations || []) {
                if (c?.id) persist.removeCalc(c.id);
            }
            // Возвращаем backup
            for (const id of Object.keys(backup.calcs)) {
                if (!persist.saveCalc(backup.calcs[id])) {
                    rollbackFailures.push(`saveCalc(${id})`);
                }
            }
            if (!persist.saveCalcList(backup.list)) {
                rollbackFailures.push('saveCalcList');
            }
            /* Внешний аудит #13 (2026-05-19, PATCH 2.18.6, P3#7): если в backup
             * defaultDict был null (его не было в storage до apply), rollback
             * обязан УБРАТЬ ключ — раньше else-ветка отсутствовала, импортированный
             * {items:[], questions:[]} оставался в storage как «новый default». */
            if (backup.defaultDict) {
                if (!persist.saveDefaultDictionary(backup.defaultDict)) {
                    rollbackFailures.push('saveDefaultDictionary');
                }
            } else {
                /* removeKey не throws (storage helper); defensive try/catch
                 * чтобы любая внутренняя ошибка попадала в rollbackFailures. */
                try {
                    removeKey(STORAGE_KEYS.DEFAULT_DICTIONARY);
                } catch {
                    rollbackFailures.push('removeKey(DEFAULT_DICTIONARY)');
                }
            }
            if (!persist.saveActiveCalcId(backup.activeId)) {
                rollbackFailures.push('saveActiveCalcId');
            }
        } catch (rollbackErr) {
            rollbackError = rollbackErr && rollbackErr.message
                ? rollbackErr.message
                : String(rollbackErr);
        }
        if (rollbackFailures.length > 0) {
            const failMsg = `rollback failed: ${rollbackFailures.join(', ')}`;
            rollbackError = rollbackError ? `${rollbackError}; ${failMsg}` : failMsg;
        }
        const result = { ok: false, reason: 'apply', error: e.message };
        if (rollbackError !== null) result.rollbackError = rollbackError;
        return result;
    }
}

/**
 * Имя файла bundle: app-state-dd.mm.yyyy.json (RU-формат, единообразно с UI/PDF).
 */
export function buildBundleFilename() {
    return `app-state-${dateForFilename()}.json`;
}
