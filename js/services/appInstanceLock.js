/**
 * Stage 19.x: single-instance lock на browser-level.
 *
 * Главная цель — защитить пользователя от потери расчётов при одновременном
 * запуске нескольких экземпляров приложения на одном компьютере. Две вкладки
 * (или два браузера/профиля, открывшие один origin) конкурируют за `calc.*`
 * ключи в localStorage: последняя запись побеждает, предыдущая теряется.
 *
 * Контракт:
 *   1. На boot, ДО `calcList.initFromStorage()` и любых записей, нужно
 *      позвать `acquireAppInstanceLock()`.
 *   2. Если lock свободен или stale (TTL > APP_INSTANCE_LOCK_TTL_MS) —
 *      текущий экземпляр становится владельцем (ownerId генерируется тут же,
 *      записывается в localStorage).
 *   3. Если lock занят живым владельцем — `{ ok: false, reason: 'occupied' }`.
 *      Версия приложения в логике допуска НЕ участвует — поле `appVersion`
 *      сохраняется только для диагностики.
 *   4. Если запись в storage не удалась (quota / Safari Private / memory
 *      fallback) — `{ ok: false, reason: 'write-failed' }`. По ТЗ: запуск
 *      блокируется, а НЕ продолжается без защиты.
 *   5. Heartbeat каждые APP_INSTANCE_LOCK_HEARTBEAT_MS обновляет `lastSeenAt`.
 *      Если в этот момент другой экземпляр перехватил lock (`ownerId` уже
 *      не наш) — heartbeat возвращает `{ ok: false, reason: 'lost' }`.
 *   6. `releaseAppInstanceLock(ownerId)` удаляет lock ТОЛЬКО если ownerId
 *      совпадает с записанным. Иначе чужой экземпляр мог бы случайно
 *      выгнать активного владельца.
 *
 * Зачем «версия не важна»: одна копия приложения старой версии и одна копия
 * новой версии, открытые одновременно, — это два writer'а к одному
 * `localStorage`. Старая запишет calc по схеме vN, новая по vN+1, обе
 * пересекутся → данные пользователя в нестабильном состоянии. ТЗ требует
 * блокировать любой второй запуск, независимо от версии.
 */

import { readJson, writeJson, removeKey } from './storage.js';
import {
    STORAGE_KEYS,
    APP_INSTANCE_LOCK_TTL_MS,
    APP_INSTANCE_LOCK_HEARTBEAT_MS,
    APP_VERSION
} from '../utils/constants.js';
import { uuid as defaultUuid } from '../utils/uuid.js';

/* ============================================================
 * Internals
 * ============================================================ */

/** ISO-строка времени по now(). Изолируем `new Date()` для тестов. */
function toIso(nowMs) {
    return new Date(nowMs).toISOString();
}

/** Проверка, что lock протух по lastSeenAt + TTL. */
function isStale(lock, nowMs) {
    if (!lock || !lock.lastSeenAt) return true;
    const ts = Date.parse(lock.lastSeenAt);
    if (!Number.isFinite(ts)) return true;
    return (nowMs - ts) > APP_INSTANCE_LOCK_TTL_MS;
}

/** Прочитать lock из storage. Возвращает null, если пусто/некорректно. */
function readLock() {
    const raw = readJson(STORAGE_KEYS.APP_INSTANCE_LOCK, null);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    if (typeof raw.ownerId !== 'string' || !raw.ownerId) return null;
    return raw;
}

function safeUrl(opts) {
    if (typeof opts.url === 'string') return opts.url;
    if (typeof location !== 'undefined' && location && typeof location.href === 'string') {
        return location.href;
    }
    return '';
}

/* ============================================================
 * Public API
 * ============================================================ */

/**
 * Захватить single-instance lock.
 *
 * @param {Object} [opts]
 * @param {() => number} [opts.now] — функция-источник «сейчас» (для тестов).
 *      Дефолт: Date.now.
 * @param {() => string} [opts.uuid] — функция-источник ownerId (для тестов).
 *      Дефолт: uuid() из utils (crypto.randomUUID).
 * @param {string} [opts.appVersion] — версия приложения (для диагностики).
 *      Дефолт: APP_VERSION из constants. НЕ участвует в логике допуска.
 * @param {string} [opts.url] — URL приложения (для диагностики). Дефолт:
 *      location.href при наличии.
 * @returns {{ ok: true, ownerId: string, lock: Object } |
 *           { ok: false, reason: 'occupied'|'write-failed', existing: Object|null }}
 */
export function acquireAppInstanceLock(opts = {}) {
    const now = opts.now ?? Date.now;
    const uuid = opts.uuid ?? defaultUuid;
    const appVersion = typeof opts.appVersion === 'string' ? opts.appVersion : APP_VERSION;
    const url = safeUrl(opts);

    const nowMs = now();
    const existing = readLock();

    if (existing && !isStale(existing, nowMs)) {
        /* Lock жив и принадлежит другому owner'у — блокируем запуск.
         * Возвращаем existing, чтобы UI мог показать диагностику
         * (когда был запущен, какой URL, какая версия) — но без bypass-кнопки. */
        return { ok: false, reason: 'occupied', existing };
    }

    const ownerId = uuid();
    const iso = toIso(nowMs);
    const lock = {
        schemaVersion: 1,
        ownerId,
        startedAt: iso,
        lastSeenAt: iso,
        appVersion,
        url
    };

    if (!writeJson(STORAGE_KEYS.APP_INSTANCE_LOCK, lock)) {
        /* Если не можем записать lock — нельзя и работать. Возможные причины:
         *  - quota (исчерпано хранилище);
         *  - Safari Private (memory fallback не считается persistent — для
         *    защиты F5 он бесполезен);
         *  - LS отозван permission'ом.
         * По ТЗ §7: «Если lock нельзя записать — запуск блокировать, а не
         * продолжать без защиты». Пользователь увидит blocked-screen с
         * пояснением, что storage недоступен. */
        return { ok: false, reason: 'write-failed', existing };
    }

    return { ok: true, ownerId, lock };
}

/**
 * Обновить `lastSeenAt` живого lock'а.
 *
 * @param {string} ownerId — id, полученный из acquireAppInstanceLock.
 * @param {Object} [opts]
 * @param {() => number} [opts.now]
 * @returns {{ ok: true, lock: Object } |
 *           { ok: false, reason: 'absent'|'lost'|'write-failed', existing?: Object }}
 */
export function heartbeatAppInstanceLock(ownerId, opts = {}) {
    const now = opts.now ?? Date.now;
    const existing = readLock();
    if (!existing) return { ok: false, reason: 'absent' };
    if (existing.ownerId !== ownerId) {
        /* Lock перехвачен — либо «текущая» вкладка проспала heartbeat дольше
         * TTL и другая вкладка успела захватить, либо пользователь явно
         * очистил storage и перезапустил приложение. В обоих случаях
         * текущий экземпляр должен перейти в blocked-state. */
        return { ok: false, reason: 'lost', existing };
    }
    const updated = { ...existing, lastSeenAt: toIso(now()) };
    if (!writeJson(STORAGE_KEYS.APP_INSTANCE_LOCK, updated)) {
        return { ok: false, reason: 'write-failed' };
    }
    return { ok: true, lock: updated };
}

/**
 * Освободить lock (только свой).
 *
 * @param {string} ownerId
 * @returns {{ ok: true } | { ok: false, reason: 'absent'|'not-owner' }}
 */
export function releaseAppInstanceLock(ownerId) {
    const existing = readLock();
    if (!existing) return { ok: false, reason: 'absent' };
    if (existing.ownerId !== ownerId) return { ok: false, reason: 'not-owner' };
    removeKey(STORAGE_KEYS.APP_INSTANCE_LOCK);
    return { ok: true };
}

/**
 * Прочитать текущее состояние lock без побочных эффектов.
 *
 * @param {string|null} [ownerId] — текущий ownerId (опционально). Если
 *      передан и совпадает с записанным — статус 'owned'.
 * @param {Object} [opts]
 * @param {() => number} [opts.now]
 * @returns {{ status: 'free'|'owned'|'occupied'|'stale', lock: Object|null }}
 */
export function checkAppInstanceLock(ownerId = null, opts = {}) {
    const now = opts.now ?? Date.now;
    const existing = readLock();
    if (!existing) return { status: 'free', lock: null };
    if (isStale(existing, now())) return { status: 'stale', lock: existing };
    if (ownerId && existing.ownerId === ownerId) return { status: 'owned', lock: existing };
    return { status: 'occupied', lock: existing };
}

/**
 * Запустить периодический heartbeat. Возвращает { stop } для остановки.
 *
 * `onLost` (опциональный callback) вызывается, если heartbeat обнаружил, что
 * lock перехвачен другим экземпляром (`reason: 'lost'`). UI в этой ситуации
 * обязан перейти в blocked-state и прекратить рабочий UX (см. ТЗ §"Если во
 * время работы появился другой live owner").
 *
 * @param {string} ownerId
 * @param {Object} [opts]
 * @param {number} [opts.intervalMs] — период тика (мс).
 *      Дефолт: APP_INSTANCE_LOCK_HEARTBEAT_MS.
 * @param {(existing: Object|undefined) => void} [opts.onLost]
 * @param {(reason: string) => void} [opts.onWriteFailed]
 * @param {typeof setInterval} [opts.setInterval]
 * @param {typeof clearInterval} [opts.clearInterval]
 * @param {() => number} [opts.now]
 * @returns {{ stop: () => void }}
 */
export function startAppInstanceHeartbeat(ownerId, opts = {}) {
    const intervalMs = Number.isFinite(opts.intervalMs)
        ? opts.intervalMs
        : APP_INSTANCE_LOCK_HEARTBEAT_MS;
    const setIntervalFn = opts.setInterval
        ?? (typeof setInterval !== 'undefined' ? setInterval : null);
    const clearIntervalFn = opts.clearInterval
        ?? (typeof clearInterval !== 'undefined' ? clearInterval : null);

    if (!setIntervalFn || !clearIntervalFn) {
        /* В node-окружении (тесты) без таймеров — no-op. */
        return { stop: () => {} };
    }

    const handle = setIntervalFn(() => {
        const r = heartbeatAppInstanceLock(ownerId, opts);
        if (!r.ok) {
            if (r.reason === 'lost' && typeof opts.onLost === 'function') {
                opts.onLost(r.existing);
            } else if (r.reason === 'write-failed' && typeof opts.onWriteFailed === 'function') {
                opts.onWriteFailed(r.reason);
            }
        }
    }, intervalMs);

    return { stop: () => clearIntervalFn(handle) };
}
