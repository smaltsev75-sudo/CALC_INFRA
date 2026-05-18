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
import { APP_VERSION } from '../utils/constants.js';
import { dateForFilename } from './format.js';

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
    const calcs = list.map(meta => persist.loadCalc(meta.id)).filter(Boolean);
    return {
        version: BUNDLE_VERSION,
        exportedAt: new Date().toISOString(),
        appVersion: APP_VERSION,
        activeCalcId: persist.loadActiveCalcId(),
        defaultDictionary: persist.loadDefaultDictionary() || { items: [], questions: [] },
        calculations: calcs
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

    // 3. Прогон каждого расчёта через миграцию (legacy-совместимость) ДО любых
    //    записей в localStorage. Это даёт настоящую атомарность: если хоть один
    //    расчёт не мигрирует — мы возвращаем ошибку, а текущее состояние
    //    хранилища остаётся нетронутым (backup даже не пришлось задействовать).
    let migrated;
    try {
        migrated = data.calculations.map(c => {
            const m = migrateCalculation(c);
            if (!m.view || typeof m.view !== 'object') m.view = { disabledStands: [] };
            else if (!Array.isArray(m.view.disabledStands)) m.view.disabledStands = [];
            return m;
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

        // 6. Глобальный справочник
        if (data.defaultDictionary) {
            if (!persist.saveDefaultDictionary(data.defaultDictionary)) {
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
        let rollbackError = null;
        try {
            // Удаляем то, что успели записать
            for (const c of data.calculations || []) {
                if (c?.id) persist.removeCalc(c.id);
            }
            // Возвращаем backup
            for (const id of Object.keys(backup.calcs)) {
                persist.saveCalc(backup.calcs[id]);
            }
            persist.saveCalcList(backup.list);
            if (backup.defaultDict) persist.saveDefaultDictionary(backup.defaultDict);
            persist.saveActiveCalcId(backup.activeId);
        } catch (rollbackErr) {
            rollbackError = rollbackErr && rollbackErr.message
                ? rollbackErr.message
                : String(rollbackErr);
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
