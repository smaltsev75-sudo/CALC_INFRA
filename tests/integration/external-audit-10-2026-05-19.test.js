/**
 * Внешний аудит #12 (2026-05-19, второй за день — после релиза 2.18.4).
 *
 * 5 пунктов — в том числе РЕГРЕССИЯ от моего фикса audit-11 P1#2-родственного
 * (buildStateBundle sanitize ДО migrate потерял legacy данные).
 *
 *   P1#1  buildStateBundle.sanitizeDeprecatedQuestions ДО migrate. Миграция
 *         3→4 для dau_target → dau_share_of_registered_percent читает
 *         dau_target ИЗ answers; если sanitize уже удалил dau_target —
 *         миграция падает в дефолт 5%.
 *
 *   P1#2  applyStateBundle calc-loop делает migrate + applyVatResolver, но
 *         НЕ enrichLegacyDictionaryWithAgentSeed. После restore из bundle
 *         старой версии agent-вопросы/ЭК отсутствуют в storage.
 *
 *   P2#3  prepareLoadedCalc вызывает enrich, но needsPersist игнорирует
 *         enrichChanged → commitMigratedCalc не вызывается → storage
 *         остаётся без agent-данных, хотя UI их показывает (in-memory).
 *
 *   P2#4  saveDefaultDictionary пишет dict raw — комментарий
 *         deprecatedQuestions.js обещал write-side cleanup, но реально
 *         его не было. Дефолтный словарь со stale id уезжает в storage
 *         и в backup.
 *
 *   P3    validateCalculation:
 *         (a) scenarios:"bad" (не массив) — проходит, isArray-guard skip'ает;
 *         (b) activeScenarioId:"ghost" при scenarios:"bad" — не валидируется;
 *         (c) root.answersMeta:"meta" (строка) — не проверяется; spread
 *             даёт {0:'m',1:'e',2:'t',3:'a'} в syncRootFromActiveScenario.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from './storage-mock.js';

installLocalStorage();

const storageMod = await import('../../js/services/storage.js');
const persist = await import('../../js/state/persistence.js');
const { store } = await import('../../js/state/store.js');
const calcListCtl = await import('../../js/controllers/calcListController.js');
const { validateCalculation } = await import('../../js/domain/validation.js');
const { LATEST_SCHEMA_VERSION, migrateCalculation } = await import('../../js/state/migrations.js');
const { buildStateBundle, applyStateBundle, validateBundle } = await import('../../js/services/bundleExport.js');
const { sanitizeDefaultDictionary } = await import('../../js/domain/deprecatedQuestions.js');

function seedLocalStorage(calcs, opts = {}) {
    const list = calcs.map(c => ({ id: c.id, name: c.name, updatedAt: c.updatedAt }));
    for (const c of calcs) {
        localStorage.setItem(`calc.${c.id}`, JSON.stringify(c));
    }
    localStorage.setItem('calc.list', JSON.stringify(list));
    if (opts.activeId !== undefined) {
        localStorage.setItem('calc.activeId', JSON.stringify(opts.activeId));
    }
    if (opts.defaultDictionary !== undefined) {
        localStorage.setItem('calc.defaultDictionary', JSON.stringify(opts.defaultDictionary));
    }
}

function _baseValidSettings() {
    return {
        period: 'monthly',
        daysPerMonth: 30,
        planningHorizonYears: 1,
        phaseDurationMonths: 3,
        kInflation: 0, kSeasonal: 0, kScheduleShift: 0, kContingency: 0,
        bufferTask: 1.0, bufferProject: 1.0,
        vatRateMode: 'auto-by-date',
        vatEffectiveDate: '2026-03-01',
        vatRate: 0.22, vatEnabled: true,
        applyRiskFactors: false,
        standSizeRatio: { DEV: 0.16, IFT: 0.40, PSI: 0.50, LOAD: 0.80, PROD: 1.00 }
    };
}

beforeEach(() => {
    installLocalStorage();
    storageMod.__resetStorageMode();
    store.setActiveCalc(null);
    store.setCalcList([]);
    store.setPersistStatus('idle');
    store.setDefaultDictionary({ items: [], questions: [] });
});

/* ============================================================
 * P1#1 buildStateBundle: sanitize → migrate теряет данные dau_target
 * ============================================================ */

describe('Audit #12 P1#1: buildStateBundle migrate ДО sanitize (порядок имеет значение)', () => {
    it('legacy calc schemaVersion=3 с dau_target=100 / registered=500 → export/apply сохраняет share=20%', () => {
        /* Reference: direct migrate(legacy) даёт dau_share = 100/500*100 = 20%.
         * Sanitize ПЕРЕД migrate удаляет dau_target → migrate видит NaN →
         * fallback на default 5%. Это РЕГРЕССИЯ от моего audit-11 fix. */
        const legacy = {
            id: 'audit12-dau',
            name: 'L',
            version: '1.0',
            schemaVersion: 3,
            createdAt: '2024-05-01T10:00:00.000Z',
            updatedAt: '2024-05-01T10:00:00.000Z',
            settings: _baseValidSettings(),
            answers: { dau_target: 100, registered_users_total: 500 },
            answersMeta: {},
            dictionaries: { items: [], questions: [] }
        };
        seedLocalStorage([legacy]);

        /* Reference path: direct migrate */
        const directMigrated = migrateCalculation(legacy);
        assert.equal(
            directMigrated.answers.dau_share_of_registered_percent, 20,
            'direct migrate должен дать share=20%, иначе тест нерелевантен'
        );

        /* Test path: export → in-memory backup → apply */
        const bundle = buildStateBundle();
        const exportedCalc = bundle.calculations.find(c => c.id === 'audit12-dau');
        assert.ok(exportedCalc, 'calc должен быть в bundle');
        /* Bundle экспортирован — на этом этапе данные могут быть raw или
         * migrated, но dau_target ДОЛЖЕН либо присутствовать (для последующей
         * migrate в apply), либо уже быть как share=20%. НЕ default 5%. */

        installLocalStorage();
        storageMod.__resetStorageMode();
        const result = applyStateBundle(bundle);
        assert.equal(result.ok, true, `applyStateBundle: ${JSON.stringify(result)}`);

        const restored = persist.loadCalc('audit12-dau');
        assert.equal(
            restored.answers.dau_share_of_registered_percent, 20,
            'После export+apply share должен сохранить значение 20%, ' +
            'не сваливаться в default 5% (регрессия audit-11 fix).'
        );
    });
});

/* ============================================================
 * P1#2 applyStateBundle: enrichLegacyDictionaryWithAgentSeed
 * ============================================================ */

describe('Audit #12 P1#2: applyStateBundle calc-loop enrich agent-seed', () => {
    it('bundle с legacy calc без agent-вопросов — после apply agent-вопросы есть в storage', () => {
        /* legacy schemaVersion=LATEST без agent-вопросов (имитация bundle
         * от старой версии до Этапа 13). */
        const legacy = {
            id: 'audit12-agent',
            name: 'NoAgent',
            version: '1.0',
            schemaVersion: LATEST_SCHEMA_VERSION,
            createdAt: '2026-03-01T10:00:00.000Z',
            updatedAt: '2026-03-01T10:00:00.000Z',
            settings: _baseValidSettings(),
            answers: {},
            answersMeta: {},
            dictionaries: { items: [], questions: [] },
            scenarios: [], activeScenarioId: null,
            view: { disabledStands: [] }
        };
        const bundle = {
            version: 'bundle-3.0',
            exportedAt: '2026-05-19T00:00:00.000Z',
            appVersion: '2.10.0',
            activeCalcId: legacy.id,
            defaultDictionary: { items: [], questions: [] },
            calculations: [legacy]
        };

        const result = applyStateBundle(bundle);
        assert.equal(result.ok, true, `applyStateBundle: ${JSON.stringify(result)}`);

        const stored = persist.loadCalc('audit12-agent');
        const hasAgentQuestion = stored.dictionaries.questions.some(q => q && q.id === 'ai_agent_mode');
        assert.ok(hasAgentQuestion,
            'После apply calc должен содержать agent-вопрос ai_agent_mode в storage.');
        const hasAgentItem = stored.dictionaries.items.some(it => it && it.id === 'ai-agent-sandbox-vcpu');
        assert.ok(hasAgentItem,
            'После apply calc должен содержать agent-ЭК ai-agent-sandbox-vcpu в storage.');
    });
});

/* ============================================================
 * P2#3 prepareLoadedCalc: needsPersist учитывает enrichChanged
 * ============================================================ */

describe('Audit #12 P2#3: openCalc персистит результат enrichLegacyDictionaryWithAgentSeed', () => {
    it('legacy calc без agent-вопросов → openCalc → storage обновлён', () => {
        const legacy = {
            id: 'audit12-enrich-persist',
            name: 'NoAgent',
            version: '1.0',
            schemaVersion: LATEST_SCHEMA_VERSION,
            createdAt: '2026-03-01T10:00:00.000Z',
            updatedAt: '2026-03-01T10:00:00.000Z',
            settings: _baseValidSettings(),
            answers: {},
            answersMeta: {},
            dictionaries: { items: [], questions: [] },
            scenarios: [], activeScenarioId: null,
            view: { disabledStands: [] }
        };
        seedLocalStorage([legacy]);

        const opened = calcListCtl.openCalc('audit12-enrich-persist');
        assert.ok(opened, 'openCalc должен пройти');
        const hasAgentMemory = opened.dictionaries.questions.some(q => q && q.id === 'ai_agent_mode');
        assert.ok(hasAgentMemory, 'openCalc должен enrich\'нуть agent-вопросы в-памяти (sanity).');

        const stored = persist.loadCalc('audit12-enrich-persist');
        const hasAgentStorage = stored.dictionaries.questions.some(q => q && q.id === 'ai_agent_mode');
        assert.ok(hasAgentStorage,
            'openCalc должен persist\'ить enrich-result. Раньше needsPersist=false → ' +
            'in-memory enriched, storage stale; F5 опять enrich (idempotent), но ' +
            'buildStateBundle экспортировал raw без agent-данных.');
    });
});

/* ============================================================
 * P2#4 saveDefaultDictionary + applyStateBundle dict — write-side sanitize
 * ============================================================ */

describe('Audit #12 P2#4: saveDefaultDictionary write-side sanitize', () => {
    it('saveDefaultDictionary прямой call — stale deprecated id удаляется', () => {
        const staleDict = {
            items: [],
            questions: [
                { id: 'live_q', section: 'business', title: 'OK', type: 'number', order: 1 },
                { id: 'mau_growth_rate_percent', section: 'business', title: 'Stale', type: 'number', order: 2 }
            ]
        };
        const ok = persist.saveDefaultDictionary(staleDict);
        assert.equal(ok, true);

        const reloaded = persist.loadDefaultDictionary();
        const qIds = reloaded.questions.map(q => q.id);
        assert.ok(!qIds.includes('mau_growth_rate_percent'),
            'saveDefaultDictionary должен sanitize. Комментарий в deprecatedQuestions.js ' +
            'обещал write-side cleanup, но реализации не было.');
        assert.ok(qIds.includes('live_q'), 'Live вопросы остаются.');
    });

    it('applyStateBundle с stale dict в bundle — после apply storage clean', () => {
        const staleDict = {
            items: [],
            questions: [
                { id: 'mau_growth_rate_percent', section: 'business', title: 'X', type: 'number', order: 1 }
            ]
        };
        const bundle = {
            version: 'bundle-3.0',
            exportedAt: '2026-05-19T00:00:00.000Z',
            appVersion: '2.10.0',
            activeCalcId: null,
            defaultDictionary: staleDict,
            calculations: []
        };
        const result = applyStateBundle(bundle);
        assert.equal(result.ok, true, `applyStateBundle: ${JSON.stringify(result)}`);

        const stored = persist.loadDefaultDictionary();
        const qIds = (stored?.questions || []).map(q => q.id);
        assert.ok(!qIds.includes('mau_growth_rate_percent'),
            'applyStateBundle должен sanitize bundle.defaultDictionary перед save.');
    });
});

/* ============================================================
 * P3 validation shape: scenarios not-array, root.answersMeta, activeScenarioId outside guard
 * ============================================================ */

describe('Audit #12 P3: validateCalculation отвергает кривые shape', () => {
    function _calcBase() {
        return {
            id: 'audit12-shape',
            name: 'V',
            version: '1.0',
            settings: _baseValidSettings(),
            answers: {},
            dictionaries: { items: [], questions: [] }
        };
    }

    it('scenarios:"bad" (не массив, не undefined) — ошибка', () => {
        const calc = _calcBase();
        calc.scenarios = 'bad';
        const errors = [];
        validateCalculation(calc, errors);
        const scErrors = errors.filter(e => e.path.startsWith('scenarios'));
        assert.ok(scErrors.length > 0,
            `scenarios:"bad" должен дать ошибку. До фикса: isArray-guard молча skip'ал.`);
    });

    it('scenarios:"bad" + activeScenarioId:"ghost" — обе ошибки', () => {
        const calc = _calcBase();
        calc.scenarios = 'bad';
        calc.activeScenarioId = 'ghost';
        const errors = [];
        validateCalculation(calc, errors);
        const activeErrors = errors.filter(e => e.path.includes('activeScenarioId'));
        assert.ok(activeErrors.length > 0,
            'activeScenarioId должен проверяться независимо от scenarios-shape.');
    });

    it('root.answersMeta:"meta" (строка) — ошибка', () => {
        const calc = _calcBase();
        calc.answersMeta = 'meta';
        const errors = [];
        validateCalculation(calc, errors);
        const metaErrors = errors.filter(e => e.path.includes('answersMeta'));
        assert.ok(metaErrors.length > 0,
            'root.answersMeta должен быть объектом или null. ' +
            'syncRootFromActiveScenario через spread строки даёт {0:"m",1:"e",...}.');
    });

    it('root.answersMeta:null — OK', () => {
        const calc = _calcBase();
        calc.answersMeta = null;
        const errors = [];
        validateCalculation(calc, errors);
        const metaErrors = errors.filter(e => e.path.includes('answersMeta'));
        assert.deepEqual(metaErrors, [], 'null допустим (= нет meta).');
    });

    it('root.answersMeta:{key:"src"} — OK', () => {
        const calc = _calcBase();
        calc.answersMeta = { peak_rps: 'manual' };
        const errors = [];
        validateCalculation(calc, errors);
        const metaErrors = errors.filter(e => e.path.includes('answersMeta'));
        assert.deepEqual(metaErrors, [], 'object допустим.');
    });

    it('validateBundle тоже ловит scenarios:"bad" в calc bundle', () => {
        const bundle = {
            version: 'bundle-3.0',
            calculations: [{
                ..._calcBase(),
                schemaVersion: LATEST_SCHEMA_VERSION,
                scenarios: 'bad'
            }]
        };
        const v = validateBundle(bundle);
        assert.equal(v.valid, false, 'validateBundle должен отклонить scenarios:"bad" в bundle calc.');
    });
});

/* ============================================================
 * sanity: sanitizeDefaultDictionary helper изолированно работает
 * ============================================================ */

describe('Audit #12 sanity: sanitizeDefaultDictionary clean dict no-op', () => {
    it('clean dict — тот же reference (для подписчиков store)', () => {
        const dict = {
            items: [],
            questions: [{ id: 'live_q', section: 'business', title: 'OK', type: 'number', order: 1 }]
        };
        const out = sanitizeDefaultDictionary(dict);
        assert.equal(out, dict, 'reference equality для clean dict.');
    });
});
