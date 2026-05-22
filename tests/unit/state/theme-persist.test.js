/**
 * 12.U33: regression-тесты на тему приложения dark/light.
 *
 * Контракт:
 *   - STORAGE_KEYS.THEME = 'calc.theme', добавлен в whitelist.
 *   - THEME_IDS = ['dark', 'light'], DEFAULT_THEME = 'dark'.
 *   - state.ui.theme: 'dark' | 'light' (init = DEFAULT_THEME).
 *   - persistence: loadTheme() возвращает null при отсутствии или невалидном значении;
 *     saveTheme(invalid) → false.
 *   - controller setTheme/toggleTheme валидирует значение.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

describe('Theme: STORAGE_KEYS + THEME_IDS + DEFAULT_THEME (12.U33)', () => {
    it('STORAGE_KEYS.THEME = "calc.theme"', async () => {
        const { STORAGE_KEYS } = await import('../../../js/utils/constants.js');
        assert.equal(STORAGE_KEYS.THEME, 'calc.theme');
    });

    it('THEME_IDS = ["dark", "light"]', async () => {
        const { THEME_IDS } = await import('../../../js/utils/constants.js');
        assert.deepEqual([...THEME_IDS], ['dark', 'light']);
    });

    it('DEFAULT_THEME = "dark" (исторический дефолт, обратная совместимость)', async () => {
        const { DEFAULT_THEME } = await import('../../../js/utils/constants.js');
        assert.equal(DEFAULT_THEME, 'dark');
    });
});

describe('Theme persistence: loadTheme/saveTheme round-trip (12.U33)', () => {
    let originalLs;
    before(() => {
        originalLs = globalThis.localStorage;
        const store = new Map();
        globalThis.localStorage = {
            getItem: k => store.has(k) ? store.get(k) : null,
            setItem: (k, v) => store.set(k, String(v)),
            removeItem: k => store.delete(k),
            key: i => Array.from(store.keys())[i] ?? null,
            get length() { return store.size; }
        };
    });
    after(() => { globalThis.localStorage = originalLs; });

    it('пустой storage → loadTheme() === null', async () => {
        const { loadTheme } = await import('../../../js/state/persistence.js');
        // Очистим storage
        globalThis.localStorage.removeItem('calc.theme');
        assert.equal(loadTheme(), null);
    });

    it('saveTheme("light") → loadTheme() === "light"', async () => {
        const { loadTheme, saveTheme } = await import('../../../js/state/persistence.js');
        const ok = saveTheme('light');
        assert.equal(ok, true);
        assert.equal(loadTheme(), 'light');
    });

    it('saveTheme("dark") round-trip', async () => {
        const { loadTheme, saveTheme } = await import('../../../js/state/persistence.js');
        saveTheme('dark');
        assert.equal(loadTheme(), 'dark');
    });

    it('saveTheme("invalid") → false (защита от подделки)', async () => {
        const { saveTheme } = await import('../../../js/state/persistence.js');
        assert.equal(saveTheme('invalid'), false);
        assert.equal(saveTheme(null), false);
        assert.equal(saveTheme(123), false);
    });

    it('loadTheme() с битым значением в storage → null', async () => {
        const { loadTheme } = await import('../../../js/state/persistence.js');
        globalThis.localStorage.setItem('calc.theme', '"hacker"');
        assert.equal(loadTheme(), null,
            'значение не из THEME_IDS должно отвергаться (защита от подделки)');
    });
});

describe('CSS: [data-theme="light"] блок существует с критическими переменными (12.U33)', () => {
    it('base.css содержит [data-theme="light"] правило с --bg-main и --text', async () => {
        const { readFileSync } = await import('node:fs');
        const { dirname, join } = await import('node:path');
        const { fileURLToPath } = await import('node:url');
        const __dirname = dirname(fileURLToPath(import.meta.url));
        const baseCss = readFileSync(
            join(__dirname, '..', '..', '..', 'css', 'base.css'), 'utf8'
        );
        // Strip comments чтобы не путаться с упоминанием в комменте
        const stripped = baseCss.replace(/\/\*[\s\S]*?\*\//g, '');
        const m = stripped.match(/\[data-theme=["']light["']\]\s*\{([^}]+)\}/);
        assert.ok(m, '[data-theme="light"] правило обязательно');
        const body = m[1];
        // Минимально нужные переменные для рабочей светлой темы
        for (const v of ['--bg-main', '--bg-card', '--text', '--text-muted', '--text-dim', '--accent', '--border']) {
            assert.match(body, new RegExp(v + '\\s*:'),
                `${v} обязателен в светлой теме`);
        }
    });
});
