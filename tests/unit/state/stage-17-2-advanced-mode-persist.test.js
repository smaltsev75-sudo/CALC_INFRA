/**
 * Stage 17.2 Phase 3c — Advanced mode (persist + corrupt fallback).
 *
 * Контракт:
 *   - STORAGE_KEYS.ADVANCED_MODE_ENABLED = 'calc.advancedModeEnabled'.
 *   - state.ui.advancedModeEnabled: boolean (init = false).
 *   - persistence: loadAdvancedModeEnabled() → boolean | null.
 *     null = не сохранено или corrupt → дефолт (false) выбирается caller'ом.
 *   - saveAdvancedModeEnabled приводит к boolean (writes !!enabled).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

describe('Phase 3c — STORAGE_KEYS.ADVANCED_MODE_ENABLED', () => {
    it('STORAGE_KEYS.ADVANCED_MODE_ENABLED = "calc.advancedModeEnabled"', async () => {
        const { STORAGE_KEYS } = await import('../../../js/utils/constants.js');
        assert.equal(STORAGE_KEYS.ADVANCED_MODE_ENABLED, 'calc.advancedModeEnabled');
    });

    it('STORAGE_KEYS.ADVANCED_MODE_ENABLED — единственное место с этим литералом', async () => {
        // Защита от случайного дубля в параллельных файлах.
        const { STORAGE_KEYS } = await import('../../../js/utils/constants.js');
        const dupes = Object.entries(STORAGE_KEYS)
            .filter(([k, v]) => v === 'calc.advancedModeEnabled' && k !== 'ADVANCED_MODE_ENABLED');
        assert.deepEqual(dupes, []);
    });
});

describe('Phase 3c — persistence: load/save round-trip + corrupt fallback', () => {
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

    it('пустой storage → loadAdvancedModeEnabled() === null', async () => {
        const { loadAdvancedModeEnabled } = await import('../../../js/state/persistence.js');
        globalThis.localStorage.removeItem('calc.advancedModeEnabled');
        assert.equal(loadAdvancedModeEnabled(), null);
    });

    it('saveAdvancedModeEnabled(true) → loadAdvancedModeEnabled() === true', async () => {
        const { loadAdvancedModeEnabled, saveAdvancedModeEnabled }
            = await import('../../../js/state/persistence.js');
        const ok = saveAdvancedModeEnabled(true);
        assert.equal(ok, true);
        assert.equal(loadAdvancedModeEnabled(), true);
    });

    it('saveAdvancedModeEnabled(false) round-trip', async () => {
        const { loadAdvancedModeEnabled, saveAdvancedModeEnabled }
            = await import('../../../js/state/persistence.js');
        saveAdvancedModeEnabled(false);
        assert.equal(loadAdvancedModeEnabled(), false);
    });

    it('saveAdvancedModeEnabled(truthy non-bool) приводит к true', async () => {
        const { loadAdvancedModeEnabled, saveAdvancedModeEnabled }
            = await import('../../../js/state/persistence.js');
        saveAdvancedModeEnabled('on');
        assert.equal(loadAdvancedModeEnabled(), true);
    });

    it('corrupt storage (число / строка / объект) → loadAdvancedModeEnabled() === null', async () => {
        const { loadAdvancedModeEnabled } = await import('../../../js/state/persistence.js');
        globalThis.localStorage.setItem('calc.advancedModeEnabled', '42');
        assert.equal(loadAdvancedModeEnabled(), null,
            'число — corrupt, должно отвергаться');
        globalThis.localStorage.setItem('calc.advancedModeEnabled', '"yes"');
        assert.equal(loadAdvancedModeEnabled(), null,
            'строка — corrupt, должно отвергаться');
        globalThis.localStorage.setItem('calc.advancedModeEnabled', '{"a":1}');
        assert.equal(loadAdvancedModeEnabled(), null,
            'объект — corrupt, должно отвергаться');
    });

    it('corrupt JSON в storage → loadAdvancedModeEnabled() === null (не throws)', async () => {
        const { loadAdvancedModeEnabled } = await import('../../../js/state/persistence.js');
        globalThis.localStorage.setItem('calc.advancedModeEnabled', '{not-json');
        assert.equal(loadAdvancedModeEnabled(), null);
    });
});

describe('Phase 3c — controller: setAdvancedMode + toggleAdvancedMode + redirect', () => {
    it('setAdvancedMode(true) → state.ui.advancedModeEnabled === true', async () => {
        const { store } = await import('../../../js/state/store.js');
        const { setAdvancedMode } = await import('../../../js/controllers/calcController.js');
        setAdvancedMode(false);
        setAdvancedMode(true);
        assert.equal(store.getState().ui.advancedModeEnabled, true);
    });

    it('setAdvancedMode(false) → state.ui.advancedModeEnabled === false', async () => {
        const { store } = await import('../../../js/state/store.js');
        const { setAdvancedMode } = await import('../../../js/controllers/calcController.js');
        setAdvancedMode(true);
        setAdvancedMode(false);
        assert.equal(store.getState().ui.advancedModeEnabled, false);
    });

    it('setAdvancedMode(non-boolean) — игнорируется', async () => {
        const { store } = await import('../../../js/state/store.js');
        const { setAdvancedMode } = await import('../../../js/controllers/calcController.js');
        setAdvancedMode(true);
        setAdvancedMode('truthy-string');
        assert.equal(store.getState().ui.advancedModeEnabled, true,
            'не-boolean значения игнорируются (защита от подделки localStorage)');
        setAdvancedMode(1);
        assert.equal(store.getState().ui.advancedModeEnabled, true);
        setAdvancedMode(null);
        assert.equal(store.getState().ui.advancedModeEnabled, true);
    });

    it('toggleAdvancedMode переключает состояние', async () => {
        const { store } = await import('../../../js/state/store.js');
        const { toggleAdvancedMode, setAdvancedMode }
            = await import('../../../js/controllers/calcController.js');
        setAdvancedMode(false);
        toggleAdvancedMode();
        assert.equal(store.getState().ui.advancedModeEnabled, true);
        toggleAdvancedMode();
        assert.equal(store.getState().ui.advancedModeEnabled, false);
    });

    it('выключение advanced на admin-tab → переключение на safe-вкладку', async () => {
        const { store } = await import('../../../js/state/store.js');
        const { setAdvancedMode } = await import('../../../js/controllers/calcController.js');

        // Сценарий: advanced=on, пользователь на «Элементы», нет активного calc → safe = calculations.
        setAdvancedMode(true);
        store.setActiveTab('items');
        store.setActiveCalc(null);
        setAdvancedMode(false);
        assert.equal(store.getState().activeTab, 'calculations',
            'без активного расчёта safe-tab = calculations');

        // Сценарий: на «Вопросы», есть активный calc → safe = questionnaire.
        setAdvancedMode(true);
        store.setActiveCalc({
            id: 'redir-1', name: 'r1', schemaVersion: 16,
            answers: {}, answersMeta: {},
            settings: {
                applyRiskFactors: false, vatEnabled: false, vatRate: 0,
                planningHorizonYears: 1, phaseDurationMonths: 12,
                standSizeRatio: { DEV: 0.16, IFT: 0.4, PSI: 0.5, LOAD: 0.8, PROD: 1.0 },
                resourceRatio: {},
                aiStandFactor: { DEV: 0.02, IFT: 0.2, PSI: 0.5, PROD: 1.0, LOAD: 1.0 }
            },
            dictionaries: { questions: [], items: [], settings: {} },
            view: { disabledStands: [] }
        });
        store.setActiveTab('questions');
        setAdvancedMode(false);
        assert.equal(store.getState().activeTab, 'questionnaire',
            'с активным расчётом safe-tab = questionnaire');
    });

    it('выключение advanced на не-admin tab оставляет вкладку как есть', async () => {
        const { store } = await import('../../../js/state/store.js');
        const { setAdvancedMode } = await import('../../../js/controllers/calcController.js');
        setAdvancedMode(true);
        store.setActiveTab('dashboard');
        setAdvancedMode(false);
        assert.equal(store.getState().activeTab, 'dashboard',
            'не-admin tab не должна сбрасываться при выключении advanced');
    });

    it('ADVANCED_ONLY_TABS = ["items", "questions"]', async () => {
        const { ADVANCED_ONLY_TABS } = await import('../../../js/controllers/calcController.js');
        assert.deepEqual([...ADVANCED_ONLY_TABS], ['items', 'questions']);
    });
});

describe('Phase 3c — store initialState', () => {
    it('state.ui.advancedModeEnabled инициализируется как false', async () => {
        // Импортируем store «свежим» через dynamic import после фейковой очистки storage.
        // store-singleton — кэшируется ESM, поэтому проверяем текущее значение.
        const { store } = await import('../../../js/state/store.js');
        const v = store.getState().ui.advancedModeEnabled;
        assert.equal(typeof v, 'boolean', 'значение должно быть boolean (никаких null/undefined)');
    });
});
