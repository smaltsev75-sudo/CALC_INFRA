import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { migrateCalculation, MigrationError, LATEST_SCHEMA_VERSION, MIGRATIONS } from '../../../js/state/migrations.js';

describe('migrations: LATEST_SCHEMA_VERSION', () => {
    it('is at least 1', () => {
        assert.ok(LATEST_SCHEMA_VERSION >= 1);
    });
});

describe('migrations: phase_duration_months → settings.phaseDurationMonths', () => {
    it('moves answer to settings', () => {
        const legacy = {
            id: 'l', name: 'L',
            settings: { period: 'monthly', bufferTask: 0.3, bufferProject: 0.15, indexation: 0.1 },
            answers: { phase_duration_months: 6, other: 'value' },
            dictionaries: { items: [], questions: [] }
        };
        const m = migrateCalculation(legacy);
        assert.equal(m.settings.phaseDurationMonths, 6);
        assert.ok(!('phase_duration_months' in m.answers));
        assert.equal(m.answers.other, 'value');
    });
    it('uses default 12 when no answer present', () => {
        const legacy = {
            settings: {}, answers: {}, dictionaries: { items: [], questions: [] }
        };
        const m = migrateCalculation(legacy);
        assert.equal(m.settings.phaseDurationMonths, 12);
    });
    it('uses default for invalid answer', () => {
        const legacy = {
            settings: {}, answers: { phase_duration_months: -5 },
            dictionaries: { items: [], questions: [] }
        };
        const m = migrateCalculation(legacy);
        assert.equal(m.settings.phaseDurationMonths, 12);
    });
});

describe('migrations: idempotency', () => {
    it('migrating already-migrated calc is no-op', () => {
        const calc = {
            schemaVersion: 1,
            settings: { phaseDurationMonths: 4 },
            answers: {}, dictionaries: { items: [], questions: [] }
        };
        const m1 = migrateCalculation(calc);
        const m2 = migrateCalculation(m1);
        assert.equal(m1.schemaVersion, m2.schemaVersion);
        assert.equal(m1.settings.phaseDurationMonths, m2.settings.phaseDurationMonths);
    });

    it('split-chain migration equals full-chain migration for every intermediate stop', () => {
        const legacy = {
            id: 'split-chain',
            name: 'Split chain',
            schemaVersion: 0,
            createdAt: '2025-06-01T00:00:00Z',
            updatedAt: '2025-06-01T00:00:00Z',
            wizard: null,
            activeScenarioId: 'scenario-existing',
            scenarios: [{
                id: 'scenario-existing',
                label: 'Legacy',
                wizard: null,
                answers: {},
                answersMeta: {}
            }],
            settings: {
                period: 'monthly',
                bufferTask: 0.3,
                bufferProject: 0.15,
                indexation: 0.10,
                currency: 'USD',
                phaseDurationMonths: 6,
                standSizeRatio: { DEV: 0.3, IFT: 0.4, PSI: 0.5, PROD: 0.95, LOAD: 1.5 },
                resourceRatio: { LOAD: { CPU: 1.5, RAM: 0.1 }, PROD: { CPU: 0.8 } },
                aiStandFactor: { DEV: 0, IFT: 0.2, PSI: 0.5, PROD: 0.5, LOAD: 1 },
                provider: 'cloud_ru',
                vatRate: 0.20
            },
            answers: {
                phase_duration_months: 9,
                registered_users_total: 500,
                dau_target: 100,
                mau_target: 300,
                ai_agent_mode: true,
                agent_tool_use_share: null,
                agent_tool_avg_seconds: null,
                agent_complexity: null,
                ai_agent_type: null,
                agent_parallel_specialists: null,
                mau_growth_rate_percent: 12
            },
            answersMeta: {},
            dictionaries: {
                items: [
                    {
                        id: 'res-project-risk',
                        name: 'Project risk',
                        unit: 'шт',
                        pricePerUnit: 1,
                        category: 'RESERVES',
                        tariff: 'monthly',
                        applicableStands: ['PROD'],
                        qtyFormulas: { DEV: '', IFT: '', PSI: '', PROD: '1', LOAD: '' }
                    },
                    {
                        id: 'license-os-per-node',
                        name: 'Лицензия ОС (на узел)',
                        unit: 'шт',
                        pricePerUnit: 100,
                        category: 'LICENSE',
                        tariff: 'annual',
                        priceSource: 'cloud.ru/2026-Q3',
                        applicableStands: ['PROD'],
                        qtyFormulas: { DEV: '', IFT: '', PSI: '', PROD: '1', LOAD: '' }
                    }
                ],
                questions: [
                    { id: 'dau_target', label: 'DAU' },
                    { id: 'mau_target', label: 'MAU' },
                    { id: 'mau_growth_rate_percent', label: 'MAU growth' }
                ]
            }
        };
        const clone = value => JSON.parse(JSON.stringify(value));
        const full = migrateCalculation(clone(legacy));

        for (const stop of MIGRATIONS.slice(0, -1)) {
            const partialMigrations = MIGRATIONS.filter(step => step.to <= stop.to);
            const partial = migrateCalculation(clone(legacy), partialMigrations);
            const split = migrateCalculation(partial);

            assert.deepEqual(split, full, `split at schema v${stop.to} must equal full-chain migration`);
        }
    });
});

describe('migrations: v1→v2 (риск-коэффициенты, НДС, standSizeRatio, billingInterval, resourceClass)', () => {
    const v1Calc = (overrides = {}) => ({
        schemaVersion: 1,
        settings: {
            period: 'monthly', bufferTask: 0.3, bufferProject: 0.15,
            indexation: 0.10, currency: 'USD', phaseDurationMonths: 6
        },
        answers: {},
        dictionaries: {
            items: [{
                id: 'a', name: 'A', unit: 'шт', pricePerUnit: 100,
                category: 'HW', tariff: 'monthly',
                applicableStands: ['PROD'],
                qtyFormulas: { DEV: '', IFT: '', PSI: '', PROD: '1', LOAD: '' }
            }],
            questions: []
        },
        ...overrides
    });

    it('переименовывает indexation → kInflation, сохраняя значение', () => {
        const m = migrateCalculation(v1Calc());
        assert.equal(m.settings.kInflation, 0.10);
        assert.ok(!('indexation' in m.settings));
    });

    it('удаляет currency (мультивалютность убрана)', () => {
        const m = migrateCalculation(v1Calc());
        assert.ok(!('currency' in m.settings));
    });

    it('добавляет дефолты для всех новых риск-коэффициентов', () => {
        const m = migrateCalculation(v1Calc());
        assert.equal(typeof m.settings.kSeasonal, 'number');
        assert.equal(typeof m.settings.kScheduleShift, 'number');
        assert.equal(typeof m.settings.kContingency, 'number');
        assert.equal(typeof m.settings.vatEnabled, 'boolean');
        assert.equal(typeof m.settings.vatRate, 'number');
        assert.equal(typeof m.settings.planningHorizonYears, 'number');
        assert.equal(typeof m.settings.daysPerMonth, 'number');
    });

    it('создаёт standSizeRatio с дефолтами и фиксирует PROD=1.00', () => {
        const m = migrateCalculation(v1Calc());
        assert.ok(typeof m.settings.standSizeRatio === 'object');
        assert.equal(m.settings.standSizeRatio.PROD, 1.00);
        for (const stand of ['DEV', 'IFT', 'PSI', 'LOAD']) {
            assert.equal(typeof m.settings.standSizeRatio[stand], 'number');
        }
    });

    it('принудительно перетирает PROD=1.00, даже если в импорте было другое', () => {
        const m = migrateCalculation(v1Calc({
            settings: {
                period: 'monthly', bufferTask: 0, bufferProject: 0, indexation: 0,
                phaseDurationMonths: 12,
                standSizeRatio: { DEV: 0.3, IFT: 0.5, PSI: 0.7, PROD: 0.95, LOAD: 0.5 }
            }
        }));
        assert.equal(m.settings.standSizeRatio.PROD, 1.00,
            'PROD должен быть принудительно установлен в 1.00');
        assert.equal(m.settings.standSizeRatio.DEV, 0.3,
            'остальные значения сохраняются');
    });

    it('переименовывает item.tariff → item.billingInterval, сохраняя значение', () => {
        const m = migrateCalculation(v1Calc());
        const item = m.dictionaries.items[0];
        assert.equal(item.billingInterval, 'monthly');
        assert.ok(!('tariff' in item), 'старое поле tariff удалено');
    });

    it('добавляет resourceClass по эвристике из category', () => {
        const m = migrateCalculation(v1Calc({
            dictionaries: {
                items: [
                    { id: 'h', name: 'H', unit: 'шт', pricePerUnit: 1, category: 'HW',
                      tariff: 'monthly', applicableStands: ['PROD'],
                      qtyFormulas: { DEV:'', IFT:'', PSI:'', PROD:'1', LOAD:'' } },
                    { id: 'l', name: 'L', unit: 'шт', pricePerUnit: 1, category: 'LICENSE',
                      tariff: 'annual', applicableStands: ['PROD'],
                      qtyFormulas: { DEV:'', IFT:'', PSI:'', PROD:'1', LOAD:'' } },
                    { id: 't', name: 'T', unit: 'шт', pricePerUnit: 1, category: 'TRAFFIC',
                      tariff: 'monthly', applicableStands: ['PROD'],
                      qtyFormulas: { DEV:'', IFT:'', PSI:'', PROD:'1', LOAD:'' } }
                ],
                questions: []
            }
        }));
        const items = m.dictionaries.items;
        assert.equal(items.find(i => i.id === 'h').resourceClass, 'CPU');
        assert.equal(items.find(i => i.id === 'l').resourceClass, 'LICENSE');
        assert.equal(items.find(i => i.id === 't').resourceClass, 'TRAFFIC');
    });

    it('сохраняет уже существующий resourceClass', () => {
        const m = migrateCalculation(v1Calc({
            dictionaries: {
                items: [{
                    id: 'x', name: 'X', unit: 'шт', pricePerUnit: 1, category: 'HW',
                    tariff: 'monthly', resourceClass: 'STORAGE',
                    applicableStands: ['PROD'],
                    qtyFormulas: { DEV:'', IFT:'', PSI:'', PROD:'1', LOAD:'' }
                }],
                questions: []
            }
        }));
        assert.equal(m.dictionaries.items[0].resourceClass, 'STORAGE');
    });

    it('идемпотентно: повторная миграция уже-v2 — no-op', () => {
        const m1 = migrateCalculation(v1Calc());
        const m2 = migrateCalculation(m1);
        assert.equal(m1.schemaVersion, m2.schemaVersion);
        assert.equal(m1.settings.kInflation, m2.settings.kInflation);
        assert.equal(m1.settings.standSizeRatio.PROD, m2.settings.standSizeRatio.PROD);
    });
});

describe('migrations: атомарность шага (10.1.3)', () => {
    it('падающий шаг бросает MigrationError и не мутирует исходный calc', () => {
        // Подменяем массив миграций, чтобы шаг 0→1 частично мутировал copy
        // и потом упал. Без атомарного per-step apply мутация бы утекла обратно
        // в caller через ссылку.
        const fakeMigrations = [
            {
                from: 0, to: 1, description: 'Битый шаг для теста',
                run(copy) {
                    copy.foo = 'bar';        // мутация ДО ошибки
                    copy.settings.broken = true;
                    throw new Error('boom');
                }
            }
        ];
        const original = {
            id: 'x', name: 'X',
            settings: { period: 'monthly' },
            answers: {},
            dictionaries: { items: [], questions: [] }
        };
        const snapshot = JSON.stringify(original);

        let thrown = null;
        try {
            migrateCalculation(original, fakeMigrations);
        } catch (e) {
            thrown = e;
        }

        assert.ok(thrown, 'миграция должна была бросить');
        assert.ok(thrown instanceof MigrationError, `ожидался MigrationError, получено: ${thrown?.constructor?.name}`);
        assert.equal(thrown.from, 0);
        assert.equal(thrown.to, 1);
        assert.ok(thrown.cause instanceof Error);
        assert.equal(thrown.cause.message, 'boom');

        // Главное: исходный объект не пострадал.
        assert.equal(JSON.stringify(original), snapshot, 'original calc не должен мутироваться');
        assert.ok(!('foo' in original), 'не должно быть утечки .foo в original');
        assert.ok(!('broken' in original.settings), 'не должно быть утечки .settings.broken в original');
    });

    it('успешный шаг на свежей копии не утекает в исходный calc', () => {
        // Доп. защита: даже когда миграция проходит успешно, оригинал
        // остаётся неизменным (контракт «возвращает новый объект»).
        const fakeMigrations = [
            {
                from: 0, to: 1, description: 'Простой шаг',
                run(copy) { copy.touched = true; }
            }
        ];
        const original = {
            settings: {}, answers: {}, dictionaries: { items: [], questions: [] }
        };
        const snapshot = JSON.stringify(original);
        const result = migrateCalculation(original, fakeMigrations);
        assert.equal(result.touched, true);
        assert.equal(JSON.stringify(original), snapshot, 'original calc не должен мутироваться');
        assert.ok(!('touched' in original));
    });

    it('idempotency на новом контракте: повторный прогон даёт тот же результат', () => {
        // Идемпотентность была и до 10.1.3 (благодаря фильтру v < step.to),
        // но после переписывания цикла на per-step copy — отдельно проверяем,
        // что регрессии нет.
        const calc = {
            schemaVersion: 1,
            settings: { phaseDurationMonths: 4 },
            answers: { pcu: 100 },
            dictionaries: {
                items: [{
                    id: 'a', name: 'A', unit: 'шт', pricePerUnit: 100,
                    category: 'HW', billingInterval: 'monthly', resourceClass: 'CPU',
                    applicableStands: ['PROD'],
                    qtyFormulas: { DEV: '', IFT: '', PSI: '', PROD: '1', LOAD: '' }
                }],
                questions: []
            }
        };
        const m1 = migrateCalculation(calc);
        const m2 = migrateCalculation(m1);
        assert.deepEqual(m1, m2, 'повторная миграция не должна менять результат');
    });
});

describe('migrations: downgrade-защита (11.3.2)', () => {
    it('расчёт с schemaVersion > LATEST бросает MigrationError', () => {
        // Имитируем calc, созданный в будущей версии приложения.
        const futureCalc = {
            schemaVersion: 99,
            settings: {}, answers: {}, dictionaries: { items: [], questions: [] }
        };
        let thrown = null;
        try {
            migrateCalculation(futureCalc);
        } catch (e) {
            thrown = e;
        }
        assert.ok(thrown, 'миграция должна была бросить');
        assert.ok(thrown instanceof MigrationError, `ожидался MigrationError, получено: ${thrown?.constructor?.name}`);
        assert.equal(thrown.from, 99);
        assert.equal(thrown.to, LATEST_SCHEMA_VERSION);
        assert.match(thrown.message, /более новой версии/i,
            'сообщение должно объяснять причину пользователю');
    });

    it('расчёт с schemaVersion === LATEST мигрирует без ошибки и возвращает версию as-is', () => {
        const currentCalc = {
            schemaVersion: LATEST_SCHEMA_VERSION,
            settings: { phaseDurationMonths: 6 },
            answers: {},
            dictionaries: { items: [], questions: [] }
        };
        const result = migrateCalculation(currentCalc);
        assert.equal(result.schemaVersion, LATEST_SCHEMA_VERSION);
        assert.equal(result.settings.phaseDurationMonths, 6);
    });
});

describe('migrations: defensive', () => {
    it('handles null/undefined gracefully', () => {
        assert.equal(migrateCalculation(null), null);
        assert.equal(migrateCalculation(undefined), undefined);
    });
    it('does not mutate input', () => {
        const legacy = {
            settings: { period: 'monthly' },
            answers: { phase_duration_months: 4 },
            dictionaries: { items: [], questions: [] }
        };
        const before = JSON.stringify(legacy);
        migrateCalculation(legacy);
        assert.equal(JSON.stringify(legacy), before);
    });
    it('always sets schemaVersion to LATEST', () => {
        const m = migrateCalculation({
            settings: {}, answers: {}, dictionaries: { items: [], questions: [] }
        });
        assert.equal(m.schemaVersion, LATEST_SCHEMA_VERSION);
    });
});

describe('migrations: v2→v3 (per-resource standSizeRatio)', () => {
    const v2Calc = (overrides = {}) => ({
        schemaVersion: 2,
        settings: {
            period: 'monthly',
            bufferTask: 0.3, bufferProject: 0.15,
            kInflation: 0.10, kSeasonal: 0.0, kScheduleShift: 0.0, kContingency: 0.0,
            vatEnabled: false, vatRate: 0.20, planningHorizonYears: 3,
            phaseDurationMonths: 6, daysPerMonth: 30,
            standSizeRatio: { DEV: 0.20, IFT: 0.40, PSI: 0.80, LOAD: 0.90, PROD: 1.00 },
            ...overrides
        },
        answers: {},
        dictionaries: { items: [], questions: [] }
    });

    it('builds resourceRatio from existing standSizeRatio, all 6 resources per stand', () => {
        const m = migrateCalculation(v2Calc());
        assert.equal(m.schemaVersion, LATEST_SCHEMA_VERSION);
        assert.ok(m.settings.resourceRatio, 'resourceRatio создан');
        for (const stand of ['DEV', 'IFT', 'PSI', 'LOAD', 'PROD']) {
            assert.ok(m.settings.resourceRatio[stand], `${stand} entry exists`);
            for (const r of ['CPU', 'GPU', 'RAM', 'SSD', 'HDD', 'S3']) {
                assert.equal(typeof m.settings.resourceRatio[stand][r], 'number', `${stand}.${r} is number`);
            }
        }
    });

    it('per-resource values copy current standSizeRatio (поведение идентично до правки в Опроснике)', () => {
        const m = migrateCalculation(v2Calc());
        assert.equal(m.settings.resourceRatio.DEV.CPU,  0.20);
        assert.equal(m.settings.resourceRatio.DEV.RAM,  0.20);
        assert.equal(m.settings.resourceRatio.DEV.HDD,  0.20);  // и для неприменимых тоже
        assert.equal(m.settings.resourceRatio.IFT.CPU,  0.40);
        assert.equal(m.settings.resourceRatio.PSI.SSD,  0.80);
        assert.equal(m.settings.resourceRatio.LOAD.S3,  0.90);
    });

    it('PROD = 1.00 принудительно для всех ресурсов независимо от входа', () => {
        const c = v2Calc();
        c.settings.standSizeRatio.PROD = 0.5;  // некорректный ввод
        const m = migrateCalculation(c);
        for (const r of ['CPU', 'GPU', 'RAM', 'SSD', 'HDD', 'S3']) {
            assert.equal(m.settings.resourceRatio.PROD[r], 1.00, `PROD.${r} = 1.00`);
        }
    });

    it('идемпотентность: повторная миграция не меняет значения', () => {
        const m1 = migrateCalculation(v2Calc());
        const m2 = migrateCalculation(m1);
        assert.deepEqual(m1.settings.resourceRatio, m2.settings.resourceRatio);
    });

    it('сохраняет уже заданные пользователем значения resourceRatio', () => {
        const c = v2Calc();
        c.settings.resourceRatio = {
            DEV: { CPU: 0.5, GPU: 0.05, RAM: 0.10, SSD: 0.10, HDD: 0.10, S3: 0.10 }
        };
        const m = migrateCalculation(c);
        assert.equal(m.settings.resourceRatio.DEV.CPU, 0.5, 'явно заданное значение сохранено');
        assert.equal(m.settings.resourceRatio.DEV.GPU, 0.05);
        // Остальные стенды дополнились
        assert.equal(m.settings.resourceRatio.IFT.CPU, 0.40);
    });

    it('работает без settings.standSizeRatio (легаси без v2-миграции)', () => {
        const c = {
            schemaVersion: 0,
            settings: {},
            answers: {}, dictionaries: { items: [], questions: [] }
        };
        const m = migrateCalculation(c);
        assert.equal(m.schemaVersion, LATEST_SCHEMA_VERSION);
        assert.ok(m.settings.resourceRatio.DEV.CPU > 0, 'fallback на дефолты');
        assert.equal(m.settings.resourceRatio.PROD.CPU, 1.00);
    });
});
