/**
 * TDD для RISK-1 (HIGH, состязательное ревью 2026-06-13): durable
 * pre-migration backup.
 *
 * Проблема: при миграции активного/открываемого расчёта commitMigratedCalc
 * перезаписывает calc.<id> мигрированной версией (calcListController.js).
 * Исходный (до-миграционный) JSON исчезал безвозвратно — логически-неверная,
 * но не падающая миграция = необратимая потеря данных при обновлении.
 *
 * Фикс: перед commit'ом мигрированной версии пишем durable снимок оригинала
 * под ключ STORAGE_KEYS.CALC_BACKUP_PREFIX + id. GATE (data-safety review
 * 2026-06-13, DATA-SAFETY-1): backup — ОБЯЗАТЕЛЬНАЯ предпосылка перезаписи,
 * НЕ best-effort. Нельзя полагаться на «quota завалит и commit»: commit
 * перезаписывает существующий calc.<id> payload'ом ≤ размера (миграции удаляют
 * поля) и проходит под quota, тогда как backup нового бóльшего ключа падает —
 * оригинал терялся бы без копии. Если backup не записан → openCalc/initFromStorage
 * НЕ перезаписывают оригинал и не открывают calc.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from '../../integration/storage-mock.js';
import { __resetStorageMode, resetAll } from '../../../js/services/storage.js';
import {
    backupCalcBeforeMigration,
    loadCalcBackup,
    removeCalcBackup,
    saveCalc,
    loadCalc,
    removeCalc
} from '../../../js/state/persistence.js';
import { STORAGE_KEYS } from '../../../js/utils/constants.js';

function makeOriginal(id, version) {
    return {
        id,
        name: 'Original',
        schemaVersion: version,
        settings: { phaseDurationMonths: 6 },
        answers: { registered_users_total: 1000 },
        dictionaries: { items: [], questions: [] }
    };
}

describe('persistence: pre-migration backup helpers (RISK-1)', () => {
    beforeEach(() => {
        installLocalStorage();
        __resetStorageMode();
    });

    it('backupCalcBeforeMigration пишет восстановимый снимок оригинала', () => {
        const original = makeOriginal('c1', 12);
        const ok = backupCalcBeforeMigration('c1', original, 12);
        assert.equal(ok, true);

        const bak = loadCalcBackup('c1');
        assert.ok(bak, 'backup должен существовать');
        assert.equal(bak.fromVersion, 12);
        assert.deepEqual(bak.original, original, 'оригинал восстановим побайтно');
        assert.equal(typeof bak.backedUpAt, 'string');
    });

    it('идемпотентность: повторный backup с той же fromVersion не перезаписывает', () => {
        backupCalcBeforeMigration('c1', makeOriginal('c1', 12), 12);
        const first = loadCalcBackup('c1');
        const ok2 = backupCalcBeforeMigration('c1', makeOriginal('c1', 12), 12);
        assert.equal(ok2, true);
        const second = loadCalcBackup('c1');
        assert.equal(second.backedUpAt, first.backedUpAt, 'backedUpAt не изменился (no re-write)');
    });

    it('новая fromVersion перезаписывает backup (всегда последняя миграция)', () => {
        backupCalcBeforeMigration('c1', makeOriginal('c1', 12), 12);
        backupCalcBeforeMigration('c1', makeOriginal('c1', 18), 18);
        const bak = loadCalcBackup('c1');
        assert.equal(bak.fromVersion, 18);
        assert.equal(bak.original.schemaVersion, 18);
    });

    it('невалидный input — no-op (false), без throw', () => {
        assert.equal(backupCalcBeforeMigration('', makeOriginal('c1', 12), 12), false);
        assert.equal(backupCalcBeforeMigration('c1', null, 12), false);
        assert.equal(backupCalcBeforeMigration('c1', 'bad', 12), false);
    });

    it('removeCalcBackup очищает снимок (idempotent)', () => {
        backupCalcBeforeMigration('c1', makeOriginal('c1', 12), 12);
        assert.ok(loadCalcBackup('c1'));
        removeCalcBackup('c1');
        assert.equal(loadCalcBackup('c1'), null);
        removeCalcBackup('c1'); // повторно — без throw
    });

    it('removeCalc также удаляет pre-migration backup (нет orphan)', () => {
        saveCalc(makeOriginal('c2', 20));
        backupCalcBeforeMigration('c2', makeOriginal('c2', 12), 12);
        assert.ok(loadCalc('c2'));
        assert.ok(loadCalcBackup('c2'));
        removeCalc('c2');
        assert.equal(loadCalc('c2'), null);
        assert.equal(loadCalcBackup('c2'), null, 'backup удалён вместе с calc');
    });

    it('resetAll зачищает backup-ключи (покрыты isAppKey через calc.-префикс)', () => {
        backupCalcBeforeMigration('c1', makeOriginal('c1', 12), 12);
        const key = STORAGE_KEYS.CALC_BACKUP_PREFIX + 'c1';
        assert.equal(localStorage.getItem(key) !== null, true);
        resetAll();
        assert.equal(localStorage.getItem(key), null, 'resetAll должен зачистить backup');
    });
});

describe('openCalc: durable pre-migration backup end-to-end (RISK-1)', () => {
    beforeEach(() => {
        installLocalStorage();
        __resetStorageMode();
    });

    it('миграция legacy-расчёта оставляет восстановимый оригинал', async () => {
        const { openCalc } = await import('../../../js/controllers/calcListController.js');
        const { store } = await import('../../../js/state/store.js');
        const { LATEST_SCHEMA_VERSION } = await import('../../../js/state/migrations.js');

        const id = 'legacy-risk1';
        const legacy = {
            id,
            name: 'Legacy v12',
            schemaVersion: 12,
            createdAt: '2026-01-15T00:00:00.000Z',
            settings: { phaseDurationMonths: 6 },
            answers: { registered_users_total: 1000 },
            dictionaries: { items: [], questions: [] }
        };
        saveCalc(legacy);

        const opened = openCalc(id);
        assert.ok(opened, 'openCalc вернул calc');
        assert.equal(opened.schemaVersion, LATEST_SCHEMA_VERSION, 'calc мигрирован до LATEST');
        assert.equal(store.getState().activeCalc.schemaVersion, LATEST_SCHEMA_VERSION);

        // Ключевой инвариант RISK-1: оригинал до-миграционный JSON восстановим.
        const bak = loadCalcBackup(id);
        assert.ok(bak, 'pre-migration backup создан');
        assert.equal(bak.original.schemaVersion, 12, 'сохранён ИСХОДНЫЙ schemaVersion');
        assert.equal(bak.fromVersion, 12);
        assert.equal(bak.original.name, 'Legacy v12');
    });
});

describe('openCalc: GATE — сбой backup НЕ перезаписывает оригинал (DATA-SAFETY-1)', () => {
    it('quota на backup-ключе (новый, больше) при проходящей перезаписи calc.<id> (≤ размера) → оригинал цел', async () => {
        /* Storage, который бросает QuotaExceededError ТОЛЬКО на запись нового
         * backup-ключа (calc.premigrate.*), но пропускает перезапись
         * существующего calc.<id> — точное окно DATA-SAFETY-1 (overwrite
         * списывает дельту, проходит под quota; новый ключ — нет). */
        class GateFailStorage {
            constructor() { this.data = new Map(); }
            get length() { return this.data.size; }
            setItem(k, v) {
                if (String(k).startsWith('calc.premigrate.')) {
                    const e = new Error('QuotaExceededError');
                    e.name = 'QuotaExceededError';
                    throw e;
                }
                this.data.set(String(k), String(v));
            }
            getItem(k) { return this.data.has(k) ? this.data.get(k) : null; }
            removeItem(k) { this.data.delete(k); }
            key(i) { return Array.from(this.data.keys())[i] ?? null; }
            clear() { this.data.clear(); }
        }
        Object.defineProperty(globalThis, 'localStorage', {
            value: new GateFailStorage(), configurable: true, writable: true
        });
        __resetStorageMode();

        const { openCalc } = await import('../../../js/controllers/calcListController.js');
        const { store } = await import('../../../js/state/store.js');

        const id = 'legacy-gate';
        const legacy = {
            id, name: 'Legacy gate', schemaVersion: 12,
            createdAt: '2026-01-15T00:00:00.000Z',
            settings: { phaseDurationMonths: 6 },
            answers: {},
            dictionaries: { items: [], questions: [] }
        };
        saveCalc(legacy); // calc.<id> — не backup-ключ → запись проходит

        const opened = openCalc(id);
        assert.equal(opened, null, 'openCalc прерван при невозможности backup');
        assert.equal(store.getState().persistStatus, 'error', 'сигнал ошибки поднят');

        // ГЛАВНОЕ: оригинал в storage НЕ перезаписан мигрированной версией.
        const stillStored = loadCalc(id);
        assert.ok(stillStored, 'оригинальный calc.<id> цел');
        assert.equal(stillStored.schemaVersion, 12, 'исходный schemaVersion НЕ затёрт миграцией');
        assert.equal(loadCalcBackup(id), null, 'backup не создан (quota) — это и есть причина abort');
    });
});
