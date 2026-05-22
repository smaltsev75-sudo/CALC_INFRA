/**
 * Внешний аудит #2 (2026-05-18, после первого аудита того же дня).
 *
 * Аудитор нашёл 9 пунктов, частично — родственных к первому аудиту, которые
 * я НЕ обработал при поиске «родственных» (skill `review` §2). Калибровочный
 * якорь: это повтор паттерна v8.30.0 PLANNER (см. ~/.claude/CLAUDE.md
 * skill `review` §2) — я починил функцию, не починил соседнюю в том же
 * файле / rollback-фазу той же функции / соседний синхронный путь.
 *
 * Пункты:
 *   P1-1  storage.writeJson() возвращает true при записи в memory fallback
 *         (Safari Private / полная quota с самого старта) → пользователь
 *         видит «saved», после F5 теряет данные.
 *   P1-2  bundleExport rollback не проверяет false от persist.save* —
 *         rollback может «провалиться» молча, calc.list указывает на
 *         удалённый calc.<id>.
 *   P1-3  providerController.applyOverrideToActiveCalc игнорирует
 *         commitActiveCalc → ok:true при провале сохранения.
 *         (Соседняя функция, которую я починил в первом аудите —
 *         applyOverrideToAllCalcsForProvider — но не тронул эту.)
 *   P2-1  calcListController.importCalcFromFile игнорирует commitNewCalc
 *         → ok:true при провале, activeId сохранён, calc.<id> нет.
 *   P2-2a deleteCalc неатомарен: removeCalc → ignored saveCalcList → если
 *         упало, store.calcList всё ещё содержит удалённый id.
 *   P2-2b resetToDefaults тот же класс.
 *   P3-1  syncDefaultDictionary в item/questionController игнорирует
 *         saveDefaultDictionary. (Я знал это из self-audit первого
 *         аудита, не починил — аудитор поймал.)
 *   P3-2  parseFloat принимает «100abc» → 100. Опасно для прайсов.
 *   P3-3  validateCalculation не проверяет range/min/max/options
 *         вопроса — только type. Импорт расчёта с out-of-range
 *         значениями проходит молча.
 *   P3-4  CSP без frame-ancestors 'none' — clickjacking при веб-публикации.
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from './storage-mock.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

installLocalStorage();

const storageMod = await import('../../js/services/storage.js');
const persist = await import('../../js/state/persistence.js');
const bundleMod = await import('../../js/services/bundleExport.js');
const calcListMod = await import('../../js/controllers/calcListController.js');
const { store } = await import('../../js/state/store.js');
const providerCtl = await import('../../js/controllers/providerController.js');
const itemCtl = await import('../../js/controllers/itemController.js');
const questionCtl = await import('../../js/controllers/questionController.js');
const csvImportMod = await import('../../js/services/csvImport.js');
const priceImportMappingMod = await import('../../js/domain/priceImportMapping.js');
const formatMod = await import('../../js/services/format.js');
const validationMod = await import('../../js/domain/validation.js');

const __dirname = dirname(fileURLToPath(import.meta.url));

/* ============================================================
 * helpers (см. external-audit-2026-05-18.test.js для базовой версии)
 * ============================================================ */

function installQuotaSpy({ passProbe = false } = {}) {
    const data = new Map();
    let quotaOn = false;
    const ls = {
        get length() { return data.size; },
        key(i) { return Array.from(data.keys())[i] ?? null; },
        getItem(k) { return data.has(String(k)) ? data.get(String(k)) : null; },
        setItem(k, v) {
            const key = String(k);
            if (quotaOn && !(passProbe && key === '__test__')) {
                const err = new Error('QuotaExceededError');
                err.name = 'QuotaExceededError';
                throw err;
            }
            data.set(key, String(v));
        },
        removeItem(k) { data.delete(String(k)); },
        clear() { data.clear(); }
    };
    Object.defineProperty(globalThis, 'localStorage', {
        value: ls, configurable: true, writable: true
    });
    return {
        ls, data,
        enableQuota() { quotaOn = true; },
        disableQuota() { quotaOn = false; }
    };
}

function snapshotStorageData() {
    const out = {};
    for (let i = 0; i < globalThis.localStorage.length; i++) {
        const k = globalThis.localStorage.key(i);
        out[k] = globalThis.localStorage.getItem(k);
    }
    return out;
}

/* ============================================================
 * P1-1 — writeJson при memory fallback не должен сигналить «saved»
 * ============================================================ */

describe('audit-2 P1-1: writeJson возвращает false при memory fallback (не лжёт о save)', () => {
    beforeEach(() => {
        installLocalStorage();
        storageMod.__resetStorageMode?.();
    });

    it('Safari Private / quota с самого старта → writeJson возвращает false', () => {
        /* Spy роняет ВСЁ, включая probe — getStorage() сразу уходит в memory. */
        const spy = installQuotaSpy({ passProbe: false });
        spy.enableQuota();
        storageMod.__resetStorageMode?.();

        const result = storageMod.writeJson('calc.test-key', { x: 1 });
        assert.equal(result, false,
            'P1-1: writeJson не должен возвращать true когда запись пошла в session-only memory — ' +
            'иначе caller отчитается «saved», persistStatus=saved, и пользователь потеряет данные после F5');
    });

    it('обычный localStorage → writeJson возвращает true (регресс-якорь)', () => {
        installLocalStorage();
        storageMod.__resetStorageMode?.();
        const result = storageMod.writeJson('calc.test-key', { x: 1 });
        assert.equal(result, true, 'на здоровом storage контракт сохраняется');
    });
});

/* ============================================================
 * P1-2 — bundleExport rollback должен сигналить о провале save*
 * ============================================================ */

describe('audit-2 P1-2: applyStateBundle rollback ловит false от save*', () => {
    beforeEach(() => {
        installLocalStorage();
        storageMod.__resetStorageMode?.();
        store.setActiveCalc(null);
        store.setCalcList([]);
    });

    it('rollback после apply-failure с дополнительным failure внутри rollback → rollbackError выставлен', () => {
        /* 1. Готовим bundle с 2 новыми расчётами в нормальном storage. */
        calcListMod.createCalc('BUNDLE-A');
        calcListMod.createCalc('BUNDLE-B');
        const bundle = JSON.parse(JSON.stringify(bundleMod.buildStateBundle()));
        const bundleIds = bundle.calculations.map(c => c.id);

        /* 2. Готовим baseline calc в чистом storage. */
        installLocalStorage();
        storageMod.__resetStorageMode?.();
        store.setActiveCalc(null);
        store.setCalcList([]);
        const baseline = calcListMod.createCalc('BASELINE-RB');
        const baselineId = baseline.id;

        /* 3. Spy: переносим данные, quota на новые calc.<id> ИЛИ на любую
         *    запись calc.list (т.е. rollback тоже не сможет восстановить
         *    список). Делаем quota на calc.list (и больше ни на что). */
        const oldData = snapshotStorageData();
        const spy = installQuotaSpy({ passProbe: true });
        for (const [k, v] of Object.entries(oldData)) spy.data.set(k, v);
        storageMod.__resetStorageMode?.();

        /* Quota: первый из bundleIds (заваливаем apply) + calc.list (заваливаем rollback). */
        const failKeys = new Set([`calc.${bundleIds[0]}`, 'calc.list']);
        const origSet = spy.ls.setItem.bind(spy.ls);
        spy.ls.setItem = function (k, v) {
            if (failKeys.has(String(k))) {
                const err = new Error('QuotaExceededError');
                err.name = 'QuotaExceededError';
                throw err;
            }
            return origSet(k, v);
        };

        const r = bundleMod.applyStateBundle(bundle);

        assert.equal(r.ok, false, 'apply должен упасть');
        /* P1-2: rollback тоже частично провалился (calc.list не восстановлен)
         * → rollbackError ОБЯЗАН быть выставлен.
         * Раньше rollback тихо игнорировал false от saveCalcList. */
        assert.ok(
            typeof r.rollbackError === 'string' && r.rollbackError.length > 0,
            `P1-2: rollback не смог восстановить calc.list (quota на calc.list), ` +
            `rollbackError обязан быть выставлен. Получено: ${JSON.stringify(r)}`
        );
    });
});

/* ============================================================
 * P1-3 — applyOverrideToActiveCalc должен проверять commitActiveCalc
 * ============================================================ */

describe('audit-2 P1-3: applyOverrideToActiveCalc реагирует на сбой commitActiveCalc', () => {
    beforeEach(() => {
        installLocalStorage();
        storageMod.__resetStorageMode?.();
        store.setActiveCalc(null);
        store.setCalcList([]);
        store.setUi({ providerOverlayUpdate: {} });
    });

    it('quota на calc.<active.id> → ok=false, reason=persist (не silent ok:true)', () => {
        const calc = {
            id: 'active-p1-3', name: 'Active-P1-3', schemaVersion: 17,
            settings: { provider: 'sbercloud', applyRiskFactors: true },
            answers: {},
            dictionaries: {
                items: [{ id: 'cpu-vcpu-shared', pricePerUnit: 840, vendor: 'X', priceSource: 'old' }],
                questions: []
            },
            view: { disabledStands: [] },
            updatedAt: '2026-01-01T00:00:00.000Z'
        };
        persist.saveCalc(calc);
        persist.saveCalcList([{ id: calc.id, name: calc.name, updatedAt: calc.updatedAt }]);
        store.setActiveCalc(calc);

        const override = {
            schemaVersion: 1,
            providerId: 'sbercloud', version: '2026-Q3-audit2',
            timestamp: '2026-05-18T00:00:00.000Z', source: 'audit2',
            prices: { 'cpu-vcpu-shared': { pricePerUnit: 999, vendor: 'X', priceSource: 'new' } }
        };
        persist.saveProviderOverride('sbercloud', override);

        /* Перенос на spy + quota на calc.<active.id> и не на calc.providerOverlayOverrides. */
        const oldData = snapshotStorageData();
        const spy = installQuotaSpy({ passProbe: true });
        for (const [k, v] of Object.entries(oldData)) spy.data.set(k, v);
        storageMod.__resetStorageMode?.();
        const failKey = `calc.${calc.id}`;
        const origSet = spy.ls.setItem.bind(spy.ls);
        spy.ls.setItem = function (k, v) {
            if (String(k) === failKey) {
                const err = new Error('QuotaExceededError');
                err.name = 'QuotaExceededError';
                throw err;
            }
            return origSet(k, v);
        };

        const result = providerCtl.applyOverrideToActiveCalc();
        assert.equal(result.ok, false,
            'P1-3: при сбое commitActiveCalc функция должна вернуть ok=false, не silent ok:true');
        assert.equal(result.reason, 'persist',
            `P1-3: reason должен быть 'persist'. Получено: ${JSON.stringify(result)}`);
    });
});

/* ============================================================
 * P2-1 — importCalcFromFile должен проверять commitNewCalc
 * ============================================================ */

describe('audit-2 P2-1: importCalcFromFile реагирует на сбой commitNewCalc', () => {
    beforeEach(() => {
        installLocalStorage();
        storageMod.__resetStorageMode?.();
        store.setActiveCalc(null);
        store.setCalcList([]);
    });

    it('quota на calc.<imported.id> при импорте → ok=false, calc не активирован', async () => {
        /* Готовим valid calc-JSON для импорта (минимально полный для миграций+валидации). */
        const importedCalc = {
            id: 'imported-p2-1', name: 'Imported', version: '1.0',
            schemaVersion: 17,
            createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
            settings: {
                period: 'monthly', bufferTask: 0.3, bufferProject: 0.15,
                indexation: 0.1, currency: 'RUB', phaseDurationMonths: 6,
                applyRiskFactors: true,
                vatEnabled: true, vatRate: 0.22, vatRateMode: 'manual',
                vatEffectiveDate: '2026-05-01'
            },
            answers: {},
            dictionaries: { items: [], questions: [] },
            view: { disabledStands: [] }
        };

        /* Spy + quota на calc.<importedCalc.id>. */
        const spy = installQuotaSpy({ passProbe: true });
        storageMod.__resetStorageMode?.();
        const failKey = `calc.${importedCalc.id}`;
        const origSet = spy.ls.setItem.bind(spy.ls);
        spy.ls.setItem = function (k, v) {
            if (String(k) === failKey) {
                const err = new Error('QuotaExceededError');
                err.name = 'QuotaExceededError';
                throw err;
            }
            return origSet(k, v);
        };

        /* DI: подмена readJsonFile/pickFile через _options. */
        const result = await calcListMod.importCalcFromFile({
            _readJsonFile: async () => ({ data: importedCalc }),
            _pickFile: async () => ({ name: 'imported.json' })
        });
        assert.equal(result.ok, false,
            'P2-1: при сбое commitNewCalc importCalcFromFile должен вернуть ok=false');
        assert.equal(result.reason, 'persist',
            `P2-1: reason должен быть 'persist'. Получено: ${JSON.stringify(result)}`);

        /* Active calc id не должен сохраняться, если calc не записан. */
        assert.notEqual(
            persist.loadActiveCalcId(), importedCalc.id,
            'P2-1: activeCalcId не должен указывать на расчёт, которого нет в storage'
        );
    });
});

/* ============================================================
 * P2-2a — deleteCalc атомарность
 * ============================================================ */

describe('audit-2 P2-2a: deleteCalc — на сбое saveCalcList попытка восстановить', () => {
    beforeEach(() => {
        installLocalStorage();
        storageMod.__resetStorageMode?.();
        store.setActiveCalc(null);
        store.setCalcList([]);
    });

    it('quota на calc.list → деление возвращает signal через persistStatus (а не silent ok)', () => {
        const c = calcListMod.createCalc('To-Delete');
        const id = c.id;

        /* Перенос на spy + quota только на calc.list. */
        const oldData = snapshotStorageData();
        const spy = installQuotaSpy({ passProbe: true });
        for (const [k, v] of Object.entries(oldData)) spy.data.set(k, v);
        storageMod.__resetStorageMode?.();
        const origSet = spy.ls.setItem.bind(spy.ls);
        spy.ls.setItem = function (k, v) {
            if (String(k) === 'calc.list') {
                const err = new Error('QuotaExceededError');
                err.name = 'QuotaExceededError';
                throw err;
            }
            return origSet(k, v);
        };

        store.setPersistStatus('idle');
        calcListMod.deleteCalc(id);

        /* P2-2a: persistStatus обязан стать 'error' — пользователь должен
         * видеть индикатор сбоя, а не молчаливое UI-обновление. */
        assert.equal(store.getState().persistStatus, 'error',
            'P2-2a: при сбое saveCalcList в deleteCalc persistStatus должен быть error');
    });
});

/* ============================================================
 * P2-2b — resetToDefaults атомарность
 * ============================================================ */

describe('audit-2 P2-2b: resetToDefaults — sigнал об ошибке при сбое persist', () => {
    beforeEach(() => {
        installLocalStorage();
        storageMod.__resetStorageMode?.();
        store.setActiveCalc(null);
        store.setCalcList([]);
    });

    it('quota на calc.list при reset → persistStatus=error', () => {
        calcListMod.createCalc('Before-Reset');

        const oldData = snapshotStorageData();
        const spy = installQuotaSpy({ passProbe: true });
        for (const [k, v] of Object.entries(oldData)) spy.data.set(k, v);
        storageMod.__resetStorageMode?.();
        const origSet = spy.ls.setItem.bind(spy.ls);
        spy.ls.setItem = function (k, v) {
            if (String(k) === 'calc.list') {
                const err = new Error('QuotaExceededError');
                err.name = 'QuotaExceededError';
                throw err;
            }
            return origSet(k, v);
        };

        store.setPersistStatus('idle');
        calcListMod.resetToDefaults();
        assert.equal(store.getState().persistStatus, 'error',
            'P2-2b: при сбое saveCalcList в resetToDefaults persistStatus=error');
    });
});

/* ============================================================
 * P3-1 — syncDefaultDictionary signals failure
 * ============================================================ */

describe('audit-2 P3-1: syncDefaultDictionary при сбое поднимает persistStatus=error', () => {
    beforeEach(() => {
        installLocalStorage();
        storageMod.__resetStorageMode?.();
        store.setActiveCalc({
            id: 'p3-1', name: 'p3-1', schemaVersion: 17,
            settings: { applyRiskFactors: true, vatEnabled: true, vatRate: 0.22 },
            answers: {}, answersMeta: {},
            dictionaries: { items: [], questions: [] },
            view: {}
        });
    });

    it('itemController.saveItem: quota на calc.defaultDictionary → persistStatus=error', () => {
        const oldData = snapshotStorageData();
        const spy = installQuotaSpy({ passProbe: true });
        for (const [k, v] of Object.entries(oldData)) spy.data.set(k, v);
        storageMod.__resetStorageMode?.();
        const origSet = spy.ls.setItem.bind(spy.ls);
        spy.ls.setItem = function (k, v) {
            if (String(k) === 'calc.defaultDictionary') {
                const err = new Error('QuotaExceededError');
                err.name = 'QuotaExceededError';
                throw err;
            }
            return origSet(k, v);
        };

        store.setPersistStatus('idle');
        /* saveItem(item) вызывает syncDefaultDictionary({items}) в конце. */
        itemCtl.saveItem({
            id: 'p3-1-item', name: 'Test', unit: 'шт.',
            pricePerUnit: 100, category: 'HW',
            billingInterval: 'monthly', resourceClass: 'CPU',
            applicableStands: ['DEV', 'PROD'],
            qtyFormulas: { DEV: '1', PROD: '1' }
        });
        assert.equal(store.getState().persistStatus, 'error',
            'P3-1: при сбое saveDefaultDictionary persistStatus должен быть error');
    });
});

/* ============================================================
 * P3-2 — strict parseNumber rejects "100abc"
 * ============================================================ */

describe('audit-2 P3-2: parseNumber отвергает «числовой мусор»', () => {
    it('csvImport.parseNumber: "100abc" → NaN (не 100)', () => {
        const n = csvImportMod.parseNumber('100abc');
        assert.ok(Number.isNaN(n),
            `P3-2: csvImport.parseNumber должен отвергнуть "100abc", получено: ${n}. ` +
            `Раньше parseFloat возвращал 100 → опечатка в прайсе попадала как валидная цена.`);
    });

    it('csvImport.parseNumber: "12O" (буква О) → NaN', () => {
        const n = csvImportMod.parseNumber('12O');
        assert.ok(Number.isNaN(n), `Получено: ${n}`);
    });

    it('csvImport.parseNumber: "1,5" (RU-локаль) → 1.5 (регресс)', () => {
        const n = csvImportMod.parseNumber('1,5');
        assert.equal(n, 1.5);
    });

    it('csvImport.parseNumber: "1 000.5" (тысячи) → 1000.5 (регресс)', () => {
        const n = csvImportMod.parseNumber('1 000.5');
        assert.equal(n, 1000.5);
    });

    it('format.parseNumberInput: «100abc» → NaN', () => {
        const n = formatMod.parseNumberInput('100abc');
        assert.ok(Number.isNaN(n));
    });
});

/* ============================================================
 * P3-3 — validateCalculation проверяет range/min/max/options
 * ============================================================ */

describe('audit-2 P3-3: validateCalculation проверяет диапазон чисел и options select', () => {
    it('number-вопрос с min=0 max=100, ответ 999 → validation error', () => {
        const calc = {
            id: 'p3-3-range', name: 'Range', version: '1.0', schemaVersion: 17,
            createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
            settings: {
                period: 'monthly', bufferTask: 0.3, bufferProject: 0.15,
                indexation: 0.1, phaseDurationMonths: 6, applyRiskFactors: true,
                vatEnabled: true, vatRate: 0.22
            },
            answers: { dau_share_of_registered_percent: 999 },
            dictionaries: {
                items: [],
                questions: [{
                    id: 'dau_share_of_registered_percent',
                    section: 'business', title: 'DAU share %',
                    type: 'number', order: 100, min: 0, max: 100
                }]
            }
        };
        const errors = [];
        validationMod.validateCalculation(calc, errors);
        const rangeErr = errors.find(e =>
            e.path.includes('dau_share_of_registered_percent') && /диапазон|range|max|>/i.test(e.message)
        );
        assert.ok(rangeErr,
            `P3-3: range-валидация должна сработать. Получено errors: ${JSON.stringify(errors)}`);
    });

    it('select-вопрос с options=[a,b], ответ "c" → validation error', () => {
        const calc = {
            id: 'p3-3-opts', name: 'Opts', version: '1.0', schemaVersion: 17,
            createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
            settings: {
                period: 'monthly', bufferTask: 0.3, bufferProject: 0.15,
                indexation: 0.1, phaseDurationMonths: 6, applyRiskFactors: true,
                vatEnabled: true, vatRate: 0.22
            },
            answers: { q_select: 'c' },
            dictionaries: {
                items: [],
                questions: [{
                    id: 'q_select', section: 'business', title: 'Select',
                    type: 'select', order: 100,
                    options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]
                }]
            }
        };
        const errors = [];
        validationMod.validateCalculation(calc, errors);
        const optErr = errors.find(e =>
            e.path.includes('q_select') && /options|допустим|допуст|вне/i.test(e.message)
        );
        assert.ok(optErr,
            `P3-3: options-валидация должна сработать. Получено errors: ${JSON.stringify(errors)}`);
    });
});

/* ============================================================
 * P3-4 — CSP frame-ancestors 'none'
 * ============================================================ */

describe('audit-2 P3-4 (исправлено в audit-3): clickjacking-защита — через HTTP-заголовок, не через meta', () => {
    /* Внешний аудит #3 (2026-05-18, P3): frame-ancestors в <meta http-equiv>
     * по CSP-spec ИГНОРИРУЕТСЯ браузерами — только HTTP-заголовок работает.
     * Тест audit-2 проверял наличие строки в index.html → создавал ложную
     * уверенность. Новый контракт:
     *   (а) в index.html НЕТ frame-ancestors в meta (чтобы не вводить в
     *       заблуждение читающих исходник),
     *   (б) HOW_TO_START.md содержит инструкцию добавить заголовок на сервер. */
    it('index.html НЕ содержит frame-ancestors в meta (это не работает по spec)', () => {
        const indexHtml = readFileSync(join(__dirname, '..', '..', 'index.html'), 'utf8');
        /* meta-тег целиком (одна строка с http-equiv=Content-Security-Policy). */
        const metaMatch = indexHtml.match(/<meta[^>]+http-equiv\s*=\s*["']Content-Security-Policy["'][^>]*>/);
        assert.ok(metaMatch, 'meta CSP должен присутствовать');
        assert.ok(
            !/frame-ancestors/.test(metaMatch[0]),
            'P3-4 (audit-3): frame-ancestors в <meta> игнорируется браузером — ' +
            'не должно быть в meta, чтобы не создавать ложную уверенность. ' +
            'Защита настраивается HTTP-заголовком на сервере (см. HOW_TO_START.md).'
        );
    });

    it('HOW_TO_START.md содержит инструкцию для frame-ancestors HTTP-заголовка', () => {
        const howTo = readFileSync(join(__dirname, '..', '..', 'HOW_TO_START.md'), 'utf8');
        assert.ok(
            /frame-ancestors\s+'none'/.test(howTo),
            'HOW_TO_START.md должен содержать пример с frame-ancestors для веб-публикации'
        );
        assert.ok(
            /clickjacking/i.test(howTo) || /iframe/i.test(howTo),
            'HOW_TO_START.md должен объяснить, ОТ ЧЕГО защищает frame-ancestors'
        );
    });
});
