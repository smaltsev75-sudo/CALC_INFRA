/**
 * Интеграционный тест Этапа 11.2.5.
 *
 * Сценарий: resetAll() очищает все ключи приложения, включая
 * STORAGE_KEYS.PDF_HINT_SHOWN — флаг показа разовой подсказки про PDF.
 * Также покрываем listKeys() — должен возвращать тот же набор whitelist'а.
 *
 * Бонусом проверяем, что resetAll НЕ трогает чужие ключи (без префикса calc.).
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from './storage-mock.js';

// Установить mock localStorage ДО импорта модулей, использующих storage.
installLocalStorage();

const storage = await import('../../js/services/storage.js');
const { STORAGE_KEYS } = await import('../../js/utils/constants.js');

beforeEach(() => {
    installLocalStorage();
});

describe('Этап 11.2.5: resetAll очищает PDF_HINT_SHOWN', () => {
    it('resetAll() удаляет ключ STORAGE_KEYS.PDF_HINT_SHOWN', () => {
        // Подготавливаем: ставим флаг подсказки и расчёт.
        localStorage.setItem(STORAGE_KEYS.PDF_HINT_SHOWN, '1');
        localStorage.setItem(STORAGE_KEYS.CALC_LIST, JSON.stringify([]));
        assert.equal(localStorage.getItem(STORAGE_KEYS.PDF_HINT_SHOWN), '1');

        storage.resetAll();

        assert.equal(localStorage.getItem(STORAGE_KEYS.PDF_HINT_SHOWN), null,
            'PDF_HINT_SHOWN должен быть удалён после resetAll()');
        assert.equal(localStorage.getItem(STORAGE_KEYS.CALC_LIST), null,
            'CALC_LIST тоже должен быть удалён (sanity-check)');
    });

    it('resetAll() очищает все известные ключи приложения', () => {
        localStorage.setItem(STORAGE_KEYS.CALC_LIST, '[]');
        localStorage.setItem(STORAGE_KEYS.DEFAULT_DICTIONARY, '{}');
        localStorage.setItem(STORAGE_KEYS.ACTIVE_CALC, 'abc');
        localStorage.setItem(STORAGE_KEYS.ACTIVE_TAB, 'questionnaire');
        localStorage.setItem(STORAGE_KEYS.PDF_HINT_SHOWN, '1');
        localStorage.setItem(STORAGE_KEYS.SCHEMA_VERSION, '2');
        localStorage.setItem(STORAGE_KEYS.CALC_PREFIX + 'id-123', '{}');

        storage.resetAll();

        for (const key of Object.values(STORAGE_KEYS)) {
            // CALC_PREFIX — это префикс, а не самостоятельный ключ; пропускаем.
            if (key === STORAGE_KEYS.CALC_PREFIX) continue;
            assert.equal(localStorage.getItem(key), null,
                `Ключ ${key} должен быть удалён после resetAll()`);
        }
        assert.equal(localStorage.getItem(STORAGE_KEYS.CALC_PREFIX + 'id-123'), null,
            'Ключи с префиксом calc. должны быть удалены');
    });

    it('resetAll() НЕ трогает посторонние ключи без префикса calc.', () => {
        localStorage.setItem('foreign.key', 'keep-me');
        localStorage.setItem(STORAGE_KEYS.PDF_HINT_SHOWN, '1');

        storage.resetAll();

        assert.equal(localStorage.getItem('foreign.key'), 'keep-me',
            'Чужие ключи должны оставаться нетронутыми');
        assert.equal(localStorage.getItem(STORAGE_KEYS.PDF_HINT_SHOWN), null);
    });

    it('listKeys() включает PDF_HINT_SHOWN, если он установлен', () => {
        localStorage.setItem(STORAGE_KEYS.PDF_HINT_SHOWN, '1');
        localStorage.setItem('foreign.key', 'ignored');

        const keys = storage.listKeys();
        assert.ok(keys.includes(STORAGE_KEYS.PDF_HINT_SHOWN),
            'listKeys() должен возвращать PDF_HINT_SHOWN');
        assert.ok(!keys.includes('foreign.key'),
            'listKeys() не должен возвращать чужие ключи');
    });
});
