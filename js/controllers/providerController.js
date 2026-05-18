/**
 * Контроллер обновления прайсов провайдеров.
 *
 * Семантика (Stage 17.2): единственный пользовательский путь обновления —
 * file-picker → readJsonFile → validate → save (`updateProviderPricesFromFile`)
 * для любого провайдера. Также есть мастер маппинга через
 * `priceImportMappingController` — он вызывает то же сохранение поверх validate.
 *
 * Состояние операции отражается в `state.ui.providerOverlayUpdate[providerId]`
 * — UI рендерит spinner / disabled-state / результат-text. Контроллер сам
 * snackbar'ы НЕ вызывает (controllers → ui = layer violation): caller
 * (`ctx.updateProviderPricesFromFile`) получает result-объект и показывает toast.
 *
 * Защита от повторного клика: если для providerId уже идёт операция
 * (status='loading'), новый вызов завершается ok=false reason='in-progress'.
 * Cross-tab lock через crossTabSync — defense-in-depth от параллельных вкладок.
 */

import { store } from '../state/store.js';
import {
    validateProviderPriceJson,
    rollbackProviderPriceOverride,
    getPreviousProviderOverride
} from '../services/providerPriceFetch.js';
import * as persist from '../state/persistence.js';
import {
    saveProviderOverride,
    loadProviderOverrides,
    pushProviderOverrideHistory,
    loadProviderOverrideHistory,
    setProviderOverrideHistory
} from '../state/persistence.js';
import { pickFile, readJsonFile } from '../services/json.js';
import { getEffectivePricesForProvider } from '../services/providerPriceResolver.js';
import {
    applyOverrideToItems,
    makeProviderVersionFromOverride,
    isCalcStale,
    computePriceDeltas
} from '../domain/calcVersioning.js';
import { commitActiveCalc } from '../services/calcPersistence.js';
import {
    acquireProviderLock,
    releaseProviderLock,
    isProviderLockedByOtherTab
} from '../state/crossTabSync.js';
import { compareCalcAcrossProviders } from '../domain/calcImpact.js';
import { listProviders } from '../domain/providerOverlay.js';

/* ---------- helpers для записи в state.ui.providerOverlayUpdate ---------- */

function setUpdateStatus(providerId, statusObj) {
    const current = store.getState().ui.providerOverlayUpdate || {};
    store.setUi({
        providerOverlayUpdate: { ...current, [providerId]: statusObj }
    });
}

export function clearProviderUpdateStatus(providerId) {
    const current = store.getState().ui.providerOverlayUpdate || {};
    if (!(providerId in current)) return;
    const next = { ...current };
    delete next[providerId];
    store.setUi({ providerOverlayUpdate: next });
}

/* ---------- основной API ---------- */
/* Stage 17.2: bundled-fetch и bulk-update удалены; absence-test
   tests/unit/architecture/stage-17-2-removals.test.js защищает от регрессии. */

/* ---------- Concurrent guard helper ---------- */

function _enterUpdate(providerId) {
    if (!providerId || typeof providerId !== 'string') {
        return { ok: false, reason: 'invalid-provider', message: 'Не указан providerId.' };
    }
    const existing = store.getState().ui.providerOverlayUpdate?.[providerId];
    if (existing?.status === 'loading') {
        return { ok: false, reason: 'in-progress', message: 'Операция уже выполняется.' };
    }
    /* Stage 11.1: cross-tab guard — другая вкладка может уже обновлять. */
    if (isProviderLockedByOtherTab(providerId)) {
        return {
            ok: false,
            reason: 'locked-by-other-tab',
            message: 'Этот провайдер уже обновляется в другой вкладке. Подождите завершения.'
        };
    }
    /* Try to acquire cross-tab lock. Если не удалось (race в момент проверки)
       — тоже считаем in-progress. */
    const lock = acquireProviderLock(providerId);
    if (!lock.ok) {
        return {
            ok: false,
            reason: 'locked-by-other-tab',
            message: 'Не удалось захватить lock — другая вкладка обновляет этого провайдера.'
        };
    }
    setUpdateStatus(providerId, { status: 'loading' });
    return { ok: true };
}

/**
 * Helper для гарантированного освобождения cross-tab lock'а после завершения
 * операции (success/error/cancel). Вызывается из всех путей exit'а
 * в `updateProviderPricesFromFile`.
 */
function _exitUpdate(providerId) {
    releaseProviderLock(providerId);
}

/**
 * Stage 11.3: conflict guard — проверяет, не идёт ли в другой вкладке
 * активное обновление этого провайдера. Если идёт — возвращает reject-объект,
 * иначе null (caller продолжает).
 *
 * Используется в applyOverrideToActiveCalc / applyOverrideToAllCalcs /
 * rollbackProvider / restoreProviderOverrideFromHistory — все mutate'ят
 * applied override и могут конфликтовать с одновременным fetch/file в
 * другой вкладке.
 */
function _conflictCheckCrossTab(providerId) {
    if (isProviderLockedByOtherTab(providerId)) {
        return {
            ok: false,
            reason: 'locked-by-other-tab',
            message: 'В другой вкладке сейчас идёт обновление прайса этого провайдера. Подождите завершения и повторите.'
        };
    }
    return null;
}

/**
 * Stage 9 ext: явная загрузка локального JSON через file-picker. Доступна
 * для ЛЮБОГО провайдера — пользователь может загрузить кастомный файл,
 * полученный из любого источника (e-mail, shared drive, прайс вендора).
 *
 * Validation: providerId внутри JSON должен совпадать с переданным providerId.
 *
 * @param {string} providerId
 * @param {Object} opts — DI для тестов: `_pickFile` / `_readJsonFile`.
 */
export async function updateProviderPricesFromFile(providerId, opts = {}) {
    const guard = _enterUpdate(providerId);
    if (!guard.ok) return guard;

    try {
        const pickFn = opts._pickFile || pickFile;
        const readFn = opts._readJsonFile || readJsonFile;

        const file = await pickFn('.json,application/json');
        if (!file) {
            /* Пользователь закрыл диалог — тихо возвращаем idle (без error-toast). */
            clearProviderUpdateStatus(providerId);
            return { ok: false, reason: 'cancelled', message: 'Выбор файла отменён.' };
        }

        let data;
        try {
            const r = await readFn(file);
            data = r.data;
        } catch (e) {
            const result = { ok: false, reason: 'parse', message: e.message || 'Ошибка чтения файла.' };
            setUpdateStatus(providerId, {
                status: 'error',
                message: _humanizeReason(result.reason, result.message)
            });
            return result;
        }

        /* Stage VAT-2 Phase 5: для user-import path требуем explicit VAT-policy
         * на v1 без vatPolicy metadata. Validator вернёт 'vat-policy-required'
         * → открываем modal с 3 кнопками выбора + Cancel. Bundled JSON loading
         * (через PROVIDER_OVERLAYS init) не задевается — там нет user-import-context. */
        const validated = validateProviderPriceJson(data, providerId, { requireVatPolicy: true });
        if (!validated.ok) {
            if (validated.reason === 'vat-policy-required') {
                /* Открываем модалку выбора VAT-policy. Preloaded JSON хранится в
                 * state.modals.vatPolicyChoice — пользователь выберет, и контроллер
                 * `applyProviderPricesWithVatPolicy` повторит validate с явным
                 * userVatPolicy. Status сбрасываем — модалка теперь ведёт flow. */
                clearProviderUpdateStatus(providerId);
                store.openModal('vatPolicyChoice', { providerId, preloaded: data });
                return { ok: false, reason: 'vat-policy-required', awaitingChoice: true };
            }
            setUpdateStatus(providerId, {
                status: 'error',
                message: _humanizeReason(validated.reason, validated.message)
            });
            return validated;
        }

        return _saveValidatedOverride(providerId, validated.data);
    } finally {
        /* Stage 11.1: освобождаем cross-tab lock в любом случае. */
        _exitUpdate(providerId);
    }
}

/**
 * Stage VAT-2 Phase 5: повторный validate + save после user-выбора VAT-policy
 * в `vatPolicyChoiceModal`. Принимает preloaded JSON (тот, что не прошёл
 * первый validate из-за `requireVatPolicy`) и явный `userVatPolicy`.
 *
 * Allowed values для userVatPolicy: 'net' | 'gross-20' | 'gross-22'.
 *
 * @param {string} providerId
 * @param {object} preloaded — parsed JSON, ранее отвергнутый как vat-policy-required.
 * @param {'net'|'gross-20'|'gross-22'} userVatPolicy
 * @returns {{ ok: true, applied, snapshot } | { ok: false, reason, message }}
 */
export async function applyProviderPricesWithVatPolicy(providerId, preloaded, userVatPolicy) {
    const guard = _enterUpdate(providerId);
    if (!guard.ok) return guard;
    try {
        if (!preloaded || typeof preloaded !== 'object') {
            const result = { ok: false, reason: 'invalid-preloaded', message: 'Нет данных для повторного применения.' };
            setUpdateStatus(providerId, { status: 'error', message: result.message });
            return result;
        }
        const validated = validateProviderPriceJson(preloaded, providerId, { userVatPolicy });
        if (!validated.ok) {
            setUpdateStatus(providerId, {
                status: 'error',
                message: _humanizeReason(validated.reason, validated.message)
            });
            return validated;
        }
        return _saveValidatedOverride(providerId, validated.data);
    } finally {
        _exitUpdate(providerId);
    }
}

/**
 * Helper: общий save-flow после успешного validate. Используется как
 * `updateProviderPricesFromFile` (v2 или v1+default), так и
 * `applyProviderPricesWithVatPolicy` (v1 + user-policy).
 */
function _saveValidatedOverride(providerId, validatedData) {
    /* Snapshot для будущего rollback в Stage 8.3 / 8.5 (delta-summary). */
    const map = loadProviderOverrides();
    const snapshot = map && map[providerId] ? map[providerId] : null;

    const saved = saveProviderOverride(providerId, validatedData);
    if (!saved) {
        const result = {
            ok: false,
            reason: 'persist',
            message: 'Не удалось сохранить overlay в localStorage (quota?).'
        };
        setUpdateStatus(providerId, { status: 'error', message: result.message });
        return result;
    }

    /* Stage 9.5: после успешного save — push предыдущий override в history. */
    if (snapshot) {
        pushProviderOverrideHistory(providerId, {
            appliedJSON: snapshot,
            appliedAt: new Date().toISOString()
        });
    }

    setUpdateStatus(providerId, {
        status: 'success',
        version: validatedData.version,
        message: `Прайс обновлён до ${validatedData.version}.`
    });
    return { ok: true, applied: validatedData, snapshot };
}

/* ---------- Stage 8.3: применение override к активному расчёту ---------- */

/**
 * Получить applied override JSON для провайдера из localStorage. Возвращает
 * null если override отсутствует.
 */
function _getOverrideForProvider(providerId) {
    const map = loadProviderOverrides();
    return map?.[providerId] || null;
}

/**
 * Stage 8.3: текущая последняя version override для провайдера.
 * Используется UI для определения isStale.
 *
 * @returns {string|null}
 */
export function getCurrentOverrideVersion(providerId) {
    return _getOverrideForProvider(providerId)?.version || null;
}

/**
 * Stage 9.1: re-export resolver через controllers, чтобы UI ходил через ctx
 * (UI → services запрещён layer-linter'ом).
 */
export function resolveEffectivePricesForProvider(providerId) {
    return getEffectivePricesForProvider(providerId);
}

/* ---------- Stage 9.5: rollback override на предыдущую версию ---------- */

/**
 * Stage 9.5: переход top-of-stack history → current. UI отображает кнопку
 * «Откатить на предыдущий прайс» только когда есть что откатить.
 *
 * @param {string} providerId
 * @returns {{ ok: true, restored: object|null, hasMoreHistory: boolean } | { ok: false, reason, message }}
 */
export function rollbackProvider(providerId) {
    /* Stage 11.3: cross-tab conflict guard. */
    const conflict = _conflictCheckCrossTab(providerId);
    if (conflict) return conflict;
    return rollbackProviderPriceOverride(providerId);
}

/**
 * Stage 9.5: для UI — top-of-stack snapshot. null если истории нет.
 * Возвращает { appliedJSON, appliedAt }.
 */
export function peekPreviousOverride(providerId) {
    return getPreviousProviderOverride(providerId);
}

/**
 * Stage 10.3: для UI — текущий applied override JSON для провайдера.
 * Возвращает сам объект (со всеми полями: schemaVersion, providerId, version,
 * timestamp, source, prices) либо null.
 */
export function getCurrentProviderOverride(providerId) {
    return _getOverrideForProvider(providerId);
}

/**
 * Stage 10.3: для UI — массив исторических snapshot'ов (newest first).
 * Возвращает [] если истории нет (никогда не null).
 */
export function getProviderOverrideHistory(providerId) {
    return loadProviderOverrideHistory(providerId);
}

/**
 * Stage 10.4: re-export domain helper для UI (UI → controllers через ctx,
 * не напрямую в domain). Caller передаёт effective-цены, controller просто
 * проксирует к pure domain.
 */
export { aggregateProviderPrices } from '../domain/providerAnalytics.js';

/**
 * Stage 14.5 (PATCH 2.7.3): cross-provider scenario сравнение для активного calc.
 * Controller-обёртка над domain `compareCalcAcrossProviders`: подгружает
 * effective-цены для всех запрошенных провайдеров, собирает label-map и
 * передаёт в pure domain helper.
 *
 * @param {Object} calc — активный расчёт.
 * @param {string[]} providerIds — провайдеры для сравнения.
 * @returns {{ currentProviderId, providers: Array<{...}> }}
 */
export function getCalcCrossProviderComparison(calc, providerIds) {
    if (!calc || !Array.isArray(providerIds)) {
        return { currentProviderId: calc?.settings?.provider || null, providers: [] };
    }
    const all = listProviders();
    const labelMap = {};
    for (const p of all) labelMap[p.id] = p.label;
    const effectivePricesByProvider = {};
    for (const pid of providerIds) {
        effectivePricesByProvider[pid] = getEffectivePricesForProvider(pid);
    }
    return compareCalcAcrossProviders(calc, providerIds, {
        effectivePricesByProvider,
        providerLabels: labelMap
    });
}

/**
 * Stage 14.5: список ВСЕХ active провайдеров для UI-чекбоксов в comparison
 * модалке. Возвращает Array<{ id, label }>.
 */
export function listActiveProvidersForComparison() {
    return listProviders()
        .filter(p => p.active)
        .map(p => ({ id: p.id, label: p.label }));
}

/**
 * Stage 14.4 (PATCH 2.7.2): для multi-provider accordion'а delta-history модалки —
 * перечисляем провайдеров, у которых есть либо current override, либо непустая
 * history. Inactive провайдеры пропускаются.
 *
 * Возвращает: Array<{ id, label, hasCurrentOverride, historyCount }>.
 *
 * Порядок — как в listProviders() (определён в providerOverlay.js).
 */
export function getAllProvidersWithHistory() {
    const all = listProviders();
    const result = [];
    for (const p of all) {
        if (!p.active) continue;
        const currentOverride = _getOverrideForProvider(p.id);
        const history = loadProviderOverrideHistory(p.id);
        const historyCount = Array.isArray(history) ? history.length : 0;
        if (!currentOverride && historyCount === 0) continue;
        result.push({
            id: p.id,
            label: p.label,
            hasCurrentOverride: !!currentOverride,
            historyCount
        });
    }
    return result;
}

/**
 * Stage 10.3: восстановить override на конкретный snapshot из истории
 * (по индексу). Аналог git reset --hard на коммит из истории: все записи
 * с idx 0..N-1 (более новые чем target) удаляются вместе с current.
 *
 * История newest-first: history[0] = последний override до текущего.
 * После restore current = history[idx], новой history становится
 * history[idx+1..end] (более старые точки сохраняются как «прошлое»).
 *
 * @param {string} providerId
 * @param {number} idx — индекс в history (0..history.length-1).
 * @returns {{ ok: true, restored: object, hasMoreHistory: boolean } |
 *           { ok: false, reason, message }}
 */
export function restoreProviderOverrideFromHistory(providerId, idx) {
    if (!providerId || typeof providerId !== 'string') {
        return { ok: false, reason: 'invalid-provider', message: 'Не указан providerId.' };
    }
    if (!Number.isInteger(idx) || idx < 0) {
        return { ok: false, reason: 'invalid-index', message: 'Некорректный индекс истории.' };
    }
    /* Stage 11.3: cross-tab conflict guard. */
    const conflict = _conflictCheckCrossTab(providerId);
    if (conflict) return conflict;
    const history = loadProviderOverrideHistory(providerId);
    if (history.length === 0) {
        return { ok: false, reason: 'no-history', message: 'История пуста.' };
    }
    if (idx >= history.length) {
        return { ok: false, reason: 'invalid-index', message: 'Индекс за пределами истории.' };
    }

    const target = history[idx];
    const targetJson = target?.appliedJSON;
    if (!targetJson || typeof targetJson !== 'object') {
        return { ok: false, reason: 'invalid-snapshot', message: 'Снимок повреждён.' };
    }

    /* Сохраняем target как current. */
    if (!saveProviderOverride(providerId, targetJson)) {
        return { ok: false, reason: 'persist', message: 'Не удалось сохранить.' };
    }
    /* Truncate history: оставляем только записи СТАРШЕ target (idx+1..). */
    const remaining = history.slice(idx + 1);
    setProviderOverrideHistory(providerId, remaining);

    return {
        ok: true,
        restored: targetJson,
        hasMoreHistory: remaining.length > 0
    };
}

/**
 * Stage 8.3: устарел ли активный расчёт относительно текущего override
 * провайдера, который calc использует.
 *
 * @returns {boolean}
 */
export function isActiveCalcStale() {
    const calc = store.getState().activeCalc;
    if (!calc) return false;
    const providerId = calc.settings?.provider || null;
    if (!providerId) return false;
    const latestVer = getCurrentOverrideVersion(providerId);
    return isCalcStale(calc, latestVer);
}

/**
 * Stage 8.3: применить текущий override провайдера к активному расчёту.
 * Заменяет calc.dictionaries.items на снимок effective prices и записывает
 * calc.providerVersion = { id, version, timestamp }. Persist через
 * commitActiveCalc.
 *
 * @returns {{ ok: true, deltas, version } | { ok: false, reason, message }}
 *   deltas — массив { id, oldPrice, newPrice, delta, deltaPct }; version —
 *   applied version (для UI/toast).
 */
export function applyOverrideToActiveCalc() {
    const calc = store.getState().activeCalc;
    if (!calc) {
        return { ok: false, reason: 'no-active-calc', message: 'Нет активного расчёта.' };
    }
    const providerId = calc.settings?.provider;
    if (!providerId) {
        return { ok: false, reason: 'no-provider', message: 'У расчёта не указан провайдер.' };
    }

    /* Stage 11.3: блокируем если другая вкладка обновляет — иначе применим
       ТЕКУЩИЙ override, а через секунду калькулятор станет stale снова. */
    const conflict = _conflictCheckCrossTab(providerId);
    if (conflict) return conflict;

    const override = _getOverrideForProvider(providerId);
    if (!override) {
        return { ok: false, reason: 'no-override', message: 'Для провайдера нет загруженного обновления.' };
    }

    const effectivePrices = getEffectivePricesForProvider(providerId);
    const oldItems = calc.dictionaries.items || [];
    const newItems = applyOverrideToItems(oldItems, effectivePrices);
    const deltas = computePriceDeltas(oldItems, newItems);

    const providerVersion = makeProviderVersionFromOverride(override);

    store.updateActiveCalc({
        dictionaries: { ...calc.dictionaries, items: newItems },
        providerVersion
    });
    commitActiveCalc(store.getState().activeCalc);

    return { ok: true, deltas, version: override.version };
}

/* ---------- Stage 8.5: применить override ко всем calc'ам провайдера ---------- */

/**
 * Stage 8.5: для всех расчётов в localStorage с заданным providerId,
 * у которых providerVersion != latest, применить override (swap items +
 * providerVersion) и persist. Активный calc обрабатывается через store
 * (чтобы UI ре-рендерил), остальные — напрямую через persist.
 *
 * Best-effort: если на одном calc'е возникла ошибка, остальные всё равно
 * обрабатываются. Возвращает summary с successCount / errorCount / errors.
 *
 * @param {string} providerId
 * @returns {{ ok: true, applied, alreadyFresh, errors, version, providerId }}
 */
export function applyOverrideToAllCalcsForProvider(providerId) {
    if (!providerId || typeof providerId !== 'string') {
        return { ok: false, reason: 'invalid-provider', message: 'Не указан providerId.' };
    }
    /* Stage 11.3: cross-tab conflict guard. */
    const conflict = _conflictCheckCrossTab(providerId);
    if (conflict) return conflict;

    const override = _getOverrideForProvider(providerId);
    if (!override) {
        return { ok: false, reason: 'no-override', message: 'Для провайдера нет загруженного обновления.' };
    }

    const effectivePrices = getEffectivePricesForProvider(providerId);
    const providerVersion = makeProviderVersionFromOverride(override);
    const latestVersion = override.version;

    const list = persist.loadCalcList();
    let applied = 0, alreadyFresh = 0;
    const errors = [];
    const activeCalc = store.getState().activeCalc;

    for (const meta of list) {
        try {
            /* Если activeCalc — берём из store (свежее), иначе из storage. */
            const calc = (activeCalc && activeCalc.id === meta.id)
                ? activeCalc
                : persist.loadCalc(meta.id);
            if (!calc) continue;

            /* Применяем только к calc'ам с тем же провайдером. */
            const calcProvider = calc.settings?.provider;
            if (calcProvider !== providerId) continue;

            /* Skip уже-fresh calc'и. */
            if (calc.providerVersion?.version === latestVersion) {
                alreadyFresh++;
                continue;
            }

            const newItems = applyOverrideToItems(calc.dictionaries.items || [], effectivePrices);
            const updated = {
                ...calc,
                dictionaries: { ...calc.dictionaries, items: newItems },
                providerVersion,
                updatedAt: new Date().toISOString()
            };

            if (activeCalc && activeCalc.id === meta.id) {
                /* Update через store + commit (триггерит ре-рендер).
                 * Внешний аудит 2026-05-18 (P2-2): раньше результат
                 * commitActiveCalc игнорировался, и при сбое записи (quota)
                 * applied++ всё равно срабатывал → пользователь видел
                 * "обновлено N", хотя active calc после F5 оставался
                 * прежним. Контракт inactive-ветки (false → error+continue)
                 * теперь распространён и на active. */
                store.updateActiveCalc({
                    dictionaries: updated.dictionaries,
                    providerVersion
                });
                if (!commitActiveCalc(store.getState().activeCalc)) {
                    errors.push({ calcId: meta.id, name: meta.name, message: 'Не удалось сохранить (quota?)' });
                    continue;
                }
            } else {
                /* Inactive calc — пишем напрямую. saveCalc возвращает false при quota. */
                if (!persist.saveCalc(updated)) {
                    errors.push({ calcId: meta.id, name: meta.name, message: 'Не удалось сохранить (quota?)' });
                    continue;
                }
            }
            applied++;
        } catch (e) {
            errors.push({ calcId: meta.id, name: meta.name || meta.id, message: e?.message || String(e) });
        }
    }

    return {
        ok: errors.length === 0 || applied > 0,
        applied,
        alreadyFresh,
        errors,
        version: latestVersion,
        providerId
    };
}


/* ---------- humanize reason → русский текст для UI/toast ---------- */

function _humanizeReason(reason, fallback) {
    switch (reason) {
        case 'fetch':              return 'Не удалось загрузить файл прайса.';
        case 'parse':              return 'Файл не является корректным JSON.';
        case 'shape':              return 'Структура файла не соответствует ожиданиям.';
        case 'schema-version':     return 'Версия схемы не поддерживается.';
        case 'provider-mismatch':  return 'providerId в файле не совпадает с выбранным провайдером.';
        case 'missing-field':      return 'В файле отсутствует обязательное поле.';
        case 'invalid-timestamp':  return 'Некорректная дата в файле.';
        case 'empty-prices':       return 'В файле нет цен.';
        case 'shape-prices':       return 'Поле prices имеет неверную структуру.';
        case 'invalid-price':      return 'Одна из цен в файле некорректна.';
        case 'unknown-fields':     return 'В файле есть неизвестные поля.';
        case 'persist':            return 'Не удалось сохранить прайс в локальное хранилище.';
        case 'vat-policy-required':      return 'Файл v1 без явной политики НДС — выберите её в окне импорта.';
        case 'invalid-user-vat-policy':  return 'Некорректный выбор политики НДС.';
        case 'invalid-vat-rate':         return 'В файле некорректная ставка НДС.';
        case 'gross-without-vat-rate':   return 'В файле gross-цена без vatRate.';
        case 'vat-inconsistency':        return 'В файле net и gross не согласованы (с учётом vatRate).';
        case 'missing-vat-policy':       return 'В v2-файле отсутствует обязательный vatPolicy.';
        case 'invalid-confidence':       return 'Некорректное значение vatPolicy.confidence.';
        case 'invalid-preloaded':        return 'Нет данных для повторного применения.';
        default:                   return fallback || 'Не удалось обновить прайс.';
    }
}
