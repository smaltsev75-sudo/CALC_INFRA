/**
 * Stage 9.5: persist для истории override'ов.
 *
 * STORAGE_KEYS.PROVIDER_OVERRIDE_HISTORY = 'calc.providerOverrideHistory'.
 * Структура: { [providerId]: Array<{ appliedJSON, appliedAt }> } — newest first,
 * limit 3.
 *
 * API:
 *   - loadProviderOverrideHistory(providerId) → Array | []
 *   - pushProviderOverrideHistory(providerId, snapshot) → boolean
 *     (добавляет в начало, ограничивает до HISTORY_LIMIT=3)
 *   - clearProviderOverrideHistory(providerId) → boolean
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from '../../integration/storage-mock.js';

let persist;
let STORAGE_KEYS;

before(async () => {
    installLocalStorage();
    persist = await import('../../../js/state/persistence.js');
    ({ STORAGE_KEYS } = await import('../../../js/utils/constants.js'));
});

beforeEach(() => installLocalStorage());

const SAMPLE_OVERRIDE = Object.freeze({
    schemaVersion: 1,
    providerId: 'sbercloud',
    version: '2026-Q1-test',
    timestamp: '2026-01-01T12:00:00.000Z',
    source: 'test',
    prices: { 'cpu-vcpu-shared': { pricePerUnit: 800, vendor: 'X', priceSource: 'y' } }
});

function snap(version) {
    return {
        appliedJSON: { ...SAMPLE_OVERRIDE, version },
        appliedAt: '2026-05-09T12:00:00.000Z'
    };
}

describe('Stage 9.5 STORAGE_KEYS.PROVIDER_OVERRIDE_HISTORY', () => {
    it('зарегистрирован как calc.providerOverrideHistory', () => {
        assert.equal(STORAGE_KEYS.PROVIDER_OVERRIDE_HISTORY, 'calc.providerOverrideHistory');
    });
});

describe('Stage 9.5 loadProviderOverrideHistory', () => {
    it('возвращает [] если ключа нет', () => {
        assert.deepEqual(persist.loadProviderOverrideHistory('sbercloud'), []);
    });

    it('возвращает [] для unknown providerId, даже если у других есть история', () => {
        persist.pushProviderOverrideHistory('sbercloud', snap('2026-Q1'));
        assert.deepEqual(persist.loadProviderOverrideHistory('yandex'), []);
    });

    it('игнорирует corrupt JSON и возвращает []', () => {
        localStorage.setItem(STORAGE_KEYS.PROVIDER_OVERRIDE_HISTORY, '{ corrupt');
        assert.deepEqual(persist.loadProviderOverrideHistory('sbercloud'), []);
    });

    it('игнорирует не-объект (массив на верхнем уровне) → []', () => {
        localStorage.setItem(STORAGE_KEYS.PROVIDER_OVERRIDE_HISTORY, JSON.stringify(['oops']));
        assert.deepEqual(persist.loadProviderOverrideHistory('sbercloud'), []);
    });

    it('игнорирует не-массив значения для provider ключа → []', () => {
        localStorage.setItem(STORAGE_KEYS.PROVIDER_OVERRIDE_HISTORY, JSON.stringify({ sbercloud: 'not-array' }));
        assert.deepEqual(persist.loadProviderOverrideHistory('sbercloud'), []);
    });
});

describe('Stage 9.5 pushProviderOverrideHistory', () => {
    it('первый push: history = [snap]', () => {
        persist.pushProviderOverrideHistory('sbercloud', snap('2026-Q1'));
        const h = persist.loadProviderOverrideHistory('sbercloud');
        assert.equal(h.length, 1);
        assert.equal(h[0].appliedJSON.version, '2026-Q1');
    });

    it('newest first: каждый новый push идёт в начало', () => {
        persist.pushProviderOverrideHistory('sbercloud', snap('2026-Q1'));
        persist.pushProviderOverrideHistory('sbercloud', snap('2026-Q2'));
        persist.pushProviderOverrideHistory('sbercloud', snap('2026-Q3'));
        const h = persist.loadProviderOverrideHistory('sbercloud');
        assert.deepEqual(h.map(s => s.appliedJSON.version), ['2026-Q3', '2026-Q2', '2026-Q1']);
    });

    it('лимит 3: 4-й push выкидывает самую старую запись', () => {
        for (const v of ['2025-Q4', '2026-Q1', '2026-Q2', '2026-Q3']) {
            persist.pushProviderOverrideHistory('sbercloud', snap(v));
        }
        const h = persist.loadProviderOverrideHistory('sbercloud');
        assert.equal(h.length, 3);
        assert.deepEqual(h.map(s => s.appliedJSON.version), ['2026-Q3', '2026-Q2', '2026-Q1']);
    });

    it('per-provider isolation: sbercloud history не виден yandex', () => {
        persist.pushProviderOverrideHistory('sbercloud', snap('2026-Q1'));
        persist.pushProviderOverrideHistory('yandex', snap('2026-Q1-yandex'));
        const sber = persist.loadProviderOverrideHistory('sbercloud');
        const yandex = persist.loadProviderOverrideHistory('yandex');
        assert.equal(sber.length, 1);
        assert.equal(yandex.length, 1);
        assert.equal(sber[0].appliedJSON.version, '2026-Q1');
        assert.equal(yandex[0].appliedJSON.version, '2026-Q1-yandex');
    });

    it('reject пустой/невалидный providerId без записи', () => {
        assert.equal(persist.pushProviderOverrideHistory('', snap('x')), false);
        assert.equal(persist.pushProviderOverrideHistory(null, snap('x')), false);
        assert.equal(localStorage.getItem(STORAGE_KEYS.PROVIDER_OVERRIDE_HISTORY), null);
    });

    it('reject null/undefined snapshot без записи', () => {
        assert.equal(persist.pushProviderOverrideHistory('sbercloud', null), false);
        assert.equal(persist.pushProviderOverrideHistory('sbercloud', undefined), false);
    });
});

describe('Stage 9.5 clearProviderOverrideHistory', () => {
    it('удаляет историю одного провайдера, остальные сохраняются', () => {
        persist.pushProviderOverrideHistory('sbercloud', snap('s1'));
        persist.pushProviderOverrideHistory('yandex', snap('y1'));
        const ok = persist.clearProviderOverrideHistory('sbercloud');
        assert.equal(ok, true);
        assert.deepEqual(persist.loadProviderOverrideHistory('sbercloud'), []);
        assert.equal(persist.loadProviderOverrideHistory('yandex').length, 1);
    });

    it('idempotent: clear несуществующего → true', () => {
        assert.equal(persist.clearProviderOverrideHistory('nonexistent'), true);
    });
});
