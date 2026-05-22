/**
 * 12.U33: regression-тесты на calcController.setTheme/toggleTheme.
 *
 * Контракт:
 *   - setTheme валидирует: невалидное значение → no-op (state не меняется).
 *   - toggleTheme: dark → light, light → dark.
 *   - Изменение state.ui.theme идёт через store.setUi (не прямой mutation).
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/* Один импорт singleton'а store + calcController, beforeEach сбрасывает тему. */
let store, calc;
before(async () => {
    // Минимальный mock-localStorage до импорта (storage.js делает probe).
    const m = new Map();
    globalThis.localStorage = {
        getItem: k => m.has(k) ? m.get(k) : null,
        setItem: (k, v) => m.set(k, String(v)),
        removeItem: k => m.delete(k),
        key: i => Array.from(m.keys())[i] ?? null,
        get length() { return m.size; }
    };
    const storeModule = await import('../../../js/state/store.js');
    const calcModule  = await import('../../../js/controllers/calcController.js');
    store = storeModule.store;
    calc  = calcModule;
});

describe('calcController: setTheme/toggleTheme (12.U33)', () => {
    beforeEach(() => {
        // Сбрасываем тему в dark перед каждым тестом — store singleton.
        calc.setTheme('dark');
    });

    it('initial state.ui.theme = "dark" после reset', () => {
        assert.equal(store.getState().ui.theme, 'dark');
    });

    it('setTheme("light") меняет state.ui.theme', () => {
        calc.setTheme('light');
        assert.equal(store.getState().ui.theme, 'light');
    });

    it('setTheme("dark") меняет state.ui.theme', () => {
        calc.setTheme('light');
        calc.setTheme('dark');
        assert.equal(store.getState().ui.theme, 'dark');
    });

    it('setTheme(invalid) — no-op, state не меняется', () => {
        const before = store.getState().ui.theme;
        calc.setTheme('hacker');
        calc.setTheme(null);
        calc.setTheme(undefined);
        calc.setTheme(123);
        assert.equal(store.getState().ui.theme, before);
    });

    it('toggleTheme: dark → light → dark (полный цикл)', () => {
        assert.equal(store.getState().ui.theme, 'dark');
        calc.toggleTheme();
        assert.equal(store.getState().ui.theme, 'light');
        calc.toggleTheme();
        assert.equal(store.getState().ui.theme, 'dark');
    });
});

describe('header.js: theme-toggle button (12.U33)', () => {
    it('исходник содержит renderThemeToggle с aria-label и aria-pressed', async () => {
        const { readFileSync } = await import('node:fs');
        const { dirname, join } = await import('node:path');
        const { fileURLToPath } = await import('node:url');
        const __dirname = dirname(fileURLToPath(import.meta.url));
        const src = readFileSync(
            join(__dirname, '..', '..', '..', 'js', 'ui', 'header.js'), 'utf8'
        );
        const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
        // Кнопка переключения темы должна быть
        assert.match(stripped, /renderThemeToggle/, 'функция renderThemeToggle обязательна');
        // aria-label обязателен (screen-reader)
        assert.match(stripped, /['"]aria-label['"]/, 'aria-label на кнопке темы обязателен');
        // aria-pressed (toggle-button pattern)
        assert.match(stripped, /['"]aria-pressed['"]/, 'aria-pressed на toggle-button обязателен');
        // ctx.toggleTheme подключён
        assert.match(stripped, /ctx\.toggleTheme\s*\(\s*\)/);
    });

    it('icons.js регистрирует sun и moon (Lucide)', async () => {
        const { readFileSync } = await import('node:fs');
        const { dirname, join } = await import('node:path');
        const { fileURLToPath } = await import('node:url');
        const __dirname = dirname(fileURLToPath(import.meta.url));
        const src = readFileSync(
            join(__dirname, '..', '..', '..', 'js', 'ui', 'icons.js'), 'utf8'
        );
        const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
        assert.match(stripped, /^\s*sun\s*:/m, 'icons.js должен регистрировать "sun"');
        assert.match(stripped, /^\s*moon\s*:/m, 'icons.js должен регистрировать "moon"');
    });
});
