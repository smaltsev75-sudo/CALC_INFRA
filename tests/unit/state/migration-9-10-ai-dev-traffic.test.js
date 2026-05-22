/**
 * Этап 13.U10: миграция v9 → v10. Поднимает aiStandFactor.DEV с 0 (старый
 * legacy-дефолт) на 0.02 (новый дефолт — 2% разработческого AI-traffic'а).
 *
 * Триггер: ранее на DEV AI-метрики были несимметричны (RAG_VECTORS ≥ 1 ГБ
 * через max(1, ...), TOKENS/EMBEDDINGS = 0). Теперь все AI-формулы дают
 * пропорциональный dev-объём, регулируемый одним фактором.
 *
 * Идемпотентность: явно установленные пользователем значения (0.05, 0.1, …)
 * НЕ трогаем — это персональная настройка. Только legacy-нули (значение
 * совпадает со старым дефолтом) поднимаются до нового дефолта.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MIGRATIONS, LATEST_SCHEMA_VERSION } from '../../../js/state/migrations.js';
import { DEFAULT_AI_STAND_FACTOR } from '../../../js/utils/constants.js';

const v9to10 = MIGRATIONS.find(m => m.from === 9 && m.to === 10);

describe('Migration v9 → v10: aiStandFactor.DEV legacy 0 → новый default', () => {
    it('LATEST_SCHEMA_VERSION ≥ 10 после добавления миграции', () => {
        // 13.U10-fix: LATEST поднялся до 11 после добавления миграции
        // авто-восстановления agent-defaults. Проверяем «не меньше 10»,
        // чтобы не ломать тест при добавлении следующих шагов.
        assert.ok(LATEST_SCHEMA_VERSION >= 10,
            `LATEST_SCHEMA_VERSION должен быть ≥ 10, получено ${LATEST_SCHEMA_VERSION}`);
    });

    it('миграция v9→v10 зарегистрирована', () => {
        assert.ok(v9to10, 'миграция from:9 to:10 должна существовать в MIGRATIONS');
    });

    it('DEFAULT_AI_STAND_FACTOR.DEV = 0.02 (новый default)', () => {
        assert.equal(DEFAULT_AI_STAND_FACTOR.DEV, 0.02,
            'новый дефолт DEV-фактора — 2% от PROD');
    });

    it('legacy aiStandFactor.DEV === 0 поднимается до 0.02', () => {
        const calc = {
            settings: {
                aiStandFactor: { DEV: 0, IFT: 0.2, PSI: 0.5, PROD: 1.0, LOAD: 1.0 }
            }
        };
        v9to10.run(calc);
        assert.equal(calc.settings.aiStandFactor.DEV, 0.02,
            'legacy 0 на DEV должен переключиться на новый дефолт 0.02');
    });

    it('явно настроенные нестарые DEV-значения НЕ трогаем (0.05 остаётся 0.05)', () => {
        const calc = {
            settings: {
                aiStandFactor: { DEV: 0.05, IFT: 0.2, PSI: 0.5, PROD: 1.0, LOAD: 1.0 }
            }
        };
        v9to10.run(calc);
        assert.equal(calc.settings.aiStandFactor.DEV, 0.05,
            'явно настроенные пользователем значения (≠ 0) сохраняются');
    });

    it('PROD всегда заперт = 1.00 после миграции (защита от JSON-импорта)', () => {
        const calc = {
            settings: {
                aiStandFactor: { DEV: 0, IFT: 0.2, PSI: 0.5, PROD: 0.7, LOAD: 1.0 }
            }
        };
        v9to10.run(calc);
        assert.equal(calc.settings.aiStandFactor.PROD, 1.00,
            'PROD = 1.00 — инвариант, не правится');
    });

    it('идемпотентность: повторный прогон не меняет результат', () => {
        const calc = {
            settings: {
                aiStandFactor: { DEV: 0, IFT: 0.2, PSI: 0.5, PROD: 1.0, LOAD: 1.0 }
            }
        };
        v9to10.run(calc);
        const after1 = JSON.stringify(calc);
        v9to10.run(calc);
        const after2 = JSON.stringify(calc);
        assert.equal(after1, after2, 'миграция должна быть идемпотентной');
    });

    it('расчёт без settings.aiStandFactor получает полный дефолт', () => {
        const calc = { settings: {} };
        v9to10.run(calc);
        assert.deepEqual(calc.settings.aiStandFactor, { ...DEFAULT_AI_STAND_FACTOR },
            'отсутствующий объект должен заполниться полным дефолтом');
    });
});
