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
 * расчёты", хотя данные на месте. Если же localStorage недоступен как
 * объект (приватный режим, отозванный пермишн) — getStorage() уже
 * закэширует _probedOk=false и getReadStorage отдаст тот же memory fallback.
 */
function getReadStorage() {
    if (_probedOk === false) return _memoryStorage();
    try {
        /* Лёгкая проверка: getItem на несуществующий ключ. В private-режиме
         * Safari это бросает в самый первый раз — тогда переключаемся в
         * memory как и getStorage(). В обычном режиме всегда возвращает null
         * и НЕ требует свободного места. */
        localStorage.getItem('__read_probe__');
        return localStorage;
    } catch {
        _probedOk = false;
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
 * Полная очистка ключей приложения. Затрагивает только те ключи, что
 * принадлежат калькулятору (префикс STORAGE_KEYS.CALC_PREFIX и whitelist STORAGE_KEYS).
 */
export function resetAll() {
    const s = getStorage();
    const toRemove = [];
    for (let i = 0; i < s.length; i++) {
        const k = s.key(i);
        if (isAppKey(k)) toRemove.push(k);
    }
    for (const k of toRemove) s.removeItem(k);
}

/**
 * Получить все ключи приложения (для отладки/диагностики).
 */
export function listKeys() {
    const s = getStorage();
    const keys = [];
    for (let i = 0; i < s.length; i++) {
        const k = s.key(i);
        if (isAppKey(k)) keys.push(k);
    }
    return keys;
}
