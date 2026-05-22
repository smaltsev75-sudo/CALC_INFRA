/**
 * Stage VAT-1 Phase 4: controller methods для VAT modes.
 *
 * Четыре ctx-метода:
 *   - setVatRateMode(mode)        — переключить режим;
 *   - setVatEffectiveDate(iso)    — изменить дату действия (только для auto);
 *   - setVatRateManual(rate)      — задать ручную ставку;
 *   - freezeVatRate()             — заморозить текущую ставку.
 *
 * Стилевое соглашение проекта: setters silent no-op при невалидном входе или
 * отсутствии активного расчёта (см. setResourceRatio / setAiStandFactor /
 * setProvider в [calcController.js]). Не throws, не возвращает {ok, reason}.
 * Тесты проверяют поведение через state.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from '../../integration/storage-mock.js';

installLocalStorage();

const { store } = await import('../../../js/state/store.js');
const calc = await import('../../../js/controllers/calcController.js');
const calcList = await import('../../../js/controllers/calcListController.js');
const { todayIso, getCurrentVatRate } = await import('../../../js/domain/vatRateTable.js');

function settings() {
    return store.getState().activeCalc?.settings;
}

beforeEach(() => {
    installLocalStorage();
    store.setActiveCalc(null);
    store.setCalcList([]);
});

/* ---------- setVatRateMode ---------- */

describe('setVatRateMode: переключение режимов', () => {
    it('(1) auto-by-date: устанавливает mode=auto и пересчитывает vatRate по vatEffectiveDate', () => {
        const c = calcList.createCalc('m1');
        /* Сначала перевести в manual, чтобы потом переключить обратно в auto. */
        calc.setVatRateManual(0.10);
        assert.equal(settings().vatRateMode, 'manual');
        /* Теперь установить эффективную дату через manual (нельзя — мode другой).
           Установим в auto явно — он должен использовать createdAt как fallback. */
        calc.setVatRateMode('auto-by-date');
        assert.equal(settings().vatRateMode, 'auto-by-date');
        /* createdAt был = today при создании, значит effective = today, rate = current. */
        assert.equal(settings().vatEffectiveDate, todayIso());
        assert.equal(settings().vatRate, getCurrentVatRate());
    });

    it('(2) auto-by-date с уже-присвоенным vatEffectiveDate — использует его (не createdAt)', () => {
        const c = calcList.createCalc('m2');
        /* Переключение в auto-by-date при mode=auto-by-date — должно остаться. */
        const beforeDate = settings().vatEffectiveDate;
        calc.setVatRateMode('auto-by-date');
        assert.equal(settings().vatEffectiveDate, beforeDate);
    });

    it('(3) manual: сохраняет текущий rate, очищает effectiveDate', () => {
        calcList.createCalc('m3');
        const rateBefore = settings().vatRate;
        calc.setVatRateMode('manual');
        assert.equal(settings().vatRateMode, 'manual');
        assert.equal(settings().vatRate, rateBefore);
        assert.equal(settings().vatEffectiveDate, null);
    });

    it('(4) frozen: сохраняет текущий rate, фиксирует effectiveDate', () => {
        calcList.createCalc('m4');
        const rateBefore = settings().vatRate;
        const dateBefore = settings().vatEffectiveDate;
        calc.setVatRateMode('frozen');
        assert.equal(settings().vatRateMode, 'frozen');
        assert.equal(settings().vatRate, rateBefore);
        /* effectiveDate сохраняется (был = today). */
        assert.equal(settings().vatEffectiveDate, dateBefore);
    });

    it('(4-bis) frozen без vatEffectiveDate → подставляет today', () => {
        calcList.createCalc('m4b');
        /* Переведём в manual чтобы effectiveDate стал null, потом во frozen. */
        calc.setVatRateMode('manual');
        assert.equal(settings().vatEffectiveDate, null);
        calc.setVatRateMode('frozen');
        assert.equal(settings().vatRateMode, 'frozen');
        assert.equal(settings().vatEffectiveDate, todayIso());
    });

    it('(5) invalid mode → no-op, state не меняется', () => {
        calcList.createCalc('m5');
        const before = JSON.stringify(settings());
        calc.setVatRateMode('garbage');
        assert.equal(JSON.stringify(settings()), before);
        calc.setVatRateMode(null);
        assert.equal(JSON.stringify(settings()), before);
        calc.setVatRateMode(42);
        assert.equal(JSON.stringify(settings()), before);
    });
});

/* ---------- setVatEffectiveDate ---------- */

describe('setVatEffectiveDate: смена даты в auto-by-date', () => {
    it('(6) auto + valid date 2024-06-01 → rate=0.20', () => {
        calcList.createCalc('d6');
        calc.setVatEffectiveDate('2024-06-01');
        assert.equal(settings().vatEffectiveDate, '2024-06-01');
        assert.equal(settings().vatRate, 0.20);
    });

    it('(7) auto + valid date 2026-06-01 → rate=0.22', () => {
        calcList.createCalc('d7');
        calc.setVatEffectiveDate('2026-06-01');
        assert.equal(settings().vatEffectiveDate, '2026-06-01');
        assert.equal(settings().vatRate, 0.22);
    });

    it('(8a) в manual режиме → no-op', () => {
        calcList.createCalc('d8a');
        calc.setVatRateManual(0.25);
        const before = JSON.stringify(settings());
        calc.setVatEffectiveDate('2024-06-01');
        assert.equal(JSON.stringify(settings()), before);
    });

    it('(8b) в frozen режиме → no-op', () => {
        calcList.createCalc('d8b');
        calc.setVatRateMode('frozen');
        const before = JSON.stringify(settings());
        calc.setVatEffectiveDate('2024-06-01');
        assert.equal(JSON.stringify(settings()), before);
    });

    it('(9) invalid date → no-op', () => {
        calcList.createCalc('d9');
        const before = JSON.stringify(settings());
        calc.setVatEffectiveDate('garbage');
        assert.equal(JSON.stringify(settings()), before);
        calc.setVatEffectiveDate('2026-13-99');
        assert.equal(JSON.stringify(settings()), before);
        calc.setVatEffectiveDate(null);
        assert.equal(JSON.stringify(settings()), before);
        calc.setVatEffectiveDate(20240601);  // number
        assert.equal(JSON.stringify(settings()), before);
    });

    it('Дата вне справочника (например 1990-01-01) → no-op (rate=null)', () => {
        calcList.createCalc('d-out');
        const before = JSON.stringify(settings());
        calc.setVatEffectiveDate('1990-01-01');
        /* Не должно перевести vatRate в null. */
        assert.equal(JSON.stringify(settings()), before);
    });
});

/* ---------- setVatRateManual ---------- */

describe('setVatRateManual: ручная ставка', () => {
    it('(10) rate=0.25 → mode=manual, rate=0.25, effectiveDate=null', () => {
        calcList.createCalc('mn10');
        calc.setVatRateManual(0.25);
        assert.equal(settings().vatRateMode, 'manual');
        assert.equal(settings().vatRate, 0.25);
        assert.equal(settings().vatEffectiveDate, null);
    });

    it('(11) rate=0 (экспорт / нерезидент) допустим', () => {
        calcList.createCalc('mn11');
        calc.setVatRateManual(0);
        assert.equal(settings().vatRateMode, 'manual');
        assert.equal(settings().vatRate, 0);
    });

    it('(11-bis) rate=1 (предельный 100% — гипотетический) допустим', () => {
        calcList.createCalc('mn11b');
        calc.setVatRateManual(1);
        assert.equal(settings().vatRateMode, 'manual');
        assert.equal(settings().vatRate, 1);
    });

    it('(12) rate=-0.1 отвергается → no-op', () => {
        calcList.createCalc('mn12');
        const before = JSON.stringify(settings());
        calc.setVatRateManual(-0.1);
        assert.equal(JSON.stringify(settings()), before);
    });

    it('(13) rate=1.5 отвергается → no-op', () => {
        calcList.createCalc('mn13');
        const before = JSON.stringify(settings());
        calc.setVatRateManual(1.5);
        assert.equal(JSON.stringify(settings()), before);
    });

    it('(13-bis) rate=22 (UI передал проценты вместо доли) → ОТКЛОНЯЕТСЯ — не магическая нормализация', () => {
        /* Acceptance из спеки Phase 4: domain хранит долю 0.22, не проценты.
           Если UI передал 22, контроллер ДОЛЖЕН отвергнуть, не делить на 100. */
        calcList.createCalc('mn22');
        const before = JSON.stringify(settings());
        calc.setVatRateManual(22);
        assert.equal(JSON.stringify(settings()), before,
            'setVatRateManual(22) должен быть отклонён как rate > 1, без скрытой нормализации');
    });

    it('(14) NaN / Infinity / -Infinity / нечисло → no-op', () => {
        calcList.createCalc('mn14');
        const before = JSON.stringify(settings());
        calc.setVatRateManual(NaN);
        assert.equal(JSON.stringify(settings()), before);
        calc.setVatRateManual(Infinity);
        assert.equal(JSON.stringify(settings()), before);
        calc.setVatRateManual(-Infinity);
        assert.equal(JSON.stringify(settings()), before);
        calc.setVatRateManual('0.22');  // строка — не принимаем
        assert.equal(JSON.stringify(settings()), before);
        calc.setVatRateManual(null);
        assert.equal(JSON.stringify(settings()), before);
        calc.setVatRateManual(undefined);
        assert.equal(JSON.stringify(settings()), before);
    });
});

/* ---------- freezeVatRate ---------- */

describe('freezeVatRate: фиксация текущей ставки', () => {
    it('(15) freezeVatRate из auto-by-date → mode=frozen, rate не меняется', () => {
        calcList.createCalc('fz15');
        const rateBefore = settings().vatRate;
        const dateBefore = settings().vatEffectiveDate;
        calc.freezeVatRate();
        assert.equal(settings().vatRateMode, 'frozen');
        assert.equal(settings().vatRate, rateBefore);
        assert.equal(settings().vatEffectiveDate, dateBefore);
    });

    it('freezeVatRate из manual → mode=frozen, rate сохраняется, effectiveDate=today (null был)', () => {
        calcList.createCalc('fz-m');
        calc.setVatRateManual(0.25);
        assert.equal(settings().vatEffectiveDate, null);
        calc.freezeVatRate();
        assert.equal(settings().vatRateMode, 'frozen');
        assert.equal(settings().vatRate, 0.25);
        assert.equal(settings().vatEffectiveDate, todayIso());
    });

    it('freezeVatRate не пересчитывает ставку из справочника', () => {
        calcList.createCalc('fz-no-recalc');
        /* Имитация: пользователь имел manual rate=0.10 (нестандартный), freeze
           должен это сохранить, НЕ менять на текущую ставку справочника. */
        calc.setVatRateManual(0.10);
        calc.freezeVatRate();
        assert.equal(settings().vatRate, 0.10);  // НЕ getCurrentVatRate()
    });
});

/* ---------- Persist + recalc через стандартный flow ---------- */

describe('Phase 4: успешные изменения проходят через commit / persist', () => {
    it('(16) setVatRateManual фиксирует изменение в state — следующий getState видит', () => {
        calcList.createCalc('p16');
        calc.setVatRateManual(0.15);
        const fromStore = store.getState().activeCalc.settings;
        assert.equal(fromStore.vatRateMode, 'manual');
        assert.equal(fromStore.vatRate, 0.15);
    });

    it('setVatRateMode обновляет recentlyChangedKey в UI state', () => {
        calcList.createCalc('p-key');
        calc.setVatRateMode('manual');
        const key = store.getState().ui?.recentlyChangedKey;
        assert.ok(typeof key === 'string' && key.includes('vat'),
            `recentlyChangedKey должен сигнализировать о смене VAT, получил: ${key}`);
    });
});

/* ---------- No-op без активного расчёта ---------- */

describe('(17) Phase 4: no active calc → no-op', () => {
    it('все 4 методa без activeCalc — silent no-op, не throw', () => {
        store.setActiveCalc(null);
        /* Не должно бросать — все вызовы безопасны. */
        calc.setVatRateMode('manual');
        calc.setVatEffectiveDate('2024-06-01');
        calc.setVatRateManual(0.25);
        calc.freezeVatRate();
        assert.equal(store.getState().activeCalc, null);
    });
});

/* ---------- Legacy 20% frozen — пересмотр режимов сохраняет 20% если осознанно ---------- */

describe('(18) legacy frozen 20% — переходы режимов', () => {
    it('frozen 20% → manual → значение 0.20 сохраняется (не пересчитывается)', () => {
        const c = calcList.createCalc('lg18a');
        /* Симулируем legacy: frozen 0.20, vatEffectiveDate=2024-06-01. */
        store.updateActiveCalc({
            settings: {
                ...settings(),
                vatRateMode: 'frozen',
                vatRate: 0.20,
                vatEffectiveDate: '2024-06-01'
            }
        });
        calc.setVatRateMode('manual');
        assert.equal(settings().vatRateMode, 'manual');
        assert.equal(settings().vatRate, 0.20);  // НЕ обнулилось, НЕ пересчиталось
        assert.equal(settings().vatEffectiveDate, null);
    });

    it('frozen 20% → freezeVatRate (уже frozen) → 20% остаётся, mode остаётся frozen', () => {
        calcList.createCalc('lg18b');
        store.updateActiveCalc({
            settings: {
                ...settings(),
                vatRateMode: 'frozen',
                vatRate: 0.20,
                vatEffectiveDate: '2024-06-01'
            }
        });
        calc.freezeVatRate();
        assert.equal(settings().vatRateMode, 'frozen');
        assert.equal(settings().vatRate, 0.20);
        assert.equal(settings().vatEffectiveDate, '2024-06-01');
    });

    it('frozen 20% → auto-by-date → vatRate пересчитан по vatEffectiveDate=2024-06-01 → 0.20', () => {
        calcList.createCalc('lg18c');
        store.updateActiveCalc({
            settings: {
                ...settings(),
                vatRateMode: 'frozen',
                vatRate: 0.20,
                vatEffectiveDate: '2024-06-01'
            }
        });
        calc.setVatRateMode('auto-by-date');
        assert.equal(settings().vatRateMode, 'auto-by-date');
        assert.equal(settings().vatEffectiveDate, '2024-06-01');
        assert.equal(settings().vatRate, 0.20);  // справочник вернул 20% для 2024-06-01
    });
});
