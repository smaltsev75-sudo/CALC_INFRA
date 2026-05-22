/**
 * Внешний аудит #13 (2026-05-19, тринадцатый за серию).
 *
 * 7 пунктов — 5 из 7 прямые пропуски §5.bis для PATCH 2.18.5.
 *
 *   P1#1  ctx.loadCalcById (app.js) + CSV-экспорт сравнения берут raw
 *         persist.loadCalc, минуя prepareLoadedCalc → comparison UI/CSV
 *         показывают stale значения для legacy auto-by-date calc'ов.
 *
 *   P1#2  buildStateBundle silent-фильтрует error calcs через .filter(Boolean)
 *         после try/catch в map. snackbar показывает count из state, не из
 *         bundle → пользователь не знает о потерянных calc'ах.
 *
 *   P1/P2#3 prepareLoadedCalc принимает не-object (строка, число, массив)
 *           как success path с calc=stored. store.setActiveCalc("bad")
 *           через spread даёт {0:'b',1:'a',2:'d'}.
 *
 *   P2#4  enrichChanged ловит только добавление вопросов/ЭК, не qtyFormulas
 *         refresh для уже существующих items (_AGENT_FORMULA_REFRESH_IDS).
 *         openCalc обновляет формулу в-памяти, storage остаётся stale.
 *
 *   P2#5  validateQuestion не проверяет defaultValue/defaultIfUnknown по
 *         типу вопроса. saveQuestion кладёт invalid default в answers →
 *         calc немедленно не проходит validateCalculation.
 *
 *   P3#6  ANSWER_STR_MAX (4KB) применяется только к root.answers,
 *         scenarios[*].answers без length-check → 10MB строка проходит.
 *
 *   P3#7  applyStateBundle rollback не вызывает removeKey, если
 *         backup.defaultDict=null. Импортированный {items:[], questions:[]}
 *         остаётся в storage после rollback.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from './storage-mock.js';

installLocalStorage();

const storageMod = await import('../../js/services/storage.js');
const persist = await import('../../js/state/persistence.js');
const { store } = await import('../../js/state/store.js');
const calcListCtl = await import('../../js/controllers/calcListController.js');
const itemCtl = await import('../../js/controllers/itemController.js');
const questionCtl = await import('../../js/controllers/questionController.js');
const { prepareLoadedCalc } = await import('../../js/services/loadedCalc.js');
const { validateCalculation, validateQuestion } = await import('../../js/domain/validation.js');
const { LATEST_SCHEMA_VERSION } = await import('../../js/state/migrations.js');
const { buildStateBundle, applyStateBundle } = await import('../../js/services/bundleExport.js');
const { STORAGE_KEYS, VALIDATION } = await import('../../js/utils/constants.js');

function _baseSettings() {
    return {
        period: 'monthly', daysPerMonth: 30, planningHorizonYears: 1,
        phaseDurationMonths: 3,
        kInflation: 0, kSeasonal: 0, kScheduleShift: 0, kContingency: 0,
        bufferTask: 1.0, bufferProject: 1.0,
        vatRateMode: 'auto-by-date', vatEffectiveDate: '2026-03-01',
        vatRate: 0.22, vatEnabled: true, applyRiskFactors: false,
        standSizeRatio: { DEV: 0.16, IFT: 0.40, PSI: 0.50, LOAD: 0.80, PROD: 1.00 }
    };
}

function seedCalc(calc) {
    localStorage.setItem(`calc.${calc.id}`, JSON.stringify(calc));
    const meta = { id: calc.id, name: calc.name, updatedAt: calc.updatedAt };
    const list = JSON.parse(localStorage.getItem('calc.list') || '[]');
    list.push(meta);
    localStorage.setItem('calc.list', JSON.stringify(list));
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
 * P1/P2 #3 prepareLoadedCalc reject not-object
 * ============================================================ */

describe('Audit #13 P1/P2#3: prepareLoadedCalc отвергает не-object stored', () => {
    it('строка → {calc:null, error:Error}', () => {
        const r = prepareLoadedCalc('not-an-object');
        assert.equal(r.calc, null, 'строка не должна проходить как valid calc');
        assert.ok(r.error, 'error обязателен для строки');
    });

    it('число → {calc:null, error:Error}', () => {
        const r = prepareLoadedCalc(42);
        assert.equal(r.calc, null);
        assert.ok(r.error);
    });

    it('массив → {calc:null, error:Error}', () => {
        const r = prepareLoadedCalc([{ id: 'x' }]);
        assert.equal(r.calc, null, 'массив (typeof "object") не должен проходить как calc');
        assert.ok(r.error);
    });

    it('boolean → {calc:null, error:Error}', () => {
        const r = prepareLoadedCalc(true);
        assert.equal(r.calc, null);
        assert.ok(r.error);
    });

    it('null → {calc:null, error:null} (нет stored — это не ошибка, просто пусто)', () => {
        const r = prepareLoadedCalc(null);
        assert.equal(r.calc, null);
        assert.equal(r.error, null);
    });

    it('undefined → {calc:undefined, error:null}', () => {
        const r = prepareLoadedCalc(undefined);
        assert.equal(r.calc, undefined);
        assert.equal(r.error, null);
    });
});

/* ============================================================
 * P2#4 enrichChanged ловит qtyFormulas refresh
 * ============================================================ */

describe('Audit #13 P2#4: enrichChanged ловит refresh формул у существующих items', () => {
    it('legacy llm-tokens-input-1m с устаревшей формулой → needsPersist=true', () => {
        /* _AGENT_FORMULA_REFRESH_IDS включает llm-tokens-input-1m.
         * Создаём stored calc с этим item, но qtyFormulas явно устаревшие
         * (не совпадают с current seed). enrich должен обновить, и
         * prepareLoadedCalc должен поднять флаг needsPersist=true. */
        const stored = {
            id: 'audit13-formula',
            name: 'X',
            version: '1.0',
            schemaVersion: LATEST_SCHEMA_VERSION,
            createdAt: '2026-03-01T10:00:00.000Z',
            updatedAt: '2026-03-01T10:00:00.000Z',
            settings: _baseSettings(),
            answers: {},
            answersMeta: {},
            dictionaries: {
                items: [{
                    id: 'llm-tokens-input-1m',
                    name: 'Стары', unit: 'млн', pricePerUnit: 1,
                    category: 'AI', resourceClass: 'AI_LLM',
                    billingInterval: 'monthly',
                    applicableStands: ['PROD'],
                    qtyFormulas: { PROD: '999' }
                }],
                questions: []
            }
        };
        const r = prepareLoadedCalc(stored);
        assert.ok(r.calc, 'calc должен быть подготовлен');
        const item = r.calc.dictionaries.items.find(it => it.id === 'llm-tokens-input-1m');
        const newFormula = item?.qtyFormulas?.PROD;
        assert.notEqual(newFormula, '999',
            'enrich должен обновить qtyFormulas из current seed');
        assert.equal(r.needsPersist, true,
            'enrichChanged должен ловить qtyFormulas refresh у уже существующих items. ' +
            'До фикса: length-check возвращал false → storage оставался stale.');
    });
});

/* ============================================================
 * P2#5 validateQuestion проверяет defaultValue/defaultIfUnknown
 * ============================================================ */

describe('Audit #13 P2#5: validateQuestion отвергает невалидный defaultValue', () => {
    it('number-вопрос с defaultIfUnknown:"not-a-number" → ошибка', () => {
        const q = {
            id: 'bad_default',
            section: 'business',
            title: 'X',
            type: 'number',
            order: 1,
            defaultIfUnknown: 'not-a-number'
        };
        const errors = [];
        validateQuestion(q, errors);
        const defErrors = errors.filter(e => e.path.includes('defaultIfUnknown') || e.path.includes('defaultValue'));
        assert.ok(defErrors.length > 0,
            'defaultIfUnknown для number-вопроса должен быть числом');
    });

    it('boolean-вопрос с defaultIfUnknown:"yes" → ошибка', () => {
        const q = {
            id: 'bad_bool',
            section: 'business',
            title: 'X',
            type: 'boolean',
            order: 1,
            defaultIfUnknown: 'yes'
        };
        const errors = [];
        validateQuestion(q, errors);
        const defErrors = errors.filter(e => e.path.includes('default'));
        assert.ok(defErrors.length > 0,
            'defaultIfUnknown для boolean-вопроса должен быть boolean');
    });

    it('select-вопрос с defaultIfUnknown вне options → ошибка', () => {
        const q = {
            id: 'bad_sel',
            section: 'business',
            title: 'X',
            type: 'select',
            order: 1,
            options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }],
            defaultIfUnknown: 'c'
        };
        const errors = [];
        validateQuestion(q, errors);
        const defErrors = errors.filter(e => e.path.includes('default'));
        assert.ok(defErrors.length > 0,
            'defaultIfUnknown для select-вопроса должен быть из options');
    });

    it('number-вопрос с defaultIfUnknown:42 → OK', () => {
        const q = {
            id: 'good_q',
            section: 'business',
            title: 'X',
            type: 'number',
            order: 1,
            defaultIfUnknown: 42
        };
        const errors = [];
        validateQuestion(q, errors);
        const defErrors = errors.filter(e => e.path.includes('default'));
        assert.deepEqual(defErrors, [], 'валидный default не должен давать ошибок');
    });

    it('number-вопрос с defaultIfUnknown:null → OK (= «Не знаю»)', () => {
        const q = {
            id: 'null_default',
            section: 'business',
            title: 'X',
            type: 'number',
            order: 1,
            defaultIfUnknown: null
        };
        const errors = [];
        validateQuestion(q, errors);
        const defErrors = errors.filter(e => e.path.includes('default'));
        assert.deepEqual(defErrors, [], 'null допустим');
    });
});

/* ============================================================
 * P3#6 ANSWER_STR_MAX в scenario answers
 * ============================================================ */

describe('Audit #13 P3#6: ANSWER_STR_MAX лимит в scenarios[*].answers', () => {
    it('scenario answer длиной 10000 символов → ошибка', () => {
        const longStr = 'x'.repeat(VALIDATION.ANSWER_STR_MAX + 100);
        const calc = {
            id: 'audit13-len',
            name: 'L',
            version: '1.0',
            settings: _baseSettings(),
            answers: {},
            dictionaries: { items: [], questions: [] },
            scenarios: [
                { id: 'sc1', label: 'S1', wizard: null, answers: { foo: longStr }, answersMeta: {} }
            ],
            activeScenarioId: 'sc1'
        };
        const errors = [];
        validateCalculation(calc, errors);
        const lenErrors = errors.filter(e =>
            e.path.includes('scenarios') &&
            e.message.includes(`${VALIDATION.ANSWER_STR_MAX}`)
        );
        assert.ok(lenErrors.length > 0,
            `scenario answer > ${VALIDATION.ANSWER_STR_MAX} симв должен дать ошибку. ` +
            'До фикса: размер проверялся только в root.answers loop, не в _validateAnswersAgainstQuestions.');
    });

    it('root answer длиной 10000 символов → ошибка (sanity)', () => {
        const longStr = 'x'.repeat(VALIDATION.ANSWER_STR_MAX + 100);
        const calc = {
            id: 'audit13-len-root',
            name: 'L',
            version: '1.0',
            settings: _baseSettings(),
            answers: { foo: longStr },
            dictionaries: { items: [], questions: [] }
        };
        const errors = [];
        validateCalculation(calc, errors);
        const lenErrors = errors.filter(e =>
            e.path.includes('answers') &&
            e.message.includes(`${VALIDATION.ANSWER_STR_MAX}`)
        );
        assert.ok(lenErrors.length > 0, 'root answer > limit — sanity check существующего поведения');
    });
});

/* ============================================================
 * P3#7 applyStateBundle rollback removeKey при backup.defaultDict=null
 * ============================================================ */

describe('Audit #13 P3#7: applyStateBundle rollback removeKey при backup.defaultDict=null', () => {
    it('baseline без dict → quota на calc.activeId → rollback убирает imported dict', () => {
        /* Spy: setItem бросает только для 'calc.activeId'. Это запустит throw
         * на шаге 7 applyStateBundle (saveActiveCalcId), что приведёт к
         * rollback. До фикса rollback восстанавливал dict только когда
         * backup.defaultDict !== null; при null imported dict оставался.
         *
         * Особенность: storage spy установлен через Object.defineProperty,
         * persist.* остаётся неизменным module-binding'ом, но обращается
         * к подменённому localStorage. */
        const data = new Map();
        const failKey = 'calc.activeId';
        Object.defineProperty(globalThis, 'localStorage', {
            value: {
                get length() { return data.size; },
                key(i) { return Array.from(data.keys())[i] ?? null; },
                getItem(k) { return data.has(String(k)) ? data.get(String(k)) : null; },
                setItem(k, v) {
                    if (String(k) === failKey) {
                        const e = new Error('QuotaExceededError');
                        e.name = 'QuotaExceededError';
                        throw e;
                    }
                    data.set(String(k), String(v));
                },
                removeItem(k) { data.delete(String(k)); },
                clear() { data.clear(); }
            },
            configurable: true, writable: true
        });
        storageMod.__resetStorageMode();
        /* baseline: dict отсутствует */
        assert.equal(data.has(STORAGE_KEYS.DEFAULT_DICTIONARY), false);

        const calc = {
            id: 'audit13-rb', name: 'X', version: '1.0',
            schemaVersion: LATEST_SCHEMA_VERSION,
            createdAt: '2026-03-01T10:00:00.000Z',
            updatedAt: '2026-03-01T10:00:00.000Z',
            settings: _baseSettings(),
            answers: {}, answersMeta: {},
            dictionaries: { items: [], questions: [] }
        };
        const bundle = {
            version: 'bundle-3.0',
            appVersion: '2.10.0',
            activeCalcId: calc.id,
            defaultDictionary: { items: [], questions: [] },
            calculations: [calc]
        };
        const result = applyStateBundle(bundle);
        assert.equal(result.ok, false, 'apply должен fail на quota для activeId');
        assert.equal(result.reason, 'apply');

        /* Главное: rollback должен УБРАТЬ dict, потому что в backup'е его не было. */
        assert.equal(data.has(STORAGE_KEYS.DEFAULT_DICTIONARY), false,
            'rollback должен убрать dict если backup.defaultDict=null. ' +
            'До фикса: imported {items:[], questions:[]} оставался в storage.');
    });
});

/* ============================================================
 * P1#1 ctx.loadCalcById через prepareLoadedCalc
 * ============================================================ */

describe('Audit #13 P1#1: ctx.loadCalcById через prepareLoadedCalc', () => {
    it('legacy auto-by-date calc → loadCalcById возвращает с пересчитанным vatRate', async () => {
        /* В контроллерах нет ctx.loadCalcById — это в app.js. Проверяем
         * новый именованный экспорт loadCalcPrepared из calcListController
         * (после фикса), либо через behavioral: comparison должен видеть
         * корректные суммы. Поскольку app.js не экспортирует ctx как модуль
         * (он строится internally), test проверяет helper напрямую. */
        const stored = {
            id: 'audit13-vat-cmp', name: 'V', version: '1.0',
            schemaVersion: LATEST_SCHEMA_VERSION,
            createdAt: '2025-06-01T10:00:00.000Z',
            updatedAt: '2025-06-01T10:00:00.000Z',
            settings: { ..._baseSettings(), vatEffectiveDate: null, vatRate: 0.22 },
            answers: {}, answersMeta: {},
            dictionaries: { items: [], questions: [] }
        };
        seedCalc(stored);

        /* Используем calcListCtl.loadCalcPrepared (новый именованный export) */
        const prepared = calcListCtl.loadCalcPrepared('audit13-vat-cmp');
        assert.ok(prepared, 'loadCalcPrepared должен вернуть calc');
        assert.equal(prepared.settings.vatRate, 0.20,
            'loadCalcPrepared должен пересчитать vatRate для 2025 (auto-by-date). ' +
            'До фикса: ctx.loadCalcById возвращал raw — UI Comparison/CSV показывали stale 0.22.');
    });
});

/* ============================================================
 * P1#2 buildStateBundle не silent-теряет error calcs
 * ============================================================ */

describe('Audit #13 P1#2: buildStateBundle сигналит о потерянных calc\'ах', () => {
    it('битый calc → bundle содержит errors-список + calc отсутствует, но факт потери явный', () => {
        /* Создаём calc с schemaVersion больше LATEST → migrate бросит */
        const futureCalc = {
            id: 'audit13-future', name: 'F', version: '1.0',
            schemaVersion: LATEST_SCHEMA_VERSION + 99,
            settings: _baseSettings(),
            answers: {},
            dictionaries: { items: [], questions: [] }
        };
        seedCalc(futureCalc);

        const bundle = buildStateBundle();
        /* Bundle всё ещё должен экспортироваться (остальные ОК или пусто). */
        assert.ok(bundle, 'bundle должен быть собран');
        /* Главное: bundle.errors[] должен содержать запись о потерянном calc'е,
         * чтобы UI мог показать warning. До фикса — silent skip без сигнала. */
        assert.ok(Array.isArray(bundle.errors),
            'bundle должен содержать errors[] (audit #13 P1#2)');
        assert.ok(bundle.errors.length > 0,
            'errors должен содержать запись о future-calc, который не прошёл migrate');
        assert.ok(bundle.errors.some(e => e && e.calcId === 'audit13-future'),
            'errors должны содержать id потерянного calc\'а');
    });
});
