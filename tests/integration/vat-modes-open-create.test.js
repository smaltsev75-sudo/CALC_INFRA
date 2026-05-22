/**
 * Stage VAT-1 Phase 3 — integration: VAT modes через openCalc / createCalc.
 *
 * Покрывает 10 пунктов Phase 3 spec:
 *   1. openCalc auto-by-date, vatEffectiveDate=2024-06-01 → vatRate=0.20
 *   2. openCalc auto-by-date, vatEffectiveDate=2026-04-01 → vatRate=0.22
 *   3. openCalc auto-by-date, effectiveDate=null + createdAt=2025-06-01 → 0.20
 *   4. openCalc auto-by-date, effectiveDate=null + без createdAt → currentVAT
 *   5. openCalc frozen vatRate=0.20 → остаётся 0.20
 *   6. openCalc manual vatRate=0.25 → остаётся 0.25
 *   7. цена 100 + vatEnabled + auto 2026 → итог использует 22%
 *   8. цена 100 + vatEnabled + frozen 20% → итог использует 20%
 *   9. createCalc → новый расчёт получает auto-by-date + today + currentVAT
 *  10. Legacy 20% после миграции + openCalc → сумма НЕ изменилась
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from './storage-mock.js';

installLocalStorage();

const { store } = await import('../../js/state/store.js');
const calcList = await import('../../js/controllers/calcListController.js');
const persist = await import('../../js/state/persistence.js');
const { calculate, clearCalculationCache } = await import('../../js/domain/calculator.js');
const { getCurrentVatRate, todayIso } = await import('../../js/domain/vatRateTable.js');

beforeEach(() => {
    installLocalStorage();
    store.setActiveCalc(null);
    store.setCalcList([]);
    clearCalculationCache();
});

/* Сохранить v17-форму calc прямо в storage, минуя createCalc — нужно для
   симуляции «calc уже был сохранён в режиме X, теперь его открываем». */
function persistRawCalc(calc) {
    persist.saveCalc(calc);
    const list = persist.loadCalcList() || [];
    list.push({ id: calc.id, name: calc.name, updatedAt: calc.updatedAt });
    persist.saveCalcList(list);
}

function v17Calc({ id, vatRateMode, vatRate, vatEffectiveDate, createdAt }) {
    return {
        version: '1.0',
        id,
        name: `vat-test-${id}`,
        schemaVersion: 17,
        createdAt: createdAt !== undefined ? createdAt : '2026-04-01T10:00:00Z',
        updatedAt: '2026-05-12T10:00:00Z',
        settings: {
            provider: 'sbercloud',
            providerSetByWizard: false,
            vatEnabled: true,
            vatRate,
            vatRateMode,
            vatEffectiveDate: vatEffectiveDate !== undefined ? vatEffectiveDate : null,
            applyRiskFactors: false,
            planningHorizonYears: 1,
            phaseDurationMonths: 6,
            daysPerMonth: 30,
            standSizeRatio: { DEV: 0.16, IFT: 0.40, PSI: 0.50, LOAD: 0.80, PROD: 1.0 },
            bufferTask: 0, bufferProject: 0,
            kInflation: 0, kSeasonal: 0, kScheduleShift: 0, kContingency: 0
        },
        answers: {},
        wizard: null,
        answersMeta: {},
        view: { disabledStands: [] },
        dictionaries: { items: [], questions: [], categories: [] },
        scenarios: [{ id: 'scen-0', label: 'Базовый', wizard: null, answers: {}, answersMeta: {} }],
        activeScenarioId: 'scen-0'
    };
}

/* ---------- openCalc: 6 mode-сценариев ---------- */

describe('Phase 3 openCalc: auto-by-date пересчитывает vatRate', () => {
    it('(1) auto, vatEffectiveDate=2024-06-01 → vatRate=0.20', () => {
        persistRawCalc(v17Calc({
            id: 'auto-2024',
            vatRateMode: 'auto-by-date',
            vatRate: 0.20,
            vatEffectiveDate: '2024-06-01',
            createdAt: '2024-06-01T10:00:00Z'
        }));
        const calc = calcList.openCalc('auto-2024');
        assert.equal(calc.settings.vatRateMode, 'auto-by-date');
        assert.equal(calc.settings.vatRate, 0.20);
        assert.equal(calc.settings.vatEffectiveDate, '2024-06-01');
    });

    it('(2) auto, vatEffectiveDate=2026-04-01 → vatRate=0.22', () => {
        persistRawCalc(v17Calc({
            id: 'auto-2026',
            vatRateMode: 'auto-by-date',
            vatRate: 0.22,
            vatEffectiveDate: '2026-04-01',
            createdAt: '2026-04-01T10:00:00Z'
        }));
        const calc = calcList.openCalc('auto-2026');
        assert.equal(calc.settings.vatRate, 0.22);
        assert.equal(calc.settings.vatEffectiveDate, '2026-04-01');
    });

    it('(3) auto, vatEffectiveDate=null + createdAt=2025-06-01 → effective=2025-06-01, vatRate=0.20', () => {
        persistRawCalc(v17Calc({
            id: 'auto-fallback-created',
            vatRateMode: 'auto-by-date',
            vatRate: 0.20,
            vatEffectiveDate: null,
            createdAt: '2025-06-01T10:00:00Z'
        }));
        const calc = calcList.openCalc('auto-fallback-created');
        assert.equal(calc.settings.vatEffectiveDate, '2025-06-01');
        assert.equal(calc.settings.vatRate, 0.20);
    });

    it('(4) auto, vatEffectiveDate=null + без createdAt → effective=today, vatRate=current', () => {
        persistRawCalc(v17Calc({
            id: 'auto-no-meta',
            vatRateMode: 'auto-by-date',
            vatRate: 0.22,
            vatEffectiveDate: null,
            createdAt: null
        }));
        const calc = calcList.openCalc('auto-no-meta');
        assert.equal(calc.settings.vatEffectiveDate, todayIso());
        assert.equal(calc.settings.vatRate, getCurrentVatRate());
    });
});

describe('Phase 3 openCalc: frozen / manual НЕ трогаются', () => {
    it('(5) frozen vatRate=0.20 → остаётся 0.20 даже после open в 2026', () => {
        persistRawCalc(v17Calc({
            id: 'frozen-20',
            vatRateMode: 'frozen',
            vatRate: 0.20,
            vatEffectiveDate: '2024-06-01',
            createdAt: '2024-06-01T10:00:00Z'
        }));
        const calc = calcList.openCalc('frozen-20');
        assert.equal(calc.settings.vatRateMode, 'frozen');
        assert.equal(calc.settings.vatRate, 0.20);
        assert.equal(calc.settings.vatEffectiveDate, '2024-06-01');
    });

    it('(6) manual vatRate=0.25 → остаётся 0.25', () => {
        persistRawCalc(v17Calc({
            id: 'manual-25',
            vatRateMode: 'manual',
            vatRate: 0.25,
            vatEffectiveDate: null,
            createdAt: '2026-03-01T10:00:00Z'
        }));
        const calc = calcList.openCalc('manual-25');
        assert.equal(calc.settings.vatRateMode, 'manual');
        assert.equal(calc.settings.vatRate, 0.25);
    });
});

/* ---------- Цена 100 + НДС: интегральная проверка через calculate ---------- */

describe('Phase 3 calculate: цена 100 + vatEnabled+режимы', () => {
    function calcWithItem({ vatRateMode, vatRate, vatEffectiveDate, createdAt }) {
        const c = v17Calc({
            id: 'price100',
            vatRateMode, vatRate, vatEffectiveDate, createdAt
        });
        c.dictionaries = {
            items: [{
                id: 'item-100',
                name: 'Test',
                unit: 'шт.',
                pricePerUnit: 100,
                billingInterval: 'monthly',
                applicableStands: ['PROD'],
                qtyFormulas: { PROD: '1' },
                category: 'HW'
            }],
            questions: [],
            categories: []
        };
        return c;
    }

    it('(7) цена 100 + vatEnabled + auto-by-date 2026 → costFinal = 122 (с НДС 22%)', () => {
        persistRawCalc(calcWithItem({
            vatRateMode: 'auto-by-date',
            vatRate: 0.22,
            vatEffectiveDate: '2026-04-01',
            createdAt: '2026-04-01T10:00:00Z'
        }));
        const calc = calcList.openCalc('price100');
        clearCalculationCache();
        const r = calculate(calc);
        assert.equal(r.totalMonthly, 122);
    });

    it('(8) цена 100 + vatEnabled + frozen 20% → costFinal = 120 (НДС 20%)', () => {
        persistRawCalc(calcWithItem({
            vatRateMode: 'frozen',
            vatRate: 0.20,
            vatEffectiveDate: '2024-06-01',
            createdAt: '2024-06-01T10:00:00Z'
        }));
        const calc = calcList.openCalc('price100');
        clearCalculationCache();
        const r = calculate(calc);
        assert.equal(r.totalMonthly, 120);
    });
});

/* ---------- createCalc: новый расчёт получает auto-by-date + today ---------- */

describe('Phase 3 createCalc: новый расчёт = auto-by-date + today + current VAT', () => {
    it('(9) новый расчёт через createCalc — vatRateMode=auto-by-date, vatEffectiveDate=today, vatRate=current', () => {
        const c = calcList.createCalc('NewVat');
        assert.equal(c.settings.vatRateMode, 'auto-by-date');
        assert.equal(c.settings.vatEffectiveDate, todayIso());
        assert.equal(c.settings.vatRate, getCurrentVatRate());
    });

    it('vatEffectiveDate согласован с createdAt (одна Date-инстанция)', () => {
        const c = calcList.createCalc('Sync');
        /* createdAt и vatEffectiveDate должны указывать на один день. */
        const createdDay = c.createdAt.slice(0, 10);
        assert.equal(c.settings.vatEffectiveDate, createdDay);
    });

    it('createCalc сохраняет calc — повторный openCalc даёт ту же VAT-конфигурацию', () => {
        const c = calcList.createCalc('Roundtrip');
        const beforeRate = c.settings.vatRate;
        const beforeMode = c.settings.vatRateMode;
        const beforeDate = c.settings.vatEffectiveDate;

        store.setActiveCalc(null);
        const reopened = calcList.openCalc(c.id);

        assert.equal(reopened.settings.vatRateMode, beforeMode);
        assert.equal(reopened.settings.vatRate, beforeRate);
        assert.equal(reopened.settings.vatEffectiveDate, beforeDate);
    });
});

/* ---------- ACCEPTANCE: Legacy 20% после миграции + openCalc → сумма не меняется ---------- */

describe('Phase 3 ACCEPTANCE: legacy 20% calc — сумма НЕ меняется после migration + openCalc', () => {
    it('(10) legacy v16 calc (vatRate=0.20, createdAt=2024-06-01) → после открытия mode=frozen, totalMonthly идентичен', () => {
        /* Симуляция: пользователь имел в localStorage расчёт schemaVersion=16
           с vatRate=0.20 (бюджет 2024 года). При open срабатывают:
              migration 16→17  ⇒ mode=frozen, vatEffectiveDate=2024-06-01
              applyVatResolver ⇒ no-op (frozen НЕ трогаются)
           Сумма расчёта ОБЯЗАНА совпадать с тем, что было до Stage VAT-1. */
        const legacyV16 = {
            version: '1.0', id: 'legacy-20', name: 'Legacy 2024',
            schemaVersion: 16,
            createdAt: '2024-06-01T10:00:00Z',
            updatedAt: '2025-12-15T10:00:00Z',
            settings: {
                provider: 'sbercloud', providerSetByWizard: false,
                vatEnabled: true,
                vatRate: 0.20,
                /* vatRateMode + vatEffectiveDate ОТСУТСТВУЮТ — это v16. */
                applyRiskFactors: true,
                planningHorizonYears: 1,
                phaseDurationMonths: 6,
                daysPerMonth: 30,
                standSizeRatio: { DEV: 0.16, IFT: 0.40, PSI: 0.50, LOAD: 0.80, PROD: 1.0 },
                bufferTask: 0.1, bufferProject: 0.05,
                kInflation: 0.08, kSeasonal: 0.05,
                kScheduleShift: 0.10, kContingency: 0.05
            },
            answers: {},
            wizard: null,
            answersMeta: {},
            view: { disabledStands: [] },
            dictionaries: {
                items: [{
                    id: 'item-leg', name: 'Legacy Item', unit: 'шт.',
                    pricePerUnit: 1000,
                    billingInterval: 'monthly',
                    applicableStands: ['PROD'],
                    qtyFormulas: { PROD: '10' },
                    category: 'HW'
                }],
                questions: [],
                categories: []
            },
            scenarios: [{ id: 'scen-0', label: 'Базовый', wizard: null, answers: {}, answersMeta: {} }],
            activeScenarioId: 'scen-0'
        };

        /* «До» — посчитать на сырой v16-форме напрямую через calculate(). */
        clearCalculationCache();
        const before = calculate(legacyV16);
        assert.ok(before.totalMonthly > 0, 'sanity: расчёт нетривиальный');

        /* Сохранить как v16, открыть — должна сработать миграция + resolver. */
        persistRawCalc(legacyV16);
        const reopened = calcList.openCalc('legacy-20');

        /* Migration 16→17 классификации: vatRate=0.20 + createdAt=2024 → frozen.
         * Аудит #3 (2026-05-18): после VAT-1 идёт priceSource-normalize (17→18),
         * settings от него не затрагиваются (только items.priceSource при наличии).
         * MINOR 2.18.0 (2026-05-19): добавлен шаг 18→19 (удаление dead-вопроса
         * mau_growth_rate_percent), settings им тоже не затрагиваются. */
        assert.equal(reopened.settings.vatRateMode, 'frozen');
        assert.equal(reopened.settings.vatRate, 0.20);
        assert.equal(reopened.schemaVersion, 19);

        clearCalculationCache();
        const after = calculate(reopened);
        assert.equal(before.totalMonthly, after.totalMonthly,
            `СУММА ИЗМЕНИЛАСЬ! до=${before.totalMonthly}, после=${after.totalMonthly}`);
    });
});
