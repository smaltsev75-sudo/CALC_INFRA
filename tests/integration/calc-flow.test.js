import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from './storage-mock.js';

// Установить mock localStorage ДО импорта модулей, использующих storage.
installLocalStorage();

const { store } = await import('../../js/state/store.js');
const calcList = await import('../../js/controllers/calcListController.js');
const calc = await import('../../js/controllers/calcController.js');
const itemCtl = await import('../../js/controllers/itemController.js');
const questionCtl = await import('../../js/controllers/questionController.js');
const persist = await import('../../js/state/persistence.js');
const { calculate, clearCalculationCache } = await import('../../js/domain/calculator.js');

beforeEach(() => {
    installLocalStorage();
    store.setActiveCalc(null);
    store.setCalcList([]);
    clearCalculationCache();
});

describe('Сценарий: создание расчёта и заполнение опросника', () => {
    it('создаёт расчёт, активный', () => {
        const c = calcList.createCalc('Тестовый');
        assert.ok(c.id);
        assert.equal(c.name, 'Тестовый');
        assert.equal(store.getState().activeCalc.id, c.id);
    });

    it('новый расчёт содержит seed-справочники', () => {
        const c = calcList.createCalc();
        assert.ok(c.dictionaries.items.length > 5);
        assert.ok(c.dictionaries.questions.length > 5);
    });

    it('списочный расчёт виден в calcList после refresh', () => {
        calcList.createCalc('A');
        const list = store.getState().calcList;
        assert.equal(list.length, 1);
    });

    it('расчёт переживает перезагрузку (store.set null + initFromStorage)', () => {
        const c = calcList.createCalc('Persist');
        store.setActiveCalc(null);
        calcList.initFromStorage();
        assert.equal(store.getState().activeCalc.id, c.id);
    });

    it('ответ на вопрос меняет qty в итоговом расчёте', () => {
        // ВАЖНО: в seed все pricePerUnit=0, поэтому totalMonthly остаётся 0
        // даже при изменении ответов. Проверяем что qty конкретного ЭК меняется.
        calcList.createCalc();
        const r1 = calculate(store.getState().activeCalc);
        const qty1 = r1.items['cpu-vcpu-shared']?.stands?.PROD?.qty ?? 0;
        calc.setAnswer('peak_rps', 200);
        calc.setAnswer('microservices_count', 10);
        const r2 = calculate(store.getState().activeCalc);
        const qty2 = r2.items['cpu-vcpu-shared']?.stands?.PROD?.qty ?? 0;
        assert.ok(qty2 > qty1,
            `peak_rps=200, microservices=10 должно дать больше vCPU. qty1=${qty1}, qty2=${qty2}`);
    });
});

describe('Сценарий: CRUD ЭК', () => {
    it('создание нового ЭК', () => {
        calcList.createCalc();
        const newItem = {
            id: 'test-x', name: 'Test', unit: 'шт.', pricePerUnit: 1000,
            category: 'HW', billingInterval: 'monthly', resourceClass: 'CPU',
            vendor: '', description: '',
            applicableStands: ['PROD'],
            qtyFormulas: { DEV: '', IFT: '', PSI: '', PROD: '5', LOAD: '' },
            formulaHelp: ''
        };
        const r = itemCtl.saveItem(newItem);
        assert.equal(r.ok, true, JSON.stringify(r.errors || {}));
        const items = store.getState().activeCalc.dictionaries.items;
        assert.ok(items.some(i => i.id === 'test-x'));
    });

    it('сохранение невалидного ЭК возвращает ошибки', () => {
        calcList.createCalc();
        const r = itemCtl.saveItem({ id: '', name: '' });
        assert.equal(r.ok, false);
        assert.ok(r.errors.length > 0);
    });

    it('удаление ЭК убирает из справочника', () => {
        calcList.createCalc();
        const id = store.getState().activeCalc.dictionaries.items[0].id;
        itemCtl.deleteItem(id);
        const items = store.getState().activeCalc.dictionaries.items;
        assert.ok(!items.some(i => i.id === id));
    });

    it('дублирование создаёт копию с новым id', () => {
        calcList.createCalc();
        const src = store.getState().activeCalc.dictionaries.items[0];
        /* После аудита #8 (2026-05-18) duplicateItem возвращает
         * { ok, id?, reason?, message? } вместо голого id. */
        const res = itemCtl.duplicateItem(src.id);
        assert.equal(res.ok, true);
        assert.notEqual(res.id, src.id);
        const items = store.getState().activeCalc.dictionaries.items;
        const copy = items.find(i => i.id === res.id);
        assert.ok(copy);
        assert.match(copy.name, /\(копия\)/);
    });
});

describe('Сценарий: CRUD вопросов', () => {
    it('создание нового вопроса', () => {
        calcList.createCalc();
        const r = questionCtl.saveQuestion({
            id: 'q_test', section: 'business', title: 'Test?',
            type: 'number', defaultValue: 5, order: 99
        });
        assert.equal(r.ok, true);
    });

    it('новый вопрос автоматически получает дефолтный ответ', () => {
        calcList.createCalc();
        questionCtl.saveQuestion({
            id: 'q_auto', section: 'business', title: 'Auto?',
            type: 'number', defaultValue: 42, order: 99
        });
        assert.equal(store.getState().activeCalc.answers.q_auto, 42);
    });

    it('удаление вопроса убирает и ответ', () => {
        calcList.createCalc();
        questionCtl.deleteQuestion('peak_rps');
        assert.ok(!('peak_rps' in store.getState().activeCalc.answers));
    });

    it('дублирование вопроса с новым id', () => {
        calcList.createCalc();
        /* После аудита #8 (2026-05-18) duplicateQuestion возвращает
         * { ok, id?, reason?, message? } вместо голого id. */
        const res = questionCtl.duplicateQuestion('peak_rps');
        assert.equal(res.ok, true);
        const qs = store.getState().activeCalc.dictionaries.questions;
        assert.ok(qs.some(q => q.id === res.id));
        assert.match(qs.find(q => q.id === res.id).title, /\(копия\)/);
    });
});

describe('Сценарий: расчёт стабилен через persist+reload', () => {
    it('сохранение → загрузка → тот же результат', () => {
        const c1 = calcList.createCalc();
        calc.setAnswer('pcu', 50);
        const before = calculate(store.getState().activeCalc).totalMonthly;

        // Симулируем перезагрузку
        store.setActiveCalc(null);
        clearCalculationCache();
        calcList.openCalc(c1.id);

        const after = calculate(store.getState().activeCalc).totalMonthly;
        assert.equal(before, after);
    });
});

describe('Сценарий: коэффициенты влияют пропорционально', () => {
    it('увеличение задачного буфера увеличивает costFinal ЭК (с искусственной ценой)', () => {
        // В seed все pricePerUnit=0; чтобы тест был осмысленным, сначала добавляем
        // новый ЭК с ценой и формулой '1', и меряем эффект буфера на нём.
        calcList.createCalc();
        const ok = itemCtl.saveItem({
            id: 'buf-probe', name: 'Probe', unit: 'шт', pricePerUnit: 1000,
            category: 'HW', billingInterval: 'monthly', resourceClass: 'CPU',
            vendor: '', description: '',
            applicableStands: ['PROD'],
            qtyFormulas: { DEV: '', IFT: '', PSI: '', PROD: '1', LOAD: '' },
            formulaHelp: ''
        });
        assert.equal(ok.ok, true);

        // Зануляем все коэффициенты, чтобы видеть эффект только bufferTask.
        calc.setSetting('bufferTask', 0);
        calc.setSetting('bufferProject', 0);
        calc.setSetting('kInflation', 0);
        calc.setSetting('kSeasonal', 0);
        calc.setSetting('kScheduleShift', 0);
        calc.setSetting('kContingency', 0);
        calc.setSetting('vatEnabled', false);

        const t0 = calculate(store.getState().activeCalc).items['buf-probe'].stands.PROD.costFinal;
        calc.setSetting('bufferTask', 0.5);
        const t1 = calculate(store.getState().activeCalc).items['buf-probe'].stands.PROD.costFinal;
        assert.ok(Math.abs(t1 - t0 * 1.5) < 0.01,
            `t0=${t0}, t1=${t1}, ожидалось t1 = t0 * 1.5`);
    });
});

describe('Сценарий: revision-кэш переиспользуется при идентичных revision', () => {
    it('повторный calculate с тем же revision возвращает тот же объект', () => {
        calcList.createCalc();
        const calcObj = store.getState().activeCalc;
        const rev = store.getState().calcRevision;
        const r1 = calculate(calcObj, rev);
        const r2 = calculate(calcObj, rev);
        assert.equal(r1, r2);
    });
    it('изменение state инкрементирует revision', () => {
        calcList.createCalc();
        const r0 = store.getState().calcRevision;
        calc.setAnswer('pcu', 99);
        const r1 = store.getState().calcRevision;
        assert.ok(r1 > r0);
    });
});

describe('Сценарий: миграция legacy JSON', () => {
    it('импорт расчёта со старым phase_duration_months → переезжает в settings', async () => {
        const { migrateCalculation } = await import('../../js/state/migrations.js');
        const legacy = {
            id: 'leg', name: 'L', version: '1.0',
            settings: { period: 'monthly', bufferTask: 0.3, bufferProject: 0.15, indexation: 0.1, currency: 'RUB' },
            answers: { phase_duration_months: 6, pcu: 50 },
            dictionaries: { items: [], questions: [] },
            createdAt: '2026', updatedAt: '2026'
        };
        const migrated = migrateCalculation(legacy);
        assert.equal(migrated.settings.phaseDurationMonths, 6);
        assert.equal(migrated.answers.pcu, 50);
        assert.ok(!('phase_duration_months' in migrated.answers));
    });

    it('initFromStorage переписывает legacy v1 calc как v2 в storage (10.2.2)', async () => {
        // Кладём в localStorage legacy расчёт с устаревшей schemaVersion=1
        // (или 0/undefined). После initFromStorage он должен быть переписан
        // как мигрированный — F5 не должен оставлять calc с устаревшей версией.
        const { CURRENT_SCHEMA_VERSION } = await import('../../js/utils/constants.js');
        const legacyId = 'legacy-init-1';
        const legacy = {
            id: legacyId,
            name: 'Legacy',
            version: '1.0',
            schemaVersion: 0,
            settings: {
                period: 'monthly',
                bufferTask: 0.3,
                bufferProject: 0.15,
                indexation: 0.1,
                currency: 'RUB'
            },
            answers: { phase_duration_months: 6 },
            dictionaries: { items: [], questions: [] },
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z'
        };

        // Сохраняем напрямую через persist — имитируем ситуацию «приложение
        // открыли впервые после обновления, в storage лежит старый расчёт».
        persist.saveCalc(legacy);
        persist.saveCalcList([{ id: legacyId, name: 'Legacy', updatedAt: legacy.updatedAt }]);
        persist.saveActiveCalcId(legacyId);

        calcList.initFromStorage();

        // 1. В store лежит мигрированный calc — schemaVersion = CURRENT.
        const active = store.getState().activeCalc;
        assert.ok(active, 'activeCalc должен быть установлен');
        assert.equal(active.id, legacyId);
        assert.equal(active.schemaVersion, CURRENT_SCHEMA_VERSION,
            'после миграции в store должна быть текущая версия схемы');

        // 2. В localStorage расчёт переписан — повторная миграция при следующем boot не нужна.
        const reloaded = persist.loadCalc(legacyId);
        assert.ok(reloaded, 'calc должен остаться в storage');
        assert.equal(reloaded.schemaVersion, CURRENT_SCHEMA_VERSION,
            'storage должен содержать мигрированную версию (10.2.2)');
        // Проверяем, что миграция реально отработала: phaseDurationMonths
        // из v0→v1 переехал в settings, а phase_duration_months удалён из ответов.
        assert.equal(reloaded.settings.phaseDurationMonths, 6);
        assert.ok(!('phase_duration_months' in reloaded.answers));
    });
});

describe('Сценарий: importCalcFromFile — duplicate id (Этап 11.1.4)', () => {
    // Утилита: собираем минимально валидный calc для импорта.
    // Поскольку validateCalculation требует наличия dictionaries — берём
    // справочник из свежесозданного расчёта и реюзаем (это соответствует
    // реальному JSON-файлу, который пользователь экспортирует/импортирует).
    function makeImportable(id, name) {
        const tmp = calcList.createCalc('seed-source');
        const exported = JSON.parse(JSON.stringify(tmp));
        exported.id = id;
        exported.name = name;
        // Очищаем активный, чтобы тест начинал с чистого state.
        store.setActiveCalc(null);
        // Удаляем seed-source из storage, чтобы не путал ассерты на размер списка.
        calcList.deleteCalc(tmp.id);
        return exported;
    }

    it('повторный импорт того же id без onDuplicate → reason=duplicate', async () => {
        const calcA = makeImportable('dup-id-1', 'Расчёт A');
        // Первый импорт — обычный путь, расчёт оседает в storage.
        const r1 = await calcList.importCalcFromFile({ preloaded: calcA });
        assert.equal(r1.ok, true, 'первый импорт должен пройти');
        assert.equal(r1.calc.id, 'dup-id-1');

        // Второй импорт того же id — должен вернуть duplicate.
        const calcB = makeImportable('dup-id-1', 'Расчёт A (обновлённый)');
        // makeImportable удалил calcA — восстанавливаем для чистоты теста.
        await calcList.importCalcFromFile({ preloaded: calcA });

        const r2 = await calcList.importCalcFromFile({ preloaded: calcB });
        assert.equal(r2.ok, false);
        assert.equal(r2.reason, 'duplicate');
        assert.equal(r2.existingId, 'dup-id-1');
        assert.equal(r2.importedName, 'Расчёт A (обновлённый)');
        assert.ok(r2.preloaded, 'preloaded должен прокидываться обратно для повторного вызова');
        // existingName приходит из текущего состояния storage (имя сохранённого расчёта).
        assert.equal(r2.existingName, 'Расчёт A');
    });

    it('onDuplicate="replace" → существующий перезаписан, id тот же, в списке одна запись', async () => {
        const calcA = makeImportable('dup-id-2', 'Старое имя');
        await calcList.importCalcFromFile({ preloaded: calcA });

        // Перезаписываем тем же id, но с другим именем.
        const calcB = makeImportable('dup-id-2', 'Новое имя');
        // makeImportable удалил calcA — восстанавливаем.
        await calcList.importCalcFromFile({ preloaded: calcA });

        const r = await calcList.importCalcFromFile({
            preloaded: calcB,
            onDuplicate: 'replace'
        });
        assert.equal(r.ok, true);
        assert.equal(r.replaced, true, 'replaced=true, чтобы UI показал «обновлён», а не «загружен»');
        assert.equal(r.calc.id, 'dup-id-2', 'id не должен меняться при replace');
        assert.equal(r.calc.name, 'Новое имя');

        // В storage — мы не плодим дубликаты в списке.
        const list = persist.loadCalcList().filter(m => m.id === 'dup-id-2');
        assert.equal(list.length, 1, 'в списке должна быть ровно одна запись с этим id');
        assert.equal(list[0].name, 'Новое имя');

        // Сам calc перезаписан.
        const stored = persist.loadCalc('dup-id-2');
        assert.equal(stored.name, 'Новое имя');
    });

    it('onDuplicate="clone" → новый uuid, в списке две записи', async () => {
        const calcA = makeImportable('dup-id-3', 'Original');
        await calcList.importCalcFromFile({ preloaded: calcA });

        const calcB = makeImportable('dup-id-3', 'Clone-source');
        await calcList.importCalcFromFile({ preloaded: calcA });

        const r = await calcList.importCalcFromFile({
            preloaded: calcB,
            onDuplicate: 'clone'
        });
        assert.equal(r.ok, true);
        assert.notEqual(r.calc.id, 'dup-id-3', 'clone должен присвоить новый uuid');
        assert.equal(r.calc.name, 'Clone-source');

        // Оригинал на месте, клон — отдельной записью.
        const original = persist.loadCalc('dup-id-3');
        assert.ok(original, 'оригинал не должен быть тронут');
        assert.equal(original.name, 'Original');

        const cloned = persist.loadCalc(r.calc.id);
        assert.ok(cloned);
        assert.equal(cloned.name, 'Clone-source');

        const list = persist.loadCalcList();
        const ids = list.map(m => m.id);
        assert.ok(ids.includes('dup-id-3'), 'оригинал в списке');
        assert.ok(ids.includes(r.calc.id), 'клон в списке');
    });
});

describe('Сценарий: сброс приложения возвращает чистое состояние', () => {
    it('после reset активного расчёта нет, calcList пуст', () => {
        calcList.createCalc('A');
        calcList.createCalc('B');
        calcList.resetToDefaults();
        const st = store.getState();
        assert.equal(st.activeCalc, null);
        assert.equal(st.calcList.length, 0);
    });
    it('после reset справочник по умолчанию восстанавливается', () => {
        calcList.createCalc();
        // Удаляем все ЭК
        const items = [...store.getState().activeCalc.dictionaries.items];
        for (const it of items) itemCtl.deleteItem(it.id);
        calcList.resetToDefaults();
        // Создадим новый — должен опять иметь полный seed
        const c = calcList.createCalc();
        assert.ok(c.dictionaries.items.length > 5);
    });
});
