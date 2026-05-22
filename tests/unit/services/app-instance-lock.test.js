/**
 * Stage 19.x: single-instance lock на browser-level.
 *
 * Главная цель — защитить пользователя от потери расчётов при одновременном
 * запуске нескольких экземпляров приложения на одном компьютере. Версия
 * приложения в логике допуска НЕ участвует — блокируется любой второй
 * запуск, независимо от того, та же версия или другая.
 *
 * Контракт сервиса:
 *   acquireAppInstanceLock({ now, uuid, appVersion, url }) →
 *     { ok: true, ownerId, lock }
 *     | { ok: false, reason: 'occupied'|'write-failed', existing }
 *
 *   heartbeatAppInstanceLock(ownerId, { now }) →
 *     { ok: true, lock }
 *     | { ok: false, reason: 'lost'|'absent'|'write-failed', existing? }
 *
 *   releaseAppInstanceLock(ownerId) →
 *     { ok: true } | { ok: false, reason: 'not-owner'|'absent' }
 *
 *   checkAppInstanceLock(ownerId?, { now }) →
 *     { status: 'free'|'owned'|'occupied'|'stale', lock }
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    STORAGE_KEYS,
    APP_INSTANCE_LOCK_TTL_MS,
    APP_VERSION
} from '../../../js/utils/constants.js';
import { stripJsComments } from '../../_helpers/source.js';

/* ============================================================
 * Test helpers: in-memory localStorage + spy для writeJson-fail
 * ============================================================ */

function installFreshLs() {
    const store = new Map();
    globalThis.localStorage = {
        getItem: k => store.has(k) ? store.get(k) : null,
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: k => store.delete(k),
        key: i => Array.from(store.keys())[i] ?? null,
        get length() { return store.size; }
    };
    return store;
}

function installFailingLs(failOn = 'setItem') {
    const store = new Map();
    globalThis.localStorage = {
        getItem: k => store.has(k) ? store.get(k) : null,
        setItem: (k, v) => {
            if (failOn === 'setItem') throw new Error('QuotaExceededError');
            store.set(k, String(v));
        },
        removeItem: k => store.delete(k),
        key: i => Array.from(store.keys())[i] ?? null,
        get length() { return store.size; }
    };
    return store;
}

/* Каждый тест работает в изолированном LS + сбрасывает probe-cache в storage.js. */
let __resetStorageMode;
let svc;

beforeEach(async () => {
    installFreshLs();
    /* dynamic import + cache-bust через query — иначе module-level _probedOk
     * стучит в один и тот же модуль-инстанс между тестами. cache-bust только
     * для storage.js (он содержит probe-cache); appInstanceLock.js stateless. */
    ({ __resetStorageMode } = await import('../../../js/services/storage.js'));
    __resetStorageMode();
    svc = await import('../../../js/services/appInstanceLock.js');
});

afterEach(() => {
    /* clean fixture для следующего теста, чтобы writeJson из ушедших тестов
     * не отравлял состояние. */
    delete globalThis.localStorage;
});

/* ============================================================
 * 1. acquire: нет lock → запуск разрешен
 * ============================================================ */

describe('appInstanceLock.acquire — boot scenarios', () => {
    it('1. Нет lock → ok=true, ownerId выставлен, в storage лежит lock', () => {
        const result = svc.acquireAppInstanceLock({
            now: () => 1_000_000_000_000,
            uuid: () => 'owner-1',
            appVersion: '2.19.5',
            url: 'http://localhost:8000/'
        });
        assert.equal(result.ok, true);
        assert.equal(result.ownerId, 'owner-1');
        assert.equal(result.lock.schemaVersion, 1);
        assert.equal(result.lock.appVersion, '2.19.5');
        assert.equal(result.lock.url, 'http://localhost:8000/');
        /* lastSeenAt и startedAt — ISO-строки от Date(now()) */
        const stored = JSON.parse(globalThis.localStorage.getItem(STORAGE_KEYS.APP_INSTANCE_LOCK));
        assert.equal(stored.ownerId, 'owner-1');
        assert.equal(stored.appVersion, '2.19.5');
    });

    it('2. Есть live lock → ok=false, reason=occupied, existing передан', () => {
        /* Сначала чужой захватил lock. */
        svc.acquireAppInstanceLock({
            now: () => 1_000_000_000_000,
            uuid: () => 'other-owner',
            appVersion: '2.19.5',
            url: 'http://localhost:8000/'
        });
        /* Через 5 секунд — наш второй экземпляр пытается захватить. */
        const result = svc.acquireAppInstanceLock({
            now: () => 1_000_000_005_000,
            uuid: () => 'me',
            appVersion: '2.19.5',
            url: 'http://localhost:8000/'
        });
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'occupied');
        assert.equal(result.existing.ownerId, 'other-owner');
    });

    it('3. Live lock ТОЙ ЖЕ версии → запуск всё равно запрещён', () => {
        svc.acquireAppInstanceLock({
            now: () => 1_000_000_000_000,
            uuid: () => 'other-owner',
            appVersion: '2.19.5',
            url: 'http://localhost:8000/'
        });
        const result = svc.acquireAppInstanceLock({
            now: () => 1_000_000_005_000,
            uuid: () => 'me',
            appVersion: '2.19.5',
            url: 'http://localhost:8000/'
        });
        assert.equal(result.ok, false, 'версия НЕ влияет на блокировку');
        assert.equal(result.reason, 'occupied');
    });

    it('4. Live lock ДРУГОЙ версии → запуск тоже запрещён', () => {
        svc.acquireAppInstanceLock({
            now: () => 1_000_000_000_000,
            uuid: () => 'old-owner',
            appVersion: '2.18.6',
            url: 'http://localhost:8000/'
        });
        const result = svc.acquireAppInstanceLock({
            now: () => 1_000_000_005_000,
            uuid: () => 'me',
            appVersion: '2.19.5',
            url: 'http://localhost:8000/'
        });
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'occupied');
        assert.equal(result.existing.appVersion, '2.18.6',
            'версия владельца сохранена в existing для диагностики');
    });

    it('5. Stale lock (старше TTL) → текущий экземпляр захватывает', () => {
        /* Старый владелец, чей lastSeenAt 100 секунд назад. */
        svc.acquireAppInstanceLock({
            now: () => 1_000_000_000_000,
            uuid: () => 'crashed-owner',
            appVersion: '2.19.5',
            url: 'http://localhost:8000/'
        });
        const result = svc.acquireAppInstanceLock({
            /* 100 c > TTL=90 c → stale */
            now: () => 1_000_000_000_000 + APP_INSTANCE_LOCK_TTL_MS + 10_000,
            uuid: () => 'me',
            appVersion: '2.19.5',
            url: 'http://localhost:8000/'
        });
        assert.equal(result.ok, true);
        assert.equal(result.ownerId, 'me');
        const stored = JSON.parse(globalThis.localStorage.getItem(STORAGE_KEYS.APP_INSTANCE_LOCK));
        assert.equal(stored.ownerId, 'me', 'stale lock перезаписан текущим');
    });

    it('6. writeJson=false (quota) → ok=false, reason=write-failed', async () => {
        /* Specific: LS бросает на setItem только для APP_INSTANCE_LOCK ключа.
         * Storage.writeJson возвращает false, acquire — ok=false. */
        const store = new Map();
        globalThis.localStorage = {
            getItem: k => store.has(k) ? store.get(k) : null,
            setItem: (k) => {
                if (k === STORAGE_KEYS.APP_INSTANCE_LOCK) {
                    throw new Error('QuotaExceededError');
                }
                store.set(k, '');
            },
            removeItem: k => store.delete(k),
            key: i => Array.from(store.keys())[i] ?? null,
            get length() { return store.size; }
        };
        __resetStorageMode();
        svc = await import('../../../js/services/appInstanceLock.js');

        const result = svc.acquireAppInstanceLock({
            now: () => 1_000_000_000_000,
            uuid: () => 'me',
            appVersion: '2.19.5',
            url: 'http://localhost:8000/'
        });
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'write-failed');
    });

    it('acquire дефолтит uuid через crypto если не передан', () => {
        const result = svc.acquireAppInstanceLock({
            now: () => 1_000_000_000_000,
            appVersion: '2.19.5'
        });
        assert.equal(result.ok, true);
        assert.equal(typeof result.ownerId, 'string');
        assert.ok(result.ownerId.length >= 8,
            'ownerId должен быть достаточно случайным для уникальности');
    });

    it('acquire дефолтит appVersion из APP_VERSION constants', () => {
        const result = svc.acquireAppInstanceLock({
            now: () => 1_000_000_000_000,
            uuid: () => 'me'
        });
        assert.equal(result.ok, true);
        assert.equal(result.lock.appVersion, APP_VERSION);
    });
});

/* ============================================================
 * release: удаляет только свой lock
 * ============================================================ */

describe('appInstanceLock.release', () => {
    it('7. release удаляет lock, если ownerId совпадает', () => {
        const a = svc.acquireAppInstanceLock({
            now: () => 1_000_000_000_000,
            uuid: () => 'me'
        });
        assert.equal(a.ok, true);
        const r = svc.releaseAppInstanceLock(a.ownerId);
        assert.equal(r.ok, true);
        assert.equal(globalThis.localStorage.getItem(STORAGE_KEYS.APP_INSTANCE_LOCK), null);
    });

    it('release НЕ удаляет чужой lock', () => {
        svc.acquireAppInstanceLock({
            now: () => 1_000_000_000_000,
            uuid: () => 'other-owner'
        });
        const r = svc.releaseAppInstanceLock('me-fake-owner');
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'not-owner');
        /* Lock в storage остался! Это критично — иначе одна вкладка
         * могла бы случайно/злонамеренно выгнать чужого активного владельца. */
        const stored = globalThis.localStorage.getItem(STORAGE_KEYS.APP_INSTANCE_LOCK);
        assert.ok(stored, 'чужой lock не удалён');
        const parsed = JSON.parse(stored);
        assert.equal(parsed.ownerId, 'other-owner');
    });

    it('release при отсутствии lock → ok=false, reason=absent', () => {
        const r = svc.releaseAppInstanceLock('me');
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'absent');
    });
});

/* ============================================================
 * heartbeat: обновляет lastSeenAt, защищает от хищения
 * ============================================================ */

describe('appInstanceLock.heartbeat', () => {
    it('8. heartbeat обновляет lastSeenAt при том же ownerId', () => {
        const a = svc.acquireAppInstanceLock({
            now: () => 1_000_000_000_000,
            uuid: () => 'me'
        });
        const originalLastSeenAt = a.lock.lastSeenAt;

        const r = svc.heartbeatAppInstanceLock(a.ownerId, {
            now: () => 1_000_000_000_000 + 5_000
        });
        assert.equal(r.ok, true);
        assert.notEqual(r.lock.lastSeenAt, originalLastSeenAt,
            'lastSeenAt обновился после heartbeat');
        assert.equal(r.lock.ownerId, 'me', 'ownerId не изменился');
        assert.equal(r.lock.startedAt, a.lock.startedAt,
            'startedAt сохранился (только lastSeenAt обновляется)');
    });

    it('heartbeat при потерянном владении → ok=false, reason=lost', () => {
        svc.acquireAppInstanceLock({
            now: () => 1_000_000_000_000,
            uuid: () => 'other-owner'
        });
        const r = svc.heartbeatAppInstanceLock('me-not-owner', {
            now: () => 1_000_000_000_000 + 5_000
        });
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'lost');
        assert.equal(r.existing.ownerId, 'other-owner');
    });

    it('heartbeat при отсутствии lock → ok=false, reason=absent', () => {
        const r = svc.heartbeatAppInstanceLock('me', {
            now: () => 1_000_000_000_000 + 5_000
        });
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'absent');
    });
});

/* ============================================================
 * check: read-only диагностика
 * ============================================================ */

describe('appInstanceLock.check', () => {
    it('check на свежий storage → free', () => {
        const r = svc.checkAppInstanceLock(null, { now: () => 1_000_000_000_000 });
        assert.equal(r.status, 'free');
        assert.equal(r.lock, null);
    });

    it('check на свой lock → owned', () => {
        svc.acquireAppInstanceLock({
            now: () => 1_000_000_000_000,
            uuid: () => 'me'
        });
        const r = svc.checkAppInstanceLock('me', { now: () => 1_000_000_000_000 + 5_000 });
        assert.equal(r.status, 'owned');
        assert.equal(r.lock.ownerId, 'me');
    });

    it('check на чужой live lock → occupied', () => {
        svc.acquireAppInstanceLock({
            now: () => 1_000_000_000_000,
            uuid: () => 'other-owner'
        });
        const r = svc.checkAppInstanceLock('me', { now: () => 1_000_000_000_000 + 5_000 });
        assert.equal(r.status, 'occupied');
    });

    it('check на чужой stale lock → stale', () => {
        svc.acquireAppInstanceLock({
            now: () => 1_000_000_000_000,
            uuid: () => 'crashed'
        });
        const r = svc.checkAppInstanceLock('me', {
            now: () => 1_000_000_000_000 + APP_INSTANCE_LOCK_TTL_MS + 10_000
        });
        assert.equal(r.status, 'stale');
    });
});

/* ============================================================
 * 9. Boot invariant: lock проверяется ДО initFromStorage
 * ============================================================ */

describe('boot integration — lock acquired BEFORE initFromStorage', () => {
    it('app.js: acquireAppInstanceLock вызывается до calcList.initFromStorage', async () => {
        const { readFileSync } = await import('node:fs');
        const { dirname, join } = await import('node:path');
        const { fileURLToPath } = await import('node:url');
        const __dirname = dirname(fileURLToPath(import.meta.url));
        const appSrc = readFileSync(
            join(__dirname, '..', '..', '..', 'js', 'app.js'),
            'utf8'
        );

        const acquireIdx = appSrc.indexOf('acquireAppInstanceLock(');
        const initIdx = appSrc.indexOf('calcList.initFromStorage(');
        assert.ok(acquireIdx > 0,
            'app.js должен импортировать и вызывать acquireAppInstanceLock');
        assert.ok(initIdx > 0,
            'app.js должен вызывать calcList.initFromStorage');
        assert.ok(acquireIdx < initIdx,
            'lock-проверка ОБЯЗАНА быть до initFromStorage — иначе ' +
            'blocked-instance уже прочитал данные расчётов в store');
    });

    it('app.js: при !lock.ok рендерится blocking-screen, дальнейший boot прекращается', async () => {
        const { readFileSync } = await import('node:fs');
        const { dirname, join } = await import('node:path');
        const { fileURLToPath } = await import('node:url');
        const __dirname = dirname(fileURLToPath(import.meta.url));
        const appSrc = readFileSync(
            join(__dirname, '..', '..', '..', 'js', 'app.js'),
            'utf8'
        );

        /* После acquireAppInstanceLock должна быть ветка вида
         *   if (!lock.ok) { renderInstanceBlockedScreen(lock); return; } */
        const acquireIdx = appSrc.indexOf('acquireAppInstanceLock(');
        const initIdx = appSrc.indexOf('calcList.initFromStorage(');
        const between = appSrc.slice(acquireIdx, initIdx);
        assert.ok(/!.+ok|ok\s*===?\s*false/.test(between),
            'между acquire и initFromStorage должна быть ветка `if (!result.ok)`');
        assert.ok(/return\s*[;}]/.test(between),
            'при заблокированном запуске boot должен делать early return');
        assert.ok(between.includes('renderInstanceBlockedScreen')
                || between.includes('InstanceBlockedScreen'),
            'должен вызываться renderInstanceBlockedScreen');
    });
});

/* ============================================================
 * 10. Blocking screen не содержит «Открыть всё равно»
 * ============================================================ */

describe('instanceBlockedScreen — UI-инвариант', () => {
    it('renderInstanceBlockedScreen() не содержит "Открыть всё равно" / bypass / "anyway"', async () => {
        const { readFileSync } = await import('node:fs');
        const { dirname, join } = await import('node:path');
        const { fileURLToPath } = await import('node:url');
        const __dirname = dirname(fileURLToPath(import.meta.url));
        const screenSrc = readFileSync(
            join(__dirname, '..', '..', '..', 'js', 'ui', 'instanceBlockedScreen.js'),
            'utf8'
        );
        /* Проверяем РЕАЛЬНЫЙ исполняемый код, не JSDoc-комментарии — те могут
         * легитимно цитировать запрещённое («Никакой кнопки "Открыть всё равно"»). */
        const code = stripJsComments(screenSrc);

        /* Запрещённые формулировки и кнопки. */
        const forbidden = [
            /Открыть всё равно/i,
            /Запустить всё равно/i,
            /Игнорировать/i,
            /bypass/i,
            /anyway/i,
            /force[\-\s]?open/i,
            /override[\-\s]?lock/i
        ];
        for (const re of forbidden) {
            assert.ok(!re.test(code),
                `blocked-screen НЕ должен содержать "${re}" (по ТЗ §"Запрещено")`);
        }

        /* Положительные: должна быть кнопка «Проверить снова». */
        assert.ok(/Проверить снова/.test(code),
            'blocked-screen должен предлагать кнопку «Проверить снова»');
    });

    it('renderInstanceBlockedScreen не читает и не пишет calc.* данные', async () => {
        const { readFileSync } = await import('node:fs');
        const { dirname, join } = await import('node:path');
        const { fileURLToPath } = await import('node:url');
        const __dirname = dirname(fileURLToPath(import.meta.url));
        const screenSrc = readFileSync(
            join(__dirname, '..', '..', '..', 'js', 'ui', 'instanceBlockedScreen.js'),
            'utf8'
        );
        /* Запреты применяются к ИСПОЛНЯЕМОМУ коду; JSDoc может легитимно
         * упоминать `initFromStorage` в обосновании «почему мы её НЕ зовём». */
        const code = stripJsComments(screenSrc);

        /* Не должен импортировать controllers/state/persist (защита от
         * случайного «прочитал расчёт для отображения превью»). Persistence
         * вообще не нужна для blocked-screen — только акт lock + diag-info. */
        assert.ok(!/from\s+['"].*controllers\//.test(code),
            'blocked-screen НЕ должен импортировать controllers/*');
        assert.ok(!/from\s+['"].*state\/store/.test(code),
            'blocked-screen НЕ должен импортировать state/store');
        assert.ok(!/from\s+['"].*state\/persistence/.test(code),
            'blocked-screen НЕ должен импортировать state/persistence');
        assert.ok(!/calcList\.initFromStorage/.test(code),
            'blocked-screen НЕ должен вызывать initFromStorage');
    });
});

/* ============================================================
 * APP_INSTANCE_LOCK в STORAGE_KEYS whitelist
 * ============================================================ */

describe('STORAGE_KEYS whitelist coverage', () => {
    it('APP_INSTANCE_LOCK присутствует в STORAGE_KEYS', () => {
        assert.equal(STORAGE_KEYS.APP_INSTANCE_LOCK, 'calc.appInstanceLock');
    });

    it('resetAll() очищает APP_INSTANCE_LOCK (через whitelist)', async () => {
        /* Storage whitelist строится через Object.values(STORAGE_KEYS) —
         * добавление нового ключа автоматически охватывается. Регрессия
         * на случай если кто-то откатит resetAll к hardcoded списку. */
        const { resetAll } = await import('../../../js/services/storage.js');
        svc.acquireAppInstanceLock({
            now: () => 1_000_000_000_000,
            uuid: () => 'me'
        });
        assert.ok(globalThis.localStorage.getItem(STORAGE_KEYS.APP_INSTANCE_LOCK),
            'pre: lock в storage');
        resetAll();
        assert.equal(globalThis.localStorage.getItem(STORAGE_KEYS.APP_INSTANCE_LOCK), null,
            'post: lock очищен через resetAll');
    });
});
