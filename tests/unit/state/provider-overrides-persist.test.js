/**
 * Stage 8.1.2: persist-helpers для provider-price overrides.
 *
 * Контракт:
 *   - STORAGE_KEYS.PROVIDER_OVERLAY_OVERRIDES = 'calc.providerOverlayOverrides'.
 *   - loadProviderOverrides() → плоский объект { providerId: AppliedJSON } |
 *     null (если ключа нет / JSON повреждён / не объект).
 *   - saveProviderOverride(providerId, appliedJson) → boolean. Read-modify-write
 *     над всем объектом. На write-failure (quota) — false.
 *   - clearProviderOverride(providerId) → boolean. Удаление одного ключа.
 *   - resetAll() в storage.js удаляет PROVIDER_OVERLAY_OVERRIDES (whitelist).
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
    version: '2026-Q3-test',
    timestamp: '2026-05-09T12:00:00.000Z',
    source: 'test fixture',
    prices: {
        'cpu-vcpu-shared': { pricePerUnit: 900, vendor: 'SberCloud', priceSource: 'cloud.ru/2026-Q3-test' }
    }
});

describe('Stage 8.1.2 STORAGE_KEYS.PROVIDER_OVERLAY_OVERRIDES', () => {
    it('зарегистрирован как calc.providerOverlayOverrides', () => {
        assert.equal(STORAGE_KEYS.PROVIDER_OVERLAY_OVERRIDES, 'calc.providerOverlayOverrides');
    });
});

describe('Stage 8.1.2 loadProviderOverrides', () => {
    it('возвращает null если ключа нет в storage', () => {
        assert.equal(persist.loadProviderOverrides(), null);
    });

    it('возвращает сохранённый map после save', () => {
        persist.saveProviderOverride('sbercloud', SAMPLE_OVERRIDE);
        const loaded = persist.loadProviderOverrides();
        assert.ok(loaded && typeof loaded === 'object');
        assert.deepEqual(loaded.sbercloud, SAMPLE_OVERRIDE);
    });

    it('игнорирует повреждённый JSON и возвращает null', () => {
        localStorage.setItem(STORAGE_KEYS.PROVIDER_OVERLAY_OVERRIDES, '{ corrupt');
        assert.equal(persist.loadProviderOverrides(), null);
    });

    it('игнорирует не-объект (массив/строка/число) и возвращает null', () => {
        localStorage.setItem(STORAGE_KEYS.PROVIDER_OVERLAY_OVERRIDES, JSON.stringify(['array']));
        assert.equal(persist.loadProviderOverrides(), null);
        localStorage.setItem(STORAGE_KEYS.PROVIDER_OVERLAY_OVERRIDES, JSON.stringify('string'));
        assert.equal(persist.loadProviderOverrides(), null);
        localStorage.setItem(STORAGE_KEYS.PROVIDER_OVERLAY_OVERRIDES, JSON.stringify(42));
        assert.equal(persist.loadProviderOverrides(), null);
    });
});

describe('Stage 8.1.2 saveProviderOverride', () => {
    it('round-trip save+load для одного провайдера', () => {
        const ok = persist.saveProviderOverride('sbercloud', SAMPLE_OVERRIDE);
        assert.equal(ok, true);
        const loaded = persist.loadProviderOverrides();
        assert.deepEqual(loaded, { sbercloud: SAMPLE_OVERRIDE });
    });

    it('добавляет нового провайдера, не теряя предыдущего', () => {
        const yandexOverride = { ...SAMPLE_OVERRIDE, providerId: 'yandex' };
        persist.saveProviderOverride('sbercloud', SAMPLE_OVERRIDE);
        persist.saveProviderOverride('yandex', yandexOverride);
        const loaded = persist.loadProviderOverrides();
        assert.deepEqual(Object.keys(loaded).sort(), ['sbercloud', 'yandex']);
        assert.deepEqual(loaded.sbercloud, SAMPLE_OVERRIDE);
        assert.deepEqual(loaded.yandex, yandexOverride);
    });

    it('перезаписывает существующий override того же провайдера', () => {
        persist.saveProviderOverride('sbercloud', SAMPLE_OVERRIDE);
        const newer = { ...SAMPLE_OVERRIDE, version: '2026-Q4-test' };
        persist.saveProviderOverride('sbercloud', newer);
        const loaded = persist.loadProviderOverrides();
        assert.equal(loaded.sbercloud.version, '2026-Q4-test');
    });

    it('reject-ит пустой/невалидный providerId без записи', () => {
        assert.equal(persist.saveProviderOverride('', SAMPLE_OVERRIDE), false);
        assert.equal(persist.saveProviderOverride(null, SAMPLE_OVERRIDE), false);
        assert.equal(persist.saveProviderOverride(undefined, SAMPLE_OVERRIDE), false);
        assert.equal(localStorage.getItem(STORAGE_KEYS.PROVIDER_OVERLAY_OVERRIDES), null);
    });
});

describe('Stage 8.1.2 clearProviderOverride', () => {
    it('удаляет один override, остальные сохраняются', () => {
        const yandexOverride = { ...SAMPLE_OVERRIDE, providerId: 'yandex' };
        persist.saveProviderOverride('sbercloud', SAMPLE_OVERRIDE);
        persist.saveProviderOverride('yandex', yandexOverride);
        const ok = persist.clearProviderOverride('sbercloud');
        assert.equal(ok, true);
        const loaded = persist.loadProviderOverrides();
        assert.deepEqual(Object.keys(loaded), ['yandex']);
    });

    it('clear на отсутствующего провайдера — no-op возврат true (idempotent)', () => {
        persist.saveProviderOverride('sbercloud', SAMPLE_OVERRIDE);
        const ok = persist.clearProviderOverride('nonexistent');
        assert.equal(ok, true);
        const loaded = persist.loadProviderOverrides();
        assert.deepEqual(loaded, { sbercloud: SAMPLE_OVERRIDE });
    });

    it('clear когда ключа в storage вообще нет — no-op возврат true', () => {
        const ok = persist.clearProviderOverride('sbercloud');
        assert.equal(ok, true);
    });
});
