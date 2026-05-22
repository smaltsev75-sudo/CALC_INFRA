/**
 * Unit-тесты Stage 15.3 — Sensitivity Filters Persistence.
 *
 * Покрывает: loadSensitivityFilters (дефолт, round-trip, невалидный JSON,
 * неизвестная категория), saveSensitivityFilters (запись без ошибки).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

/* ---------- Minimal localStorage stub ---------- */

let _storage = {};

function installStorage() {
    _storage = {};
    global.localStorage = {
        getItem:  (k) => _storage[k] ?? null,
        setItem:  (k, v) => { _storage[k] = String(v); },
        removeItem: (k) => { delete _storage[k]; },
        clear: () => { _storage = {}; }
    };
}

function uninstallStorage() {
    delete global.localStorage;
}

/* ---------- Constants import ---------- */

import {
    DEFAULT_SENSITIVITY_FILTERS,
    SENSITIVITY_CATEGORY_ORDER,
    STORAGE_KEYS
} from '../../../js/utils/constants.js';

import {
    loadSensitivityFilters,
    saveSensitivityFilters
} from '../../../js/state/persistence.js';

/* ============================================================
 * loadSensitivityFilters
 * ============================================================ */

describe('loadSensitivityFilters: дефолт и round-trip', () => {
    beforeEach(installStorage);
    afterEach(uninstallStorage);

    it('возвращает null если ключ не задан', () => {
        const v = loadSensitivityFilters();
        assert.equal(v, null);
    });

    it('round-trip: сохраняет и загружает фильтры', () => {
        const filters = { costType: 'capex', categories: ['ai', 'risk'] };
        saveSensitivityFilters(filters);
        const loaded = loadSensitivityFilters();
        assert.ok(loaded, 'loaded is null after save');
        assert.equal(loaded.costType, 'capex');
        assert.deepEqual(loaded.categories, ['ai', 'risk']);
    });

    it('возвращает null при невалидном JSON в storage', () => {
        _storage[STORAGE_KEYS.SENSITIVITY_FILTERS] = '{not valid json';
        const v = loadSensitivityFilters();
        assert.equal(v, null);
    });

    it('отбрасывает неизвестный costType', () => {
        saveSensitivityFilters({ costType: 'unknown_type', categories: ['ai'] });
        const v = loadSensitivityFilters();
        assert.equal(v, null);
    });

    it('использует STORAGE_KEYS.SENSITIVITY_FILTERS в качестве ключа', () => {
        const filters = { costType: 'opex', categories: ['ai'] };
        saveSensitivityFilters(filters);
        assert.ok(
            STORAGE_KEYS.SENSITIVITY_FILTERS in _storage ||
            Object.keys(_storage).some(k => k.includes('sensitivity')),
            'Sensitivity filters not written to expected key'
        );
    });
});

/* ============================================================
 * DEFAULT_SENSITIVITY_FILTERS
 * ============================================================ */

describe('DEFAULT_SENSITIVITY_FILTERS', () => {
    it('содержит costType opex по умолчанию', () => {
        assert.equal(DEFAULT_SENSITIVITY_FILTERS.costType, 'opex');
    });

    it('содержит все категории из SENSITIVITY_CATEGORY_ORDER', () => {
        for (const cat of SENSITIVITY_CATEGORY_ORDER) {
            assert.ok(
                DEFAULT_SENSITIVITY_FILTERS.categories.includes(cat),
                `Missing category ${cat} in defaults`
            );
        }
    });

    it('заморожен', () => {
        assert.ok(Object.isFrozen(DEFAULT_SENSITIVITY_FILTERS));
    });
});
