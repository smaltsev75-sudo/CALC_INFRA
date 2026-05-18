/**
 * Обёртка над localStorage с graceful degradation для приватного режима
 * и недоступного хранилища. Все методы — синхронные.
 */

import { STORAGE_KEYS } from '../utils/constants.js';

let _memoryFallback = null;
/* Результат probe-проверки кэшируется на жизнь модуля:
 *   null   — probe ещё не делался;
 *   true   — реальный localStorage пригоден и для чтения, и для записи;
 *   false  — приватный режим / нет API / пермишн отозван → memory fallback.
 *
 * Внешний аудит 2026-05-18 (P1-1): раньше getStorage() делал probe-setItem
 * на КАЖДЫЙ вызов, в том числе из readJson. При исчерпанной квоте
 * QuotaExceededError из setItem('__test__', ...) переключал getStorage на
 * пустой in-memory fallback, и readJson возвращал fallback-значение, хотя
 * данные в реальном localStorage оставались доступны для чтения. Чинится
 * двумя путями: (а) probe только один раз при первом обращении (cache);
 * (б) для чтения вообще не нужен probe — localStorage может быть в quota,
 * но getItem от этого не страдает. Поэтому writeJson/removeKey ходят через
 * getStorage() с probe, а readJson — через getReadStorage() без probe.
 */
let _probedOk = null;

function _memoryStorage() {
    if (!_memoryFallback) _memoryFallback = new Map();
    return {
        getItem: k => _memoryFallback.has(k) ? _memoryFallback.get(k) : null,
        setItem: (k, v) => _memoryFallback.set(k, String(v)),
        removeItem: k => _memoryFallback.delete(k),
        key: i => Array.from(_memoryFallback.keys())[i] ?? null,
        get length() { return _memoryFallback.size; }
    };
}

/**
 * Storage для ЗАПИСИ. Если ни разу не probed — пробует записать '__test__'
 * единожды и кэширует результат. Quota во время реальных setItem'ов после
 * успешного probe не переключает на memory — отдельный try/catch в writeJson
 * вернёт false и UI поднимет persistStatus='error' (контракт 10.1.5).
 */
function getStorage() {
    if (_probedOk === true) return localStorage;
    if (_probedOk === false) return _memoryStorage();
    try {
        const t = '__test__';
        localStorage.setItem(t, t);
        localStorage.removeItem(t);
        _probedOk = true;
        return localStorage;
    } catch {
        _probedOk = false;
        return _memoryStorage();
    }
}

/**
 * Storage для ЧТЕНИЯ. Никакого probe-setItem — иначе при quota мы бы
 * молча уходили в пустой memory fallback и пользователь видел "пропали все
 * расчёты", хотя данные на месте.
 *
 * Внешний аудит #8 (2026-05-18, P1-1): дополнительно НЕ доверяем `_probedOk=false`
 * для отказа от чтения. Этот флаг ставится в `getStorage()` при write-probe
 * fail — а write-probe fail может означать либо Safari Private (тогда и read
 * упадёт), либо квоту (read работает!). Если поверить флагу и сразу вернуть
 * memory fallback — при квоте получим «все расчёты пропали», хотя getItem
 * работает. Поэтому всегда пробуем реальный localStorage, и только если
 * getItem сам бросит (Safari Private) — fallback. catch НЕ мутирует _probedOk:
 * write-state — отдельная плоскость от read-state, прежний фикс P2-3
 * (getReadRemoveStorage) шёл тем же путём.
 */
function getReadStorage() {
    try {
        if (typeof localStorage === 'undefined' || localStorage === null) {
            return _memoryStorage();
        }
        /* Лёгкая проверка: getItem на несуществующий ключ. В private-режиме
         * Safari это бросает в самый первый раз — тогда переключаемся в
         * memory. В обычном режиме (включая полную квоту) всегда возвращает
         * null и НЕ требует свободного места. */
        localStorage.getItem('__read_probe__');
        return localStorage;
    } catch {
        return _memoryStorage();
    }
}

export function readJson(key, fallback = null) {
    const s = getReadStorage();
    const raw = s.getItem(key);
    if (raw === null || raw === undefined) return fallback;
    try { return JSON.parse(raw); }
    catch { return fallback; }
}

export function writeJson(key, value) {
    const s = getStorage();
    /* Внешний аудит #2 (2026-05-18, P1-1): если probe фейлится (Safari Private,
     * полная quota), getStorage переключает на memory fallback. Записи в Map
     * НЕ бросают, и раньше writeJson возвращал true → persistStatus='saved'
     * → пользователь видит «сохранено», после F5 теряет данные (memory
     * session-only). Теперь явный false: пусть persistStatus='error' покажет
     * пользователю проблему с хранилищем. Read-операции через getReadStorage
     * продолжают работать (sessions может читать что положено в этой сессии). */
    if (_probedOk === false) return false;

    /* 12.U31 (E.3): JSON.stringify ловим ОТДЕЛЬНО от setItem — раньше throw из
       JSON.stringify (циклическая ссылка / кастомный toJSON-throw) выходил
       НЕперехваченным наружу с raw stack-trace. Внешний контракт writeJson —
       «возвращает false при любой невозможности записи», цикл попадает сюда. */
    let payload;
    try {
        payload = JSON.stringify(value);
    } catch {
        return false;
    }
    try {
        s.setItem(key, payload);
        return true;
    } catch {
        // QuotaExceededError или другое — не валим приложение и не засоряем
        // консоль. Сигнал об ошибке поднимается через persistStatus в store
        // (см. services/calcPersistence.js) и видим пользователю.
        return false;
    }
}

/**
 * Только для тестов: сброс probe-кэша. Производственный код не должен звать.
 * Нужен в спай-тестах, которые подменяют localStorage между describe-блоками
 * и хотят, чтобы следующий getStorage() сделал свежий probe с новым spy.
 */
export function __resetStorageMode() {
    _probedOk = null;
    _memoryFallback = null;
}

export function removeKey(key) {
    const s = getStorage();
    s.removeItem(key);
}

/**
 * Whitelist всех ключей приложения. Один источник истины — STORAGE_KEYS.
 *
 * 12.U31 (Code Review Followup, E-P1): раньше resetAll/listKeys хардкодили
 * 6 ключей + префикс CALC_, пропуская 8 из 16 ключей UI-state, добавленных
 * в 12.U1/U25/U27/U28/U29 (questionnaireOpenSections, comparisonSort,
 * detailsCollapsedCats и т.д.). После «Сбросить всё» orphan ключи
 * применялись к новым расчётам. Теперь обе функции строят whitelist через
 * `Object.values(STORAGE_KEYS)` — добавление нового ключа автоматически
 * охватывается обеими функциями.
 *
 * CALC_PREFIX — это не отдельный ключ, а префикс для динамических `calc.<id>`
 * ключей; обрабатывается отдельной startsWith-проверкой.
 */
function isAppKey(k) {
    if (!k) return false;
    if (k.startsWith(STORAGE_KEYS.CALC_PREFIX) && k !== STORAGE_KEYS.CALC_PREFIX) return true;
    for (const known of Object.values(STORAGE_KEYS)) {
        if (known === STORAGE_KEYS.CALC_PREFIX) continue;
        if (k === known) return true;
    }
    return false;
}

/**
 * 12.U31 (E.4): helpers для PDF_HINT_SHOWN флага. Раньше app.js / keyboardController.js
 * вызывали `localStorage.getItem/setItem(STORAGE_KEYS.PDF_HINT_SHOWN, ...)` напрямую,
 * минуя `getStorage()`-probe — в Safari Private Mode мог упасть и подсказка
 * показывалась повторно. Через writeJson/readJson — graceful fallback.
 */
export function loadPdfHintShown() {
    return readJson(STORAGE_KEYS.PDF_HINT_SHOWN, false) === true;
}
export function markPdfHintShown() {
    return writeJson(STORAGE_KEYS.PDF_HINT_SHOWN, true);
}

/**
 * Storage для READ/REMOVE-операций, обходящих `_probedOk=false` ловушку.
 * Внешний аудит #4 (2026-05-18, P2-3): когда storage полностью заполнен,
 * probe-setItem в `getStorage()` бросает QuotaExceededError → `_probedOk=false`
 * → memory fallback. После этого `resetAll`/`listKeys` через `getStorage()`
 * читают пустую in-memory Map, хотя в реальном localStorage остаются данные
 * (включая большие calc.<id>), которые можно зачистить через removeItem
 * (он НЕ требует свободного места). Этот helper возвращает реальный
 * localStorage если он вообще существует и доступен для чтения; только если
 * сам объект недоступен (Safari Private Mode без API) — отдаёт memory.
 */
function getReadRemoveStorage() {
    try {
        /* Проверка: localStorage существует и хотя бы getItem не бросает.
         * В обычном квота-режиме это всегда true; в Safari Private — может
         * упасть на первом getItem. */
        if (typeof localStorage === 'undefined' || localStorage === null) {
            return _memoryStorage();
        }
        localStorage.getItem('__read_probe__');
        return localStorage;
    } catch {
        return _memoryStorage();
    }
}

/**
 * Полная очистка ключей приложения. Затрагивает только те ключи, что
 * принадлежат калькулятору (префикс STORAGE_KEYS.CALC_PREFIX и whitelist STORAGE_KEYS).
 *
 * Внешний аудит #4 (2026-05-18, P2-3): идёт через `getReadRemoveStorage()`,
 * а не `getStorage()` — иначе при полной quota пользователь не мог зачистить
 * собственные данные (probe-fail → memory fallback → реальные calc.* невидимы).
 */
export function resetAll() {
    const s = getReadRemoveStorage();
    const toRemove = [];
    for (let i = 0; i < s.length; i++) {
        const k = s.key(i);
        if (isAppKey(k)) toRemove.push(k);
    }
    for (const k of toRemove) {
        try { s.removeItem(k); } catch { /* removeItem обычно не бросает; best-effort */ }
    }
}

/**
 * Получить все ключи приложения (для отладки/диагностики).
 * См. resetAll: тоже идёт через getReadRemoveStorage из-за P2-3.
 */
export function listKeys() {
    const s = getReadRemoveStorage();
    const keys = [];
    for (let i = 0; i < s.length; i++) {
        const k = s.key(i);
        if (isAppKey(k)) keys.push(k);
    }
    return keys;
}
