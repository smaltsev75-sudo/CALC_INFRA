/**
 * Regression-тест к 12.U31 (Code Review Followup, Subagent E P1):
 * `resetAll()` / `listKeys()` в `services/storage.js` обязаны охватывать
 * ВСЕ ключи из `STORAGE_KEYS`, иначе:
 *   - после «Сбросить всё» в localStorage остаются orphan ключи UI-state
 *     (questionnaire-secs, sort, collapsed-cats и пр.), которые применяются
 *     к новым расчётам;
 *   - `listKeys()` для диагностики возвращает неполный список.
 *
 * До правки whitelist хардкодил 6 ключей + префикс CALC_, пропуская 8 из 16
 * ключей UI-state, добавленных в 12.U1/U25/U27/U28/U29.
 *
 * Правильный паттерн: один источник истины — `Object.values(STORAGE_KEYS)`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STORAGE_KEYS } from '../../../js/utils/constants.js';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const storageSrc = readFileSync(
    join(__dirname, '..', '..', '..', 'js', 'services', 'storage.js'),
    'utf8'
);

import { stripJsComments } from '../../_helpers/source.js';

describe('storage.resetAll/listKeys: whitelist охватывает все STORAGE_KEYS', () => {
    it('storage.js использует Object.values(STORAGE_KEYS) для whitelist', () => {
        const stripped = stripJsComments(storageSrc);
        // Один из двух паттернов: либо явный вызов Object.values(STORAGE_KEYS),
        // либо итерация по массиву ALLOWED_KEYS, построенному из него.
        const usesObjectValues = /Object\.values\(\s*STORAGE_KEYS\s*\)/.test(stripped);
        assert.ok(usesObjectValues,
            'storage.js должен строить whitelist через Object.values(STORAGE_KEYS) ' +
            '— иначе при добавлении нового ключа нужно править resetAll И listKeys ' +
            'отдельно (нарушение DRY, забытые ключи остаются в localStorage).');
    });

    it('каждый STORAGE_KEYS.* фактически очищается resetAll (через мок)', async () => {
        const { resetAll } = await import('../../../js/services/storage.js');
        // Подмена localStorage на in-memory для теста.
        const store = new Map();
        // Заполняем все ключи.
        for (const key of Object.values(STORAGE_KEYS)) {
            // CALC_PREFIX — это префикс, не ключ; синтезируем реальный пример.
            if (key === STORAGE_KEYS.CALC_PREFIX) {
                store.set(STORAGE_KEYS.CALC_PREFIX + 'sample-id', 'data');
            } else {
                store.set(key, 'data');
            }
        }
        // posing as the real localStorage object
        const originalLs = globalThis.localStorage;
        globalThis.localStorage = {
            getItem: k => store.has(k) ? store.get(k) : null,
            setItem: (k, v) => store.set(k, String(v)),
            removeItem: k => store.delete(k),
            key: i => Array.from(store.keys())[i] ?? null,
            get length() { return store.size; }
        };
        try {
            resetAll();
        } finally {
            globalThis.localStorage = originalLs;
        }

        const remaining = Array.from(store.keys());
        assert.deepEqual(remaining, [],
            `после resetAll не очищены ключи: ${JSON.stringify(remaining)}. ` +
            'Каждый ключ из STORAGE_KEYS должен попадать в whitelist.');
    });
});
