/**
 * Сериализация состояния в localStorage и обратно. Включает миграции схемы.
 */

import { STORAGE_KEYS, CURRENT_SCHEMA_VERSION, PROVIDER_OVERRIDE_HISTORY_LIMIT } from '../utils/constants.js';
import { readJson, writeJson, removeKey } from '../services/storage.js';

/* ---------- Список расчётов ---------- */

export function loadCalcList() {
    return readJson(STORAGE_KEYS.CALC_LIST, []) || [];
}

export function saveCalcList(list) {
    return writeJson(STORAGE_KEYS.CALC_LIST, list);
}

/* ---------- Один расчёт ---------- */

export function loadCalc(id) {
    if (!id) return null;
    return readJson(STORAGE_KEYS.CALC_PREFIX + id, null);
}

export function saveCalc(calc) {
    if (!calc || !calc.id) return false;
    return writeJson(STORAGE_KEYS.CALC_PREFIX + calc.id, calc);
}

export function removeCalc(id) {
    if (!id) return;
    removeKey(STORAGE_KEYS.CALC_PREFIX + id);
}

/* ---------- Активный расчёт ---------- */

export function loadActiveCalcId() {
    return readJson(STORAGE_KEYS.ACTIVE_CALC, null);
}

export function saveActiveCalcId(id) {
    return writeJson(STORAGE_KEYS.ACTIVE_CALC, id);
}

/* ---------- Активная вкладка ---------- */

export function loadActiveTab() {
    return readJson(STORAGE_KEYS.ACTIVE_TAB, null);
}

export function saveActiveTab(tabId) {
    return writeJson(STORAGE_KEYS.ACTIVE_TAB, tabId);
}

/* ---------- Тема приложения (12.U33) ---------- */

import { THEME_IDS, DEFAULT_THEME } from '../utils/constants.js';

export function loadTheme() {
    const v = readJson(STORAGE_KEYS.THEME, null);
    return THEME_IDS.includes(v) ? v : null;
}

export function saveTheme(theme) {
    if (!THEME_IDS.includes(theme)) return false;
    return writeJson(STORAGE_KEYS.THEME, theme);
}

export { DEFAULT_THEME };

/* ---------- Расширенные настройки (Stage 17.2 Phase 3c) ---------- */

/**
 * Загружает persistent boolean «advancedMode». null = не сохранено (дефолт false).
 * Любые corrupt-значения (число, строка, объект) → null → дефолт false.
 */
export function loadAdvancedModeEnabled() {
    const v = readJson(STORAGE_KEYS.ADVANCED_MODE_ENABLED, null);
    return typeof v === 'boolean' ? v : null;
}

export function saveAdvancedModeEnabled(enabled) {
    return writeJson(STORAGE_KEYS.ADVANCED_MODE_ENABLED, !!enabled);
}

/* ---------- Опросник: открытые секции и settings (12.U1) ---------- */

export function loadQuestionnaireOpenSections() {
    const v = readJson(STORAGE_KEYS.QUESTIONNAIRE_OPEN_SECTIONS, null);
    return Array.isArray(v) ? v : null;
}

export function saveQuestionnaireOpenSections(sections) {
    return writeJson(STORAGE_KEYS.QUESTIONNAIRE_OPEN_SECTIONS, Array.isArray(sections) ? sections : []);
}

export function loadQuestionnaireSettingsOpen() {
    const v = readJson(STORAGE_KEYS.QUESTIONNAIRE_SETTINGS_OPEN, null);
    return typeof v === 'boolean' ? v : null;
}

export function saveQuestionnaireSettingsOpen(open) {
    return writeJson(STORAGE_KEYS.QUESTIONNAIRE_SETTINGS_OPEN, !!open);
}

/* Stage 6.2.B (PATCH 2.4.23): свёрнутые подгруппы внутри секций опросника.
   Структура { [sectionId]: string[] } — массив title'ов подгрупп. */
export function loadQuestionnaireCollapsedSubgroups() {
    const v = readJson(STORAGE_KEYS.QUESTIONNAIRE_COLLAPSED_SUBGROUPS, null);
    /* Защита от мусора из localStorage: должен быть object с string[] значениями. */
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const sanitized = {};
    for (const [sectionId, titles] of Object.entries(v)) {
        if (Array.isArray(titles)) sanitized[sectionId] = titles.filter(t => typeof t === 'string');
    }
    return sanitized;
}

export function saveQuestionnaireCollapsedSubgroups(map) {
    return writeJson(STORAGE_KEYS.QUESTIONNAIRE_COLLAPSED_SUBGROUPS,
        (map && typeof map === 'object' && !Array.isArray(map)) ? map : {});
}

/* ---------- Stage 15.1: последняя открытая severity-вкладка модалки Health ---------- */

const HEALTH_TABS = ['error', 'warning', 'recommendation', 'info'];

export function loadHealthLastTab() {
    const v = readJson(STORAGE_KEYS.HEALTH_LAST_TAB, null);
    return HEALTH_TABS.includes(v) ? v : null;
}

export function saveHealthLastTab(tab) {
    if (!HEALTH_TABS.includes(tab)) return false;
    return writeJson(STORAGE_KEYS.HEALTH_LAST_TAB, tab);
}

/* ---------- Stage 16.5: история health score per calc ---------- */

import {
    appendHealthScoreSnapshot as _appendSnapshot,
    shouldAppendHealthScoreSnapshot as _shouldAppend
} from '../domain/healthScoreTrend.js';

/**
 * Загрузить весь trend-объект: { [calcId]: snapshot[] }.
 * Любая ошибка / corrupt JSON / неправильный формат → {}.
 */
export function loadHealthScoreTrend() {
    const v = readJson(STORAGE_KEYS.HEALTH_SCORE_TREND, null);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    // Нормализуем: значения должны быть массивами; иначе игнорируем ключ.
    const out = {};
    for (const [id, arr] of Object.entries(v)) {
        if (Array.isArray(arr)) out[id] = arr;
    }
    return out;
}

/** Сохранить весь trend-объект. */
export function saveHealthScoreTrend(trend) {
    if (!trend || typeof trend !== 'object' || Array.isArray(trend)) return false;
    return writeJson(STORAGE_KEYS.HEALTH_SCORE_TREND, trend);
}

/**
 * Атомарно добавить snapshot в историю заданного calcId.
 * Применяет dedup и trim до limit (внутри appendHealthScoreSnapshot).
 *
 * @returns {boolean} true если snapshot реально записан, false если dedup'нут / no-op
 */
export function appendHealthScoreTrendSnapshot(calcId, snapshot) {
    if (!calcId || !snapshot) return false;
    const trend = loadHealthScoreTrend();
    const before = trend[calcId] || [];
    // Dedup-решение принимаем ЯВНО до append — иначе после append нельзя
    // надёжно отличить «trim вытолкнул точку, но новая записана» от «dedup
    // отбросил». Кроме того, при быстрых последовательных вызовах timestamps
    // совпадают (1мс точность Date.now), и эвристика по timestamp лжёт.
    if (!_shouldAppend(before, snapshot)) return false;
    const after = _appendSnapshot(before, snapshot, { force: true });
    trend[calcId] = after;
    /* Внешний аудит #4 (2026-05-18, P3-2): раньше saveHealthScoreTrend
     * результат игнорировался + return true. При quota пользователь получал
     * {ok:true, written:true}, но после F5 история пустая. Теперь честный
     * return: true только если save реально прошёл. Симметрично clearHealthScoreTrend. */
    return saveHealthScoreTrend(trend);
}

/** Очистить историю одного calcId. Прочих calcId не трогает. */
export function clearHealthScoreTrend(calcId) {
    if (!calcId) return false;
    const trend = loadHealthScoreTrend();
    if (!(calcId in trend)) return false;
    delete trend[calcId];
    return saveHealthScoreTrend(trend);
}

/* ---------- Stage 8.1: применённые обновления прайсов провайдеров ---------- */

/**
 * Возвращает плоский map { providerId: AppliedJSON } или null если ключа нет /
 * JSON повреждён / не объект (массив/строка/число тоже отбрасываются).
 */
export function loadProviderOverrides() {
    const v = readJson(STORAGE_KEYS.PROVIDER_OVERLAY_OVERRIDES, null);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    return v;
}

/**
 * Атомарный read-modify-write над всем map'ом overrides. Возвращает false при
 * пустом providerId или при write-failure (quota → see writeJson).
 */
export function saveProviderOverride(providerId, appliedJson) {
    if (!providerId || typeof providerId !== 'string') return false;
    const current = loadProviderOverrides() || {};
    current[providerId] = appliedJson;
    return writeJson(STORAGE_KEYS.PROVIDER_OVERLAY_OVERRIDES, current);
}

/**
 * Удалить override одного провайдера. Idempotent — возврат true даже если
 * провайдера нет в map'е или сам ключ отсутствует в storage.
 */
export function clearProviderOverride(providerId) {
    if (!providerId || typeof providerId !== 'string') return false;
    const current = loadProviderOverrides();
    if (!current || !(providerId in current)) return true;
    delete current[providerId];
    return writeJson(STORAGE_KEYS.PROVIDER_OVERLAY_OVERRIDES, current);
}

/* ---------- Stage 14.1 (PATCH 2.7.1): per-category фильтр аналитики ---------- */

/**
 * Загрузить фильтр видимых категорий аналитической модалки. Возвращает массив
 * (string[]) категорий или null = «не сохранено» (UI выберет дефолт = все 5).
 *
 * Отдельное `null` vs пустой массив осмысленно: пользователь, который явно
 * скрыл ВСЕ категории, должен видеть пустую таблицу при следующем открытии,
 * а не auto-reset на дефолт. Дефолт применяется только когда сохранения нет.
 */
export function loadProviderAnalyticsVisibleCategories() {
    const v = readJson(STORAGE_KEYS.PROVIDER_ANALYTICS_VISIBLE_CATEGORIES, null);
    if (v === null) return null;
    if (!Array.isArray(v)) return null;
    return v.filter(c => typeof c === 'string');
}

/**
 * Сохранить фильтр видимых категорий. Передача `null` стирает сохранение
 * (next open вернёт UI к дефолту), массив — записывает как есть.
 */
export function saveProviderAnalyticsVisibleCategories(categories) {
    if (categories === null || categories === undefined) {
        return writeJson(STORAGE_KEYS.PROVIDER_ANALYTICS_VISIBLE_CATEGORIES, null);
    }
    if (!Array.isArray(categories)) return false;
    const safe = categories.filter(c => typeof c === 'string');
    return writeJson(STORAGE_KEYS.PROVIDER_ANALYTICS_VISIBLE_CATEGORIES, safe);
}

/* ---------- Stage 14.5 (PATCH 2.7.3): выбранные провайдеры в модалке
   «Сравнить расчёт по провайдерам» (cross-provider scenario comparison). ---------- */

export function loadScenarioComparisonSelectedProviders() {
    const v = readJson(STORAGE_KEYS.SCENARIO_COMPARISON_SELECTED_PROVIDERS, null);
    if (v === null) return null;
    if (!Array.isArray(v)) return null;
    return v.filter(id => typeof id === 'string');
}

export function saveScenarioComparisonSelectedProviders(providerIds) {
    if (providerIds === null || providerIds === undefined) {
        return writeJson(STORAGE_KEYS.SCENARIO_COMPARISON_SELECTED_PROVIDERS, null);
    }
    if (!Array.isArray(providerIds)) return false;
    const safe = providerIds.filter(id => typeof id === 'string');
    return writeJson(STORAGE_KEYS.SCENARIO_COMPARISON_SELECTED_PROVIDERS, safe);
}

/* ---------- Stage 14.4 (PATCH 2.7.2): раскрытые провайдеры в multi-provider
   accordion'е delta-history модалки. ---------- */

/**
 * Загрузить список раскрытых провайдеров. Возвращает string[] или null
 * = «не сохранено» (UI раскроет только preselected providerId).
 *
 * Отдельное `null` vs пустой массив осмысленно: пользователь, который явно
 * свернул всё, при следующем open видит свёрнутый accordion (а не auto-expand
 * всех). Дефолт (auto-expand preselected) применяется только если ключа нет.
 */
export function loadDeltaHistoryExpandedProviders() {
    const v = readJson(STORAGE_KEYS.DELTA_HISTORY_EXPANDED_PROVIDERS, null);
    if (v === null) return null;
    if (!Array.isArray(v)) return null;
    return v.filter(id => typeof id === 'string');
}

/**
 * Сохранить список раскрытых провайдеров. Передача `null` стирает сохранение
 * (next open → дефолт = preselected providerId).
 */
export function saveDeltaHistoryExpandedProviders(providerIds) {
    if (providerIds === null || providerIds === undefined) {
        return writeJson(STORAGE_KEYS.DELTA_HISTORY_EXPANDED_PROVIDERS, null);
    }
    if (!Array.isArray(providerIds)) return false;
    const safe = providerIds.filter(id => typeof id === 'string');
    return writeJson(STORAGE_KEYS.DELTA_HISTORY_EXPANDED_PROVIDERS, safe);
}

/* ---------- Stage 9.5: история override-snapshot'ов per provider ---------- */

/**
 * Возвращает стек снимков для провайдера (newest first). При corrupt JSON или
 * нелегальной структуре — возвращает [] (no-throw).
 */
export function loadProviderOverrideHistory(providerId) {
    if (!providerId || typeof providerId !== 'string') return [];
    const map = readJson(STORAGE_KEYS.PROVIDER_OVERRIDE_HISTORY, null);
    if (!map || typeof map !== 'object' || Array.isArray(map)) return [];
    const arr = map[providerId];
    return Array.isArray(arr) ? arr : [];
}

/**
 * Добавить snapshot в начало стека (newest first), ограничить до
 * PROVIDER_OVERRIDE_HISTORY_LIMIT.
 *
 * @param {string} providerId
 * @param {{ appliedJSON: object, appliedAt: string }} snapshot
 * @returns {boolean}
 */
export function pushProviderOverrideHistory(providerId, snapshot) {
    if (!providerId || typeof providerId !== 'string') return false;
    if (!snapshot || typeof snapshot !== 'object') return false;
    const map = readJson(STORAGE_KEYS.PROVIDER_OVERRIDE_HISTORY, null);
    const safe = (map && typeof map === 'object' && !Array.isArray(map)) ? map : {};
    const current = Array.isArray(safe[providerId]) ? safe[providerId] : [];
    const next = [snapshot, ...current].slice(0, PROVIDER_OVERRIDE_HISTORY_LIMIT);
    safe[providerId] = next;
    return writeJson(STORAGE_KEYS.PROVIDER_OVERRIDE_HISTORY, safe);
}

/**
 * Удалить всю историю одного провайдера. Idempotent — true даже если ключа нет.
 */
export function clearProviderOverrideHistory(providerId) {
    if (!providerId || typeof providerId !== 'string') return false;
    const map = readJson(STORAGE_KEYS.PROVIDER_OVERRIDE_HISTORY, null);
    if (!map || typeof map !== 'object' || Array.isArray(map)) return true;
    if (!(providerId in map)) return true;
    delete map[providerId];
    return writeJson(STORAGE_KEYS.PROVIDER_OVERRIDE_HISTORY, map);
}

/**
 * Snapshot текущего top-of-stack (для UI «Откатить на предыдущий прайс»).
 */
export function peekProviderOverrideHistory(providerId) {
    const arr = loadProviderOverrideHistory(providerId);
    return arr.length > 0 ? arr[0] : null;
}

/**
 * Удалить и вернуть top-of-stack snapshot. Используется при rollback —
 * snapshot становится current override, а из истории удаляется.
 */
/**
 * Удалить и вернуть top-of-stack snapshot.
 *
 * Внешний аудит #3 (2026-05-18, P2): если writeJson не смог сохранить
 * truncated map (quota), функция возвращала snapshot — но storage остался
 * со старым стеком. Caller (rollback) поверил, что history сдвинулась и
 * не предупредил пользователя.
 *
 * Новый контракт: возвращает `{ snapshot, persisted }` либо `null` если
 * стек пуст или providerId невалиден. Caller обязан проверить `persisted`,
 * чтобы понять, действительно ли стек сдвинулся.
 */
export function popProviderOverrideHistory(providerId) {
    if (!providerId || typeof providerId !== 'string') return null;
    const map = readJson(STORAGE_KEYS.PROVIDER_OVERRIDE_HISTORY, null);
    if (!map || typeof map !== 'object' || Array.isArray(map)) return null;
    const current = Array.isArray(map[providerId]) ? map[providerId] : [];
    if (current.length === 0) return null;
    const [first, ...rest] = current;
    map[providerId] = rest;
    const persisted = writeJson(STORAGE_KEYS.PROVIDER_OVERRIDE_HISTORY, map);
    return { snapshot: first, persisted };
}

/**
 * Stage 10.3: установить весь массив истории для провайдера атомарно.
 * Нужно для restoreProviderOverrideFromHistory — там удаляются записи в
 * середине стека (newer-чем-target), и push/pop не подходят.
 *
 * @param {string} providerId
 * @param {Array<{appliedJSON, appliedAt}>} arr
 * @returns {boolean}
 */
export function setProviderOverrideHistory(providerId, arr) {
    if (!providerId || typeof providerId !== 'string') return false;
    if (!Array.isArray(arr)) return false;
    const map = readJson(STORAGE_KEYS.PROVIDER_OVERRIDE_HISTORY, null);
    const safe = (map && typeof map === 'object' && !Array.isArray(map)) ? map : {};
    safe[providerId] = arr.slice(0, PROVIDER_OVERRIDE_HISTORY_LIMIT);
    return writeJson(STORAGE_KEYS.PROVIDER_OVERRIDE_HISTORY, safe);
}

/* ---------- 14.U9: раскрыт ли блок «Сводка тарифов overlay» под dropdown ---------- */

export function loadProviderOverlayExpanded() {
    const v = readJson(STORAGE_KEYS.PROVIDER_OVERLAY_EXPANDED, null);
    return typeof v === 'boolean' ? v : null;
}

export function saveProviderOverlayExpanded(open) {
    return writeJson(STORAGE_KEYS.PROVIDER_OVERLAY_EXPANDED, !!open);
}

/* ---------- Дашборд: раскрытые «По категориям» в стенд-карточках (12.U25-fix-17) ---------- */

export function loadStandCardsCatsExpanded() {
    const v = readJson(STORAGE_KEYS.STAND_CARDS_CATS_EXPANDED, null);
    return Array.isArray(v) ? v : null;
}

export function saveStandCardsCatsExpanded(expanded) {
    return writeJson(STORAGE_KEYS.STAND_CARDS_CATS_EXPANDED, Array.isArray(expanded) ? expanded : []);
}

/* ---------- Детализация: свёрнутые категории-аккордеоны (12.U27) ---------- */

export function loadDetailsCollapsedCats() {
    const v = readJson(STORAGE_KEYS.DETAILS_COLLAPSED_CATS, null);
    return Array.isArray(v) ? v : null;
}

export function saveDetailsCollapsedCats(collapsed) {
    return writeJson(STORAGE_KEYS.DETAILS_COLLAPSED_CATS, Array.isArray(collapsed) ? collapsed : []);
}

/* ---------- Сравнение: свёрнутые категории-аккордеоны (12.U28) ---------- */

export function loadComparisonCollapsedCats() {
    const v = readJson(STORAGE_KEYS.COMPARISON_COLLAPSED_CATS, null);
    return Array.isArray(v) ? v : null;
}

export function saveComparisonCollapsedCats(collapsed) {
    return writeJson(STORAGE_KEYS.COMPARISON_COLLAPSED_CATS, Array.isArray(collapsed) ? collapsed : []);
}

/* ---------- Элементы: свёрнутые категории-аккордеоны (12.U29) ---------- */

export function loadItemsCollapsedCats() {
    const v = readJson(STORAGE_KEYS.ITEMS_COLLAPSED_CATS, null);
    return Array.isArray(v) ? v : null;
}

export function saveItemsCollapsedCats(collapsed) {
    return writeJson(STORAGE_KEYS.ITEMS_COLLAPSED_CATS, Array.isArray(collapsed) ? collapsed : []);
}

/* ---------- Вопросы: свёрнутые секции-аккордеоны (12.U29) ---------- */

export function loadQuestionsCollapsedSecs() {
    const v = readJson(STORAGE_KEYS.QUESTIONS_COLLAPSED_SECS, null);
    return Array.isArray(v) ? v : null;
}

export function saveQuestionsCollapsedSecs(collapsed) {
    return writeJson(STORAGE_KEYS.QUESTIONS_COLLAPSED_SECS, Array.isArray(collapsed) ? collapsed : []);
}

/* ---------- Сравнение: сортировка постатейной таблицы (12.U25) ---------- */

export function loadComparisonSort() {
    const v = readJson(STORAGE_KEYS.COMPARISON_SORT, null);
    if (!v || typeof v !== 'object') return null;
    const ci = Number.isInteger(v.columnIndex) && v.columnIndex >= 0 ? v.columnIndex : null;
    const dir = v.direction === 'asc' || v.direction === 'desc' ? v.direction : 'asc';
    if (ci === null) return null;
    return { columnIndex: ci, direction: dir };
}

export function saveComparisonSort(sort) {
    if (!sort || sort.columnIndex === null || sort.columnIndex === undefined) {
        return writeJson(STORAGE_KEYS.COMPARISON_SORT, null);
    }
    return writeJson(STORAGE_KEYS.COMPARISON_SORT, {
        columnIndex: sort.columnIndex,
        direction: sort.direction === 'desc' ? 'desc' : 'asc'
    });
}

/* ---------- Глобальный справочник ---------- */

export function loadDefaultDictionary() {
    return readJson(STORAGE_KEYS.DEFAULT_DICTIONARY, null);
}

export function saveDefaultDictionary(dict) {
    return writeJson(STORAGE_KEYS.DEFAULT_DICTIONARY, dict);
}

/* ---------- Stage 15.3 (PATCH 2.8.2): Анализ чувствительности — фильтры ---------- */

export function loadSensitivityFilters() {
    const v = readJson(STORAGE_KEYS.SENSITIVITY_FILTERS, null);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const validCostTypes = ['opex', 'capex', 'total'];
    if (!validCostTypes.includes(v.costType)) return null;
    if (!Array.isArray(v.categories)) return null;
    const validCats = ['infrastructure', 'storage', 'ai', 'risk', 'security', 'service'];
    const cats = v.categories.filter(c => validCats.includes(c));
    return { costType: v.costType, categories: cats };
}

export function saveSensitivityFilters(filters) {
    if (!filters || typeof filters !== 'object') return false;
    return writeJson(STORAGE_KEYS.SENSITIVITY_FILTERS, filters);
}

/* ---------- Версионирование схемы ---------- */

export function getSchemaVersion() {
    return readJson(STORAGE_KEYS.SCHEMA_VERSION, 0) || 0;
}

export function setSchemaVersion(v) {
    writeJson(STORAGE_KEYS.SCHEMA_VERSION, v);
}

/**
 * Миграции схемы. Запускаются один раз при старте.
 * Каждый шаг: from → to, должен быть идемпотентен.
 */
export function runMigrations() {
    const current = getSchemaVersion();
    if (current >= CURRENT_SCHEMA_VERSION) return;
    // Здесь будут шаги миграции при обновлениях. Для v1 — просто проставляем версию.
    setSchemaVersion(CURRENT_SCHEMA_VERSION);
}
