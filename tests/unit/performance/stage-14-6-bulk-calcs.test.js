/**
 * Stage 14.6 (PATCH 2.7.4) — Performance / Cross-tab / Stress tests для
 * `applyOverrideToAllCalcsForProvider`.
 *
 * Базовая функциональность bulk-apply покрыта в `provider-apply-to-all.test.js`
 * (Stage 8.5: happy path, mixed providers, already-fresh, error isolation,
 * active calc через store). Этот файл добавляет:
 *
 *   1. Stress: 100+ calc × 3 провайдера — bulk должен укладываться в perf-budget.
 *   2. Cross-tab guard: lock от другой вкладки → bulk отказывает (Stage 11.3).
 *   3. TTL auto-release: stale lock (старше 60s) игнорируется как мёртвый.
 *   4. F5-safety: после bulk persist → reload → все calc сохранили providerVersion.
 *   5. last-writer-wins: 2 последовательных bulk'а с разными override → финал = 2-й.
 *   6. Cross-provider isolation: bulk(sber) не трогает yandex calc'и.
 *   7. Re-run efficiency: повторный bulk → applied=0, alreadyFresh=N.
 *
 * Perf-budget — sanity-check, не регрессионный gate. Threshold 3000ms на
 * современном desktop; реальное время typical 50-200ms для 100 calc. Защита
 * от случайной O(N²) деградации в будущих рефакторингах.
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from '../../integration/storage-mock.js';

let providerCtl;
let store;
let persist;
let crossTab;
let constants;

const STRESS_BUDGET_MS = 3000;
const CALCS_PER_PROVIDER = 100;
const PROVIDERS_FOR_STRESS = ['sbercloud', 'yandex', 'vk'];

function makeOverride(providerId, version, prices = null) {
    return {
        schemaVersion: 1,
        providerId,
        version,
        timestamp: '2026-05-09T12:00:00.000Z',
        source: `stress fixture for ${providerId} ${version}`,
        prices: prices || {
            'cpu-vcpu-shared': { pricePerUnit: 1000, vendor: providerId, priceSource: `${providerId}/${version}` },
            'ram-gb':          { pricePerUnit: 300,  vendor: providerId, priceSource: `${providerId}/${version}` }
        }
    };
}

function makeCalc(id, providerId) {
    return {
        id,
        name: `Calc-${id}`,
        settings: { provider: providerId },
        answers: {},
        dictionaries: {
            items: [
                { id: 'cpu-vcpu-shared', pricePerUnit: 800, vendor: providerId, priceSource: `${providerId}/baseline` },
                { id: 'ram-gb',          pricePerUnit: 200, vendor: providerId, priceSource: `${providerId}/baseline` }
            ],
            questions: []
        },
        view: { disabledStands: [] },
        updatedAt: '2026-01-01T00:00:00.000Z'
    };
}

function seedCalcList(calcs) {
    persist.saveCalcList(calcs.map(c => ({
        id: c.id, name: c.name, updatedAt: c.updatedAt, totalMonthly: 0
    })));
    for (const c of calcs) persist.saveCalc(c);
}

before(async () => {
    installLocalStorage();
    /* sessionStorage shim для cross-tab tab-id persist'а. */
    if (typeof globalThis.sessionStorage === 'undefined') {
        const _m = new Map();
        globalThis.sessionStorage = {
            getItem: (k) => _m.has(k) ? _m.get(k) : null,
            setItem: (k, v) => _m.set(k, String(v)),
            removeItem: (k) => _m.delete(k),
            clear: () => _m.clear()
        };
    }
    providerCtl = await import('../../../js/controllers/providerController.js');
    ({ store } = await import('../../../js/state/store.js'));
    persist = await import('../../../js/state/persistence.js');
    crossTab = await import('../../../js/state/crossTabSync.js');
    constants = await import('../../../js/utils/constants.js');
});

beforeEach(() => {
    installLocalStorage();
    if (globalThis.sessionStorage?.clear) globalThis.sessionStorage.clear();
    crossTab._resetTabIdForTesting();
    store.setActiveCalc(null);
    store.setCalcList([]);
    store.setUi({ providerOverlayUpdate: {}, providerCrossTabLocks: {} });
});

describe('Stage 14.6 / stress: 100 calc × 3 провайдера', () => {
    it(`bulk-apply для ${CALCS_PER_PROVIDER} calc на одном провайдере укладывается в ${STRESS_BUDGET_MS}ms`, () => {
        persist.saveProviderOverride('sbercloud', makeOverride('sbercloud', '2026-Q3-stress'));
        const calcs = Array.from({ length: CALCS_PER_PROVIDER },
            (_, i) => makeCalc(`sber-${i}`, 'sbercloud'));
        seedCalcList(calcs);

        const t0 = Date.now();
        const result = providerCtl.applyOverrideToAllCalcsForProvider('sbercloud');
        const elapsed = Date.now() - t0;

        assert.equal(result.ok, true);
        assert.equal(result.applied, CALCS_PER_PROVIDER);
        assert.equal(result.alreadyFresh, 0);
        assert.deepEqual(result.errors, []);
        assert.ok(elapsed < STRESS_BUDGET_MS,
            `bulk-apply ${CALCS_PER_PROVIDER} calc занял ${elapsed}ms, бюджет ${STRESS_BUDGET_MS}ms`);
    });

    it(`bulk-apply последовательно для ${PROVIDERS_FOR_STRESS.length} провайдеров × ${CALCS_PER_PROVIDER} calc — корректно изолирует`, () => {
        for (const p of PROVIDERS_FOR_STRESS) {
            persist.saveProviderOverride(p, makeOverride(p, `2026-Q3-${p}`));
        }
        /* Перемешанный список: по 100 calc на каждого провайдера, общий 300. */
        const allCalcs = [];
        for (const p of PROVIDERS_FOR_STRESS) {
            for (let i = 0; i < CALCS_PER_PROVIDER; i++) {
                allCalcs.push(makeCalc(`${p}-${i}`, p));
            }
        }
        seedCalcList(allCalcs);

        const t0 = Date.now();
        const results = PROVIDERS_FOR_STRESS.map(p =>
            providerCtl.applyOverrideToAllCalcsForProvider(p));
        const elapsed = Date.now() - t0;

        for (const r of results) {
            assert.equal(r.ok, true);
            assert.equal(r.applied, CALCS_PER_PROVIDER,
                `Каждый bulk(${r.providerId}) должен применить ровно ${CALCS_PER_PROVIDER} calc своего провайдера, ${r.applied} получено`);
        }
        assert.ok(elapsed < STRESS_BUDGET_MS,
            `3 bulk-apply × ${CALCS_PER_PROVIDER} calc заняли ${elapsed}ms, бюджет ${STRESS_BUDGET_MS}ms`);

        /* Все 300 calc имеют свою providerVersion. */
        for (const p of PROVIDERS_FOR_STRESS) {
            for (let i = 0; i < CALCS_PER_PROVIDER; i++) {
                const stored = persist.loadCalc(`${p}-${i}`);
                assert.equal(stored.providerVersion?.version, `2026-Q3-${p}`);
            }
        }
    });

    it('повторный bulk на already-fresh calc'+"'"+'ах — applied=0, alreadyFresh=N (быстрый skip-path)', () => {
        persist.saveProviderOverride('sbercloud', makeOverride('sbercloud', '2026-Q3-stress'));
        const calcs = Array.from({ length: CALCS_PER_PROVIDER },
            (_, i) => makeCalc(`sber-${i}`, 'sbercloud'));
        seedCalcList(calcs);

        providerCtl.applyOverrideToAllCalcsForProvider('sbercloud');

        const t0 = Date.now();
        const second = providerCtl.applyOverrideToAllCalcsForProvider('sbercloud');
        const elapsed = Date.now() - t0;

        assert.equal(second.ok, true);
        assert.equal(second.applied, 0);
        assert.equal(second.alreadyFresh, CALCS_PER_PROVIDER);
        assert.ok(elapsed < STRESS_BUDGET_MS,
            `Повторный bulk должен быть как минимум не медленнее первого, ${elapsed}ms`);
    });
});

describe('Stage 14.6 / cross-tab guard: bulk-apply', () => {
    it('lock от другой вкладки → bulk отказывает с reason="locked-by-other-tab"', () => {
        persist.saveProviderOverride('sbercloud', makeOverride('sbercloud', 'v1'));
        seedCalcList([makeCalc('c1', 'sbercloud')]);

        /* Симулируем lock от другой вкладки: tabId, отличный от текущего, свежий. */
        crossTab._writeLockMapForTesting({
            sbercloud: { tabId: 'other-tab-uuid', startedAt: new Date().toISOString() }
        });

        const result = providerCtl.applyOverrideToAllCalcsForProvider('sbercloud');
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'locked-by-other-tab');

        /* Calc не получил override (bulk был отвергнут). */
        const stored = persist.loadCalc('c1');
        assert.equal(stored.providerVersion, undefined);
    });

    it('stale lock (старше TTL) игнорируется — bulk проходит', () => {
        persist.saveProviderOverride('sbercloud', makeOverride('sbercloud', 'v1'));
        seedCalcList([makeCalc('c1', 'sbercloud')]);

        /* startedAt = now - TTL - 1s → lock мёртвый. */
        const staleStart = new Date(Date.now() - constants.PROVIDER_TAB_LOCK_TTL_MS - 1000).toISOString();
        crossTab._writeLockMapForTesting({
            sbercloud: { tabId: 'crashed-tab-uuid', startedAt: staleStart }
        });

        const result = providerCtl.applyOverrideToAllCalcsForProvider('sbercloud');
        assert.equal(result.ok, true);
        assert.equal(result.applied, 1);

        const stored = persist.loadCalc('c1');
        assert.equal(stored.providerVersion?.version, 'v1');
    });

    it('lock другой вкладки на ДРУГОМ провайдере — не блокирует bulk на нашем', () => {
        persist.saveProviderOverride('sbercloud', makeOverride('sbercloud', 'v1'));
        seedCalcList([makeCalc('c1', 'sbercloud')]);

        crossTab._writeLockMapForTesting({
            yandex: { tabId: 'other-tab-uuid', startedAt: new Date().toISOString() }
        });

        const result = providerCtl.applyOverrideToAllCalcsForProvider('sbercloud');
        assert.equal(result.ok, true);
        assert.equal(result.applied, 1);
    });
});

describe('Stage 14.6 / F5-safety: persist round-trip после bulk', () => {
    it('после bulk все calc восстановлены с providerVersion при reload через loadCalc', () => {
        persist.saveProviderOverride('sbercloud', makeOverride('sbercloud', '2026-Q3-fix'));
        const calcs = Array.from({ length: 20 },
            (_, i) => makeCalc(`c${i}`, 'sbercloud'));
        seedCalcList(calcs);

        providerCtl.applyOverrideToAllCalcsForProvider('sbercloud');

        /* Симулируем F5: контроллер не нужен, читаем из persist напрямую (это
           то, что делал бы initFromStorage / openCalc после reload). */
        for (let i = 0; i < 20; i++) {
            const reloaded = persist.loadCalc(`c${i}`);
            assert.equal(reloaded.providerVersion?.version, '2026-Q3-fix');
            assert.equal(reloaded.providerVersion?.id, 'sbercloud');
            const cpu = reloaded.dictionaries.items.find(it => it.id === 'cpu-vcpu-shared');
            assert.equal(cpu.pricePerUnit, 1000, 'pricePerUnit обновлён из override');
            /* Внешний аудит #3 (2026-05-18, P1): priceSource нормализуется к
             * 'provider' (контракт валидатора), оригинал — в priceSourceRef. */
            assert.equal(cpu.priceSource, 'provider', 'priceSource нормализован');
            assert.equal(cpu.priceSourceRef, 'sbercloud/2026-Q3-fix',
                'оригинальный ref сохранён в priceSourceRef');
        }
    });

    it('активный calc после bulk → store + persist синхронны (F5 → state совпадает с store до F5)', () => {
        persist.saveProviderOverride('sbercloud', makeOverride('sbercloud', 'v1'));
        const c1 = makeCalc('c1', 'sbercloud');
        seedCalcList([c1]);
        store.setActiveCalc(c1);

        providerCtl.applyOverrideToAllCalcsForProvider('sbercloud');

        const inStore = store.getState().activeCalc;
        const inPersist = persist.loadCalc('c1');

        assert.equal(inStore.providerVersion?.version, 'v1');
        assert.equal(inPersist.providerVersion?.version, 'v1',
            'persist должен совпадать со store после bulk-apply активного calc');
        const inStoreCpu = inStore.dictionaries.items.find(it => it.id === 'cpu-vcpu-shared');
        const inPersistCpu = inPersist.dictionaries.items.find(it => it.id === 'cpu-vcpu-shared');
        assert.equal(inStoreCpu.pricePerUnit, inPersistCpu.pricePerUnit);
    });
});

describe('Stage 14.6 / last-writer-wins: последовательные bulk', () => {
    it('два bulk последовательно с разными override → финал = последний override', () => {
        const calcs = Array.from({ length: 10 }, (_, i) => makeCalc(`c${i}`, 'sbercloud'));
        seedCalcList(calcs);

        /* Bulk 1: override v1. */
        persist.saveProviderOverride('sbercloud', makeOverride('sbercloud', 'v1', {
            'cpu-vcpu-shared': { pricePerUnit: 100, vendor: 'sber', priceSource: 'sber/v1' },
            'ram-gb':          { pricePerUnit: 50,  vendor: 'sber', priceSource: 'sber/v1' }
        }));
        const r1 = providerCtl.applyOverrideToAllCalcsForProvider('sbercloud');
        assert.equal(r1.applied, 10);

        /* Bulk 2: override v2 — overwrite предыдущего. */
        persist.saveProviderOverride('sbercloud', makeOverride('sbercloud', 'v2', {
            'cpu-vcpu-shared': { pricePerUnit: 200, vendor: 'sber', priceSource: 'sber/v2' },
            'ram-gb':          { pricePerUnit: 75,  vendor: 'sber', priceSource: 'sber/v2' }
        }));
        const r2 = providerCtl.applyOverrideToAllCalcsForProvider('sbercloud');
        assert.equal(r2.applied, 10, 'все 10 calc должны быть переприменены на v2');

        for (let i = 0; i < 10; i++) {
            const stored = persist.loadCalc(`c${i}`);
            assert.equal(stored.providerVersion?.version, 'v2');
            const cpu = stored.dictionaries.items.find(it => it.id === 'cpu-vcpu-shared');
            assert.equal(cpu.pricePerUnit, 200,
                'Cпоследняя версия override побеждает (last-writer-wins)');
        }
    });
});

describe('Stage 14.6 / cross-provider isolation в смешанном calcList', () => {
    it('bulk(sber) при 50 sber + 50 yandex → ровно 50 sber обновлено, yandex без изменений', () => {
        persist.saveProviderOverride('sbercloud', makeOverride('sbercloud', 'sber-v1'));
        persist.saveProviderOverride('yandex', makeOverride('yandex', 'ya-v1'));

        const sberCalcs = Array.from({ length: 50 }, (_, i) => makeCalc(`s${i}`, 'sbercloud'));
        const yaCalcs   = Array.from({ length: 50 }, (_, i) => makeCalc(`y${i}`, 'yandex'));
        seedCalcList([...sberCalcs, ...yaCalcs]);

        const result = providerCtl.applyOverrideToAllCalcsForProvider('sbercloud');
        assert.equal(result.applied, 50);

        for (let i = 0; i < 50; i++) {
            const sber = persist.loadCalc(`s${i}`);
            assert.equal(sber.providerVersion?.version, 'sber-v1');
            const ya = persist.loadCalc(`y${i}`);
            assert.equal(ya.providerVersion, undefined,
                'yandex calc должен остаться без providerVersion после bulk(sber)');
        }
    });
});

describe('Stage 14.6 / edge cases', () => {
    it('пустой calcList → ok=true, applied=0, alreadyFresh=0, errors=[]', () => {
        persist.saveProviderOverride('sbercloud', makeOverride('sbercloud', 'v1'));
        const result = providerCtl.applyOverrideToAllCalcsForProvider('sbercloud');
        assert.equal(result.ok, true);
        assert.equal(result.applied, 0);
        assert.equal(result.alreadyFresh, 0);
        assert.deepEqual(result.errors, []);
    });

    it('calc list содержит meta для несуществующего calc — пропускается без падения', () => {
        persist.saveProviderOverride('sbercloud', makeOverride('sbercloud', 'v1'));
        /* Meta есть в списке, но persist.loadCalc('orphan') вернёт null. */
        persist.saveCalcList([
            { id: 'real', name: 'Real', updatedAt: '2026-01-01', totalMonthly: 0 },
            { id: 'orphan', name: 'Orphan', updatedAt: '2026-01-01', totalMonthly: 0 }
        ]);
        persist.saveCalc(makeCalc('real', 'sbercloud'));

        const result = providerCtl.applyOverrideToAllCalcsForProvider('sbercloud');
        assert.equal(result.applied, 1, 'real calc применён');
        const real = persist.loadCalc('real');
        assert.equal(real.providerVersion?.version, 'v1');
    });

    it('bulk сохраняет items.length и id-ссылки (только pricePerUnit меняется)', () => {
        persist.saveProviderOverride('sbercloud', makeOverride('sbercloud', 'v1'));
        const c = makeCalc('c1', 'sbercloud');
        const originalLen = c.dictionaries.items.length;
        const originalIds = c.dictionaries.items.map(it => it.id).sort();
        seedCalcList([c]);

        providerCtl.applyOverrideToAllCalcsForProvider('sbercloud');

        const stored = persist.loadCalc('c1');
        assert.equal(stored.dictionaries.items.length, originalLen,
            'количество items не должно меняться');
        assert.deepEqual(
            stored.dictionaries.items.map(it => it.id).sort(),
            originalIds,
            'набор item.id должен сохраниться'
        );
    });
});
