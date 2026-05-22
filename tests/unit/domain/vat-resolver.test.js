/**
 * Stage VAT-1 Phase 3: unit-тесты для resolveVatSettingsForCalc + applyVatResolver.
 *
 * Покрывает все 3 режима (auto-by-date / manual / frozen), edge cases
 * (null calc, отсутствующий settings, неизвестный mode), и контракт
 * immutability через applyVatResolver.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    resolveVatSettingsForCalc,
    applyVatResolver
} from '../../../js/domain/vatResolver.js';
import { todayIso, getCurrentVatRate } from '../../../js/domain/vatRateTable.js';

/* ---------- resolveVatSettingsForCalc: auto-by-date ---------- */

describe('resolveVatSettingsForCalc: auto-by-date', () => {
    it('vatEffectiveDate=2024-06-01 → vatRate=0.20 (период 2019-2025)', () => {
        const r = resolveVatSettingsForCalc({
            createdAt: '2024-06-01T10:00:00Z',
            settings: { vatRateMode: 'auto-by-date', vatEffectiveDate: '2024-06-01' }
        });
        assert.equal(r.vatRate, 0.20);
        assert.equal(r.vatEffectiveDate, '2024-06-01');
        assert.equal(r.vatRateMode, 'auto-by-date');
    });

    it('vatEffectiveDate=2026-04-01 → vatRate=0.22 (текущий период)', () => {
        const r = resolveVatSettingsForCalc({
            createdAt: '2026-04-01T10:00:00Z',
            settings: { vatRateMode: 'auto-by-date', vatEffectiveDate: '2026-04-01' }
        });
        assert.equal(r.vatRate, 0.22);
        assert.equal(r.vatEffectiveDate, '2026-04-01');
    });

    it('vatEffectiveDate=null, createdAt=2025-06-01 → effective=2025-06-01, vatRate=0.20', () => {
        const r = resolveVatSettingsForCalc({
            createdAt: '2025-06-01T10:00:00Z',
            settings: { vatRateMode: 'auto-by-date', vatEffectiveDate: null }
        });
        assert.equal(r.vatEffectiveDate, '2025-06-01');
        assert.equal(r.vatRate, 0.20);
    });

    it('vatEffectiveDate=null, без createdAt → effective=today, vatRate=current', () => {
        const r = resolveVatSettingsForCalc({
            settings: { vatRateMode: 'auto-by-date', vatEffectiveDate: null }
        });
        assert.equal(r.vatEffectiveDate, todayIso());
        assert.equal(r.vatRate, getCurrentVatRate());
    });

    it('vatEffectiveDate=null, createdAt=невалидная строка → effective=today', () => {
        const r = resolveVatSettingsForCalc({
            createdAt: 'garbage',
            settings: { vatRateMode: 'auto-by-date', vatEffectiveDate: null }
        });
        assert.equal(r.vatEffectiveDate, todayIso());
    });
});

/* ---------- resolveVatSettingsForCalc: manual ---------- */

describe('resolveVatSettingsForCalc: manual', () => {
    it('vatRate=0.25 → возвращается 0.25, vatEffectiveDate=null', () => {
        const r = resolveVatSettingsForCalc({
            createdAt: '2026-03-01T10:00:00Z',
            settings: { vatRateMode: 'manual', vatRate: 0.25, vatEffectiveDate: null }
        });
        assert.equal(r.vatRate, 0.25);
        assert.equal(r.vatEffectiveDate, null);
        assert.equal(r.vatRateMode, 'manual');
    });

    it('manual игнорирует createdAt (не пересчитывает по справочнику)', () => {
        const r = resolveVatSettingsForCalc({
            createdAt: '2024-06-01T10:00:00Z',  // 20%-период
            settings: { vatRateMode: 'manual', vatRate: 0.10 }
        });
        assert.equal(r.vatRate, 0.10);  // НЕ 0.20
        assert.equal(r.vatEffectiveDate, null);
    });

    it('manual со vatRate=0 (экспорт / нерезидент)', () => {
        const r = resolveVatSettingsForCalc({
            createdAt: '2026-05-01T10:00:00Z',
            settings: { vatRateMode: 'manual', vatRate: 0 }
        });
        assert.equal(r.vatRate, 0);
    });
});

/* ---------- resolveVatSettingsForCalc: frozen ---------- */

describe('resolveVatSettingsForCalc: frozen', () => {
    it('frozen vatRate=0.20, vatEffectiveDate=2024-06-01 → не пересчитывается', () => {
        const r = resolveVatSettingsForCalc({
            createdAt: '2024-06-01T10:00:00Z',
            settings: { vatRateMode: 'frozen', vatRate: 0.20, vatEffectiveDate: '2024-06-01' }
        });
        assert.equal(r.vatRate, 0.20);
        assert.equal(r.vatEffectiveDate, '2024-06-01');
        assert.equal(r.vatRateMode, 'frozen');
    });

    it('frozen vatRate=0.18, vatEffectiveDate=null (legacy без createdAt) → не пересчитывается', () => {
        const r = resolveVatSettingsForCalc({
            settings: { vatRateMode: 'frozen', vatRate: 0.18, vatEffectiveDate: null }
        });
        assert.equal(r.vatRate, 0.18);
        assert.equal(r.vatEffectiveDate, null);
    });

    it('frozen ИГНОРИРУЕТ createdAt — даже если открыли в 2027 году', () => {
        const r = resolveVatSettingsForCalc({
            createdAt: '2024-06-01T10:00:00Z',
            settings: { vatRateMode: 'frozen', vatRate: 0.20, vatEffectiveDate: '2024-06-01' }
        });
        assert.equal(r.vatRate, 0.20);  // НЕ getCurrentVatRate()
    });
});

/* ---------- resolveVatSettingsForCalc: edge cases ---------- */

describe('resolveVatSettingsForCalc: edge cases', () => {
    it('calc=null → безопасный default (auto-by-date на today)', () => {
        const r = resolveVatSettingsForCalc(null);
        assert.equal(r.vatRateMode, 'auto-by-date');
        assert.equal(r.vatEffectiveDate, todayIso());
        assert.equal(r.vatRate, getCurrentVatRate());
    });

    it('calc.settings отсутствует → default', () => {
        const r = resolveVatSettingsForCalc({ id: 'x' });
        assert.equal(r.vatRateMode, 'auto-by-date');
        assert.equal(r.vatEffectiveDate, todayIso());
    });

    it('неизвестный vatRateMode → fallback на auto-by-date с пересчётом', () => {
        const r = resolveVatSettingsForCalc({
            createdAt: '2024-06-01T10:00:00Z',
            settings: { vatRateMode: 'unknown-mode', vatRate: 0.99 }
        });
        /* unknown mode НЕ оставляет 0.99 — пересчитывает из справочника
           по createdAt (defensive поведение для corrupted state). */
        assert.equal(r.vatRateMode, 'auto-by-date');
        assert.equal(r.vatRate, 0.20);
        assert.equal(r.vatEffectiveDate, '2024-06-01');
    });
});

/* ---------- applyVatResolver: immutability + no-op ---------- */

describe('applyVatResolver: immutability + no-op', () => {
    it('frozen calc — applyVatResolver возвращает ТОТ ЖЕ объект (no-op)', () => {
        const calc = {
            createdAt: '2024-06-01T10:00:00Z',
            settings: { vatRateMode: 'frozen', vatRate: 0.20, vatEffectiveDate: '2024-06-01' }
        };
        const result = applyVatResolver(calc);
        assert.equal(result, calc);  // ссылка та же
    });

    it('manual calc — no-op (но vatEffectiveDate в settings=null → одинаково)', () => {
        const calc = {
            createdAt: '2026-03-01T10:00:00Z',
            settings: { vatRateMode: 'manual', vatRate: 0.25, vatEffectiveDate: null }
        };
        const result = applyVatResolver(calc);
        assert.equal(result, calc);
    });

    it('auto-by-date calc с согласованными vatRate/vatEffectiveDate — no-op', () => {
        const calc = {
            createdAt: '2026-04-01T10:00:00Z',
            settings: {
                vatRateMode: 'auto-by-date',
                vatRate: 0.22,
                vatEffectiveDate: '2026-04-01'
            }
        };
        const result = applyVatResolver(calc);
        assert.equal(result, calc);  // 22% совпадает с справочником на 2026-04-01
    });

    it('auto-by-date calc с stale vatRate=0.20 (справочник изменился) → новый объект', () => {
        const calc = {
            createdAt: '2026-04-01T10:00:00Z',
            settings: {
                vatRateMode: 'auto-by-date',
                vatRate: 0.20,  // устаревшая запись
                vatEffectiveDate: '2026-04-01'
            }
        };
        const result = applyVatResolver(calc);
        assert.notEqual(result, calc);
        assert.equal(result.settings.vatRate, 0.22);  // пересчитано
        /* Исходный calc НЕ мутирован. */
        assert.equal(calc.settings.vatRate, 0.20);
    });

    it('auto-by-date legacy с vatEffectiveDate=null + createdAt → effectiveDate проставлен', () => {
        const calc = {
            createdAt: '2024-06-01T10:00:00Z',
            settings: {
                vatRateMode: 'auto-by-date',
                vatRate: 0.20,
                vatEffectiveDate: null
            }
        };
        const result = applyVatResolver(calc);
        assert.notEqual(result, calc);
        assert.equal(result.settings.vatEffectiveDate, '2024-06-01');
        assert.equal(result.settings.vatRate, 0.20);
    });

    it('применение возвращает shallow clone — другие поля settings сохраняются', () => {
        const calc = {
            createdAt: '2026-04-01T10:00:00Z',
            settings: {
                vatRateMode: 'auto-by-date',
                vatRate: 0.20,  // stale
                vatEffectiveDate: '2026-04-01',
                kInflation: 0.08,
                provider: 'sbercloud'
            }
        };
        const result = applyVatResolver(calc);
        assert.equal(result.settings.kInflation, 0.08);
        assert.equal(result.settings.provider, 'sbercloud');
    });

    it('calc без settings → возвращается as-is', () => {
        const calc = { id: 'x' };
        assert.equal(applyVatResolver(calc), calc);
    });

    it('null → null', () => {
        assert.equal(applyVatResolver(null), null);
    });
});

/* ---------- Сценарий: справочник пополнился — auto обновляется, frozen нет ---------- */

describe('applyVatResolver: сценарий смены ставки в реальном мире', () => {
    it('auto-by-date calc 2025 года при open в 2026 → vatRate обновляется на 22% если effectiveDate=today', () => {
        /* Сценарий: пользователь создал calc в декабре 2025 с auto-by-date.
           vatEffectiveDate был = '2025-12-15', vatRate=0.20.
           Через месяц (январь 2026) ставка официально 22%, открывает calc.

           Поведение: vatEffectiveDate ОСТАЁТСЯ '2025-12-15' (фиксирован при создании),
           значит vatRate ОСТАЁТСЯ 0.20 — справочник возвращает 0.20 для 2025-12-15.
           Это правильно: бюджет был согласован под старую ставку. */
        const calc = {
            createdAt: '2025-12-15T10:00:00Z',
            settings: {
                vatRateMode: 'auto-by-date',
                vatRate: 0.20,
                vatEffectiveDate: '2025-12-15'
            }
        };
        const result = applyVatResolver(calc);
        assert.equal(result, calc);
        assert.equal(result.settings.vatRate, 0.20);
    });

    it('Чтобы перевести расчёт на новую ставку — нужно сменить vatEffectiveDate (UI: Phase 5)', () => {
        const calc = {
            createdAt: '2025-12-15T10:00:00Z',
            settings: {
                vatRateMode: 'auto-by-date',
                vatRate: 0.20,
                vatEffectiveDate: '2026-01-15'  // пользователь явно обновил
            }
        };
        const result = applyVatResolver(calc);
        assert.equal(result.settings.vatRate, 0.22);
    });
});
