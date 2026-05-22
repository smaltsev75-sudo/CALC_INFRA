/**
 * 14.U9 unit-тест: persist раскрытости сводки тарифов overlay в Опроснике.
 *
 * Контракт:
 *   - loadProviderOverlayExpanded — null если не сохранено, иначе boolean.
 *   - saveProviderOverlayExpanded — кастит к boolean.
 *   - STORAGE_KEYS.PROVIDER_OVERLAY_EXPANDED — calc.providerOverlayExpanded.
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

describe('14.U9 STORAGE_KEYS.PROVIDER_OVERLAY_EXPANDED', () => {
    it('зарегистрирован как calc.providerOverlayExpanded', () => {
        assert.equal(STORAGE_KEYS.PROVIDER_OVERLAY_EXPANDED, 'calc.providerOverlayExpanded');
    });
});

describe('14.U9 loadProviderOverlayExpanded', () => {
    it('возвращает null если ничего не сохранено', () => {
        assert.equal(persist.loadProviderOverlayExpanded(), null);
    });

    it('возвращает true/false после save', () => {
        persist.saveProviderOverlayExpanded(true);
        assert.equal(persist.loadProviderOverlayExpanded(), true);
        persist.saveProviderOverlayExpanded(false);
        assert.equal(persist.loadProviderOverlayExpanded(), false);
    });

    it('игнорирует мусор в storage и возвращает null', () => {
        // Запишем не-boolean напрямую — load должен вернуть null
        localStorage.setItem(STORAGE_KEYS.PROVIDER_OVERLAY_EXPANDED, JSON.stringify('garbage'));
        assert.equal(persist.loadProviderOverlayExpanded(), null);
    });
});

describe('14.U9 saveProviderOverlayExpanded', () => {
    it('кастит к boolean (truthy → true, falsy → false)', () => {
        persist.saveProviderOverlayExpanded(1);
        assert.equal(persist.loadProviderOverlayExpanded(), true);
        persist.saveProviderOverlayExpanded(0);
        assert.equal(persist.loadProviderOverlayExpanded(), false);
        persist.saveProviderOverlayExpanded(null);
        assert.equal(persist.loadProviderOverlayExpanded(), false);
    });
});
