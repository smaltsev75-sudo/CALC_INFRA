/**
 * Внешний аудит #9 (2026-05-19, девятый за серию).
 *
 * 4 пункта ревьюера + 4 родственных (§5.bis 3-уровневый поиск).
 * Все тесты падают на коде ДО фикса и проходят после.
 *
 *   P1#1  initFromStorage НЕ зовёт applyVatResolver — boot-путь активного
 *         calc'а ставится в store сразу после migrate/enrich, без пересчёта
 *         НДС. F5 на auto-by-date calc с legacy createdAt оставляет
 *         неверную ставку 0.22 (должна быть 0.20 для 2025).
 *
 *   P1#1-родственный  importCalcFromFile и applyStateBundle — те же
 *         migrate+enrich без applyVatResolver. impor JSON-а или восстановление
 *         bundle'а с auto-by-date оставляет stale ставку.
 *
 *   P1#2  makeNewCalculation использует stored defaultDictionary без sanitize.
 *         Stale deprecated question в storage → создаётся в новых calc'ах.
 *
 *   P1#2-родственный  buildStateBundle экспортирует raw calc'и и raw dict
 *         без sanitize → stale утекает в backup/export.
 *
 *   P1#3  validateCalculation не валидирует форму scenarios — массив
 *         [null, "bad", {label:"No id"}] проходит без ошибок, потом
 *         switchScenario через spread строки превращает root.answers в
 *         {0:'o',1:'o',...}. activeScenarioId на призрак — тоже допускается.
 *
 *   P2#4  initFromStorage boot-путь проверяет только schemaVersion для
 *         persist-after-sanitize, не hadDeprecated. На LATEST schemaVersion
 *         deprecated id очищаются в памяти, но остаются в localStorage.
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
const { LATEST_SCHEMA_VERSION } = await import('../../js/state/migrations.js');
const { buildStateBundle, applyStateBundle } = await import('../../js/services/bundleExport.js');

/* ----- helpers ----- */

function makeAutoByDateCalc(id, createdAtIso, vatRate) {
    /* calc с inconsistent НДС: settings.vatRate не соответствует
     * createdAt согласно VAT_RATE_HISTORY. Имитирует «приложение
     * сохранило calc, потом обновили справочник или
     * перенесли расчёт из старой версии без resolver».
     *
     * Settings заполнены минимально-валидно для validateBundle:
     * period/standSizeRatio обязательны. */
    return {
        id,
        name: id,
        version: '1.0',
        schemaVersion: LATEST_SCHEMA_VERSION,
        createdAt: createdAtIso,
        updatedAt: createdAtIso,
        settings: {
            vatRateMode: 'auto-by-date',
            vatEffectiveDate: null,  // resolver должен взять createdAt
            vatRate,
            vatEnabled: true,
            applyRiskFactors: false,
            period: 'monthly',
            daysPerMonth: 30,
            planningHorizonYears: 1,
            phaseDurationMonths: 3,
            kInflation: 0,
            kSeasonal: 0,
            kScheduleShift: 0,
            kContingency: 0,
            bufferTask: 1.0,
            bufferProject: 1.0,
            standSizeRatio: { DEV: 0.16, IFT: 0.40, PSI: 0.50, LOAD: 0.80, PROD: 1.00 }
        },
        answers: {},
        answersMeta: {},
        dictionaries: { items: [], questions: [] },
        scenarios: [],
        activeScenarioId: null,
        view: { disabledStands: [] }
    };
}

function seedLocalStorage(calcs, opts = {}) {
    /* Сериализует calc'и и список в localStorage. */
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
    if (opts.schemaVersion !== undefined) {
        localStorage.setItem('calc.schemaVersion', String(opts.schemaVersion));
    }
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
 * P1#1 initFromStorage boot-path не пересчитывает НДС
 * ============================================================ */

describe('External audit #9 P1#1: initFromStorage boot-path зовёт applyVatResolver', () => {
    it('F5 на auto-by-date calc с createdAt=2025-06-01 — vatRate пересчитан из справочника', () => {
        /* legacy период 2019..2025 = 0.20. Calc сохранён с vatRate=0.22
         * (импортирован старой версией приложения без resolver). После F5
         * resolver должен скорректировать на 0.20. */
        const calc = makeAutoByDateCalc('audit9-vat', '2025-06-01T10:00:00.000Z', 0.22);
        seedLocalStorage([calc], { activeId: calc.id, schemaVersion: LATEST_SCHEMA_VERSION });

        calcListCtl.initFromStorage();

        const active = store.getState().activeCalc;
        assert.ok(active, 'activeCalc должен быть восстановлен');
        assert.equal(active.id, 'audit9-vat');
        assert.equal(active.settings.vatRate, 0.20,
            'initFromStorage должен пересчитать vatRate=0.20 для createdAt=2025 (auto-by-date). ' +
            'До фикса: openCalc делал, initFromStorage — нет.');
        assert.equal(active.settings.vatEffectiveDate, '2025-06-01',
            'vatEffectiveDate должна стать createdAt (resolver fallback).');
    });

    it('F5 пересохраняет calc после applyVatResolver — в storage уже исправленная ставка', () => {
        const calc = makeAutoByDateCalc('audit9-vat-persist', '2025-06-01T10:00:00.000Z', 0.22);
        seedLocalStorage([calc], { activeId: calc.id, schemaVersion: LATEST_SCHEMA_VERSION });

        calcListCtl.initFromStorage();

        const stored = persist.loadCalc('audit9-vat-persist');
        assert.equal(stored.settings.vatRate, 0.20,
            'После initFromStorage corrected calc должен быть persist\'нут — иначе ' +
            'buildStateBundle экспортирует stale 0.22.');
        assert.equal(stored.settings.vatEffectiveDate, '2025-06-01');
    });

    it('manual mode не трогается при F5 (resolver no-op для manual)', () => {
        const calc = makeAutoByDateCalc('audit9-manual', '2025-06-01T10:00:00.000Z', 0.10);
        calc.settings.vatRateMode = 'manual';
        calc.settings.vatEffectiveDate = null;
        seedLocalStorage([calc], { activeId: calc.id, schemaVersion: LATEST_SCHEMA_VERSION });

        calcListCtl.initFromStorage();

        const active = store.getState().activeCalc;
        assert.equal(active.settings.vatRateMode, 'manual');
        assert.equal(active.settings.vatRate, 0.10,
            'manual mode — ставка ровно та, что задал пользователь.');
    });
});

/* ============================================================
 * P1#1-родственный applyStateBundle не зовёт applyVatResolver
 * ============================================================ */

describe('External audit #9 P1#1-родственный: applyStateBundle применяет resolver', () => {
    it('bundle с auto-by-date calc из 2025 — после apply ставка скорректирована', () => {
        const calc = makeAutoByDateCalc('audit9-bundle', '2025-06-01T10:00:00.000Z', 0.22);
        const bundle = {
            version: 'bundle-3.0',
            exportedAt: '2026-05-19T00:00:00.000Z',
            appVersion: '2.17.0',  /* старая версия без resolver-fix */
            activeCalcId: calc.id,
            defaultDictionary: { items: [], questions: [] },
            calculations: [calc]
        };

        const result = applyStateBundle(bundle);
        assert.equal(result.ok, true, `applyStateBundle должен пройти: ${JSON.stringify(result)}`);

        const stored = persist.loadCalc('audit9-bundle');
        assert.equal(stored.settings.vatRate, 0.20,
            'applyStateBundle должен прогнать calc через applyVatResolver. ' +
            'До фикса: только migrate, vatRate оставался 0.22.');
    });
});

/* ============================================================
 * P1#2 makeNewCalculation без sanitize stored defaultDictionary
 * ============================================================ */

describe('External audit #9 P1#2: makeNewCalculation НЕ переносит deprecated вопросы из stored dict', () => {
    it('stale mau_growth_rate_percent в stored dict — НЕ попадает в новый calc', () => {
        /* Imitate scenario: stored dict от старой версии содержит уже удалённый
         * вопрос. Создаём новый calc — он не должен получить stale вопрос. */
        const staleDict = {
            items: [{
                id: 'fake-it', name: 'X', unit: 'шт.', pricePerUnit: 1,
                category: 'HW', resourceClass: 'CPU', billingInterval: 'monthly',
                applicableStands: ['PROD'], qtyFormulas: { PROD: '1' }
            }],
            questions: [
                {
                    id: 'mau_growth_rate_percent',  /* deprecated */
                    section: 'business', title: 'Рост MAU', type: 'number',
                    order: 100, defaultIfUnknown: 10
                },
                {
                    id: 'live_question',  /* живой вопрос */
                    section: 'business', title: 'Live', type: 'number',
                    order: 101, defaultIfUnknown: 5
                }
            ]
        };
        seedLocalStorage([], { defaultDictionary: staleDict });

        const calc = calcListCtl.createCalc('audit9-new');
        assert.ok(calc, 'createCalc должен пройти');
        const qIds = calc.dictionaries.questions.map(q => q.id);
        assert.ok(!qIds.includes('mau_growth_rate_percent'),
            'Новый calc НЕ должен содержать deprecated вопросов в dict. ' +
            `Получено: ${JSON.stringify(qIds)}`);
        assert.ok(qIds.includes('live_question'),
            'Живые вопросы должны остаться');
        assert.ok(!('mau_growth_rate_percent' in calc.answers),
            'Новый calc НЕ должен содержать deprecated id в answers.');
    });
});

/* ============================================================
 * P1#2-родственный buildStateBundle экспортирует raw stale
 * ============================================================ */

describe('External audit #9 P1#2-родственный: buildStateBundle sanitize calc/dict', () => {
    it('stale calc в storage — bundle экспортирует очищенную копию', () => {
        /* calc на LATEST schemaVersion, но содержит stale answer-key для
         * deprecated вопроса (миграция-удаление пропущена потому что
         * snapshot уже на LATEST). */
        const calc = makeAutoByDateCalc('audit9-bundle-stale', '2026-03-01T10:00:00.000Z', 0.22);
        calc.answers = { mau_growth_rate_percent: 15 };
        seedLocalStorage([calc]);

        const bundle = buildStateBundle();
        const exported = bundle.calculations.find(c => c.id === 'audit9-bundle-stale');
        assert.ok(exported, 'calc должен быть в bundle');
        assert.ok(!('mau_growth_rate_percent' in exported.answers),
            'buildStateBundle должен sanitize calc перед экспортом, чтобы stale id ' +
            'не утекал в backup. До фикса: raw loadCalc, stale присутствовал.');
    });

    it('stale defaultDictionary — bundle экспортирует очищенную копию', () => {
        const staleDict = {
            items: [],
            questions: [
                { id: 'mau_growth_rate_percent', section: 'business',
                  title: 'X', type: 'number', order: 1 }
            ]
        };
        seedLocalStorage([], { defaultDictionary: staleDict });

        const bundle = buildStateBundle();
        const qIds = bundle.defaultDictionary.questions.map(q => q.id);
        assert.ok(!qIds.includes('mau_growth_rate_percent'),
            'buildStateBundle должен sanitize defaultDictionary перед экспортом.');
    });
});

/* ============================================================
 * P1#3 validateCalculation проверяет форму scenarios
 * ============================================================ */

describe('External audit #9 P1#3: validateCalculation отвергает кривые scenarios', () => {
    function _calcBase() {
        return {
            id: 'audit9-val',
            name: 'V',
            version: '1.0',
            settings: { vatEnabled: true, vatRate: 0.22, applyRiskFactors: false },
            answers: {},
            dictionaries: { items: [], questions: [] }
        };
    }

    it('scenarios: [null] — ошибка', () => {
        const calc = _calcBase();
        calc.scenarios = [null];
        const errors = [];
        validateCalculation(calc, errors);
        const scErrors = errors.filter(e => e.path.startsWith('scenarios'));
        assert.ok(scErrors.length > 0,
            `scenarios:[null] должен дать ошибку. Получено: ${JSON.stringify(errors)}`);
    });

    it('scenarios: ["bad-string"] — ошибка', () => {
        const calc = _calcBase();
        calc.scenarios = ['bad-string'];
        const errors = [];
        validateCalculation(calc, errors);
        const scErrors = errors.filter(e => e.path.startsWith('scenarios'));
        assert.ok(scErrors.length > 0,
            `scenarios:["bad-string"] должен дать ошибку.`);
    });

    it('scenarios: [{label: "No id"}] — ошибка (id обязателен)', () => {
        const calc = _calcBase();
        calc.scenarios = [{ label: 'No id', answers: {}, answersMeta: {} }];
        const errors = [];
        validateCalculation(calc, errors);
        const scErrors = errors.filter(e => e.path.includes('id'));
        assert.ok(scErrors.length > 0,
            `scenarios без id должен дать ошибку.`);
    });

    it('scenarios: [{id:"x", answers:"oops"}] — ошибка (answers должен быть объектом)', () => {
        const calc = _calcBase();
        calc.scenarios = [{ id: 'x', label: 'X', answers: 'oops', answersMeta: {} }];
        const errors = [];
        validateCalculation(calc, errors);
        const scErrors = errors.filter(e => e.path.includes('answers'));
        assert.ok(scErrors.length > 0,
            `answers:"oops" должен дать ошибку. До фикса guard isObject(sc.answers) ` +
            `молча skip'ал, switchScenario потом превращал строку в {0:'o',1:'o',...}.`);
    });

    it('scenarios: [{id:"x", answers:{}}] + activeScenarioId="ghost" — ошибка (активный должен существовать)', () => {
        const calc = _calcBase();
        calc.scenarios = [{ id: 'x', label: 'X', answers: {}, answersMeta: {} }];
        calc.activeScenarioId = 'ghost';
        const errors = [];
        validateCalculation(calc, errors);
        const activeErrors = errors.filter(e => e.path.includes('activeScenarioId'));
        assert.ok(activeErrors.length > 0,
            `activeScenarioId на отсутствующий id должен дать ошибку.`);
    });

    it('scenarios валидный массив с одним полноценным scenario — без ошибок', () => {
        const calc = _calcBase();
        calc.scenarios = [{ id: 'x', label: 'X', answers: {}, answersMeta: {} }];
        calc.activeScenarioId = 'x';
        const errors = [];
        validateCalculation(calc, errors);
        const scErrors = errors.filter(e => e.path.startsWith('scenarios') || e.path.includes('activeScenarioId'));
        assert.deepEqual(scErrors, [],
            `Валидный scenarios не должен давать ошибок. Получено: ${JSON.stringify(scErrors)}`);
    });
});

/* ============================================================
 * P2#4 initFromStorage persist-after-sanitize (hadDeprecated)
 * ============================================================ */

describe('External audit #9 P2#4: initFromStorage persist\'ит результат sanitize даже на LATEST schemaVersion', () => {
    it('stale calc на LATEST с deprecated answer — после init storage очищен (persist-after-sanitize)', () => {
        const calc = makeAutoByDateCalc('audit9-persist-san', '2026-03-01T10:00:00.000Z', 0.22);
        /* deprecated id в answers + schemaVersion=LATEST (миграция-удаление
         * пропускается, дефенс-in-depth sanitize в migrate уберёт из памяти). */
        calc.answers = { mau_growth_rate_percent: 99 };
        seedLocalStorage([calc], { activeId: calc.id, schemaVersion: LATEST_SCHEMA_VERSION });

        calcListCtl.initFromStorage();

        const stored = persist.loadCalc('audit9-persist-san');
        assert.ok(!('mau_growth_rate_percent' in stored.answers),
            'initFromStorage должен persist sanitize-result даже если ' +
            'schemaVersion не изменился. До фикса: только в памяти, storage stale.');
    });
});
