import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { repairUnknownAnswersWithDefaults } from '../../../js/domain/answerRepair.js';
import { defaultAnswersFrom } from '../../../js/domain/seed.js';

const questions = [
    { id: 'ram_per_vcpu_ratio', title: 'RAM/vCPU', type: 'number', min: 1, max: 32, defaultIfUnknown: 4 },
    { id: 'backup_retention_days', title: 'Backup', type: 'number', min: 1, max: 365, defaultIfUnknown: 30 },
    { id: 'backup_retention_select', title: 'Backup select', type: 'select', defaultValue: 30,
        options: [{ value: 30, label: '30' }, { value: 90, label: '90' }] },
    { id: 'explicit_zero_allowed', title: 'Zero OK', type: 'number', min: 0, max: 10, defaultIfUnknown: 5 }
];

describe('answerRepair: automatic JSON repairs', () => {
    it('null заменяется на defaultIfUnknown, числовая строка приводится к number, invalid 0 при min=1 чинится', () => {
        const calc = {
            answers: {
                ram_per_vcpu_ratio: null,
                backup_retention_days: '90',
                backup_retention_select: '90',
                explicit_zero_allowed: 0
            },
            dictionaries: { questions },
            scenarios: [{
                id: 's1',
                label: 'Scenario 1',
                answers: { ram_per_vcpu_ratio: 0, backup_retention_days: '30' }
            }]
        };

        const result = repairUnknownAnswersWithDefaults(calc);

        assert.equal(result.changed, true);
        assert.equal(calc.answers.ram_per_vcpu_ratio, 4);
        assert.equal(calc.answers.backup_retention_days, 90);
        assert.equal(calc.answers.backup_retention_select, 90);
        assert.equal(calc.answers.explicit_zero_allowed, 0);
        assert.equal(calc.scenarios[0].answers.ram_per_vcpu_ratio, 4);
        assert.equal(calc.scenarios[0].answers.backup_retention_days, 30);
        assert.deepEqual(
            result.repairs.map(r => [r.path, r.reason]),
            [
                ['answers.ram_per_vcpu_ratio', 'empty'],
                ['answers.backup_retention_days', 'numeric-string'],
                ['answers.backup_retention_select', 'select-numeric-string'],
                ['scenarios[0].answers.ram_per_vcpu_ratio', 'out-of-range'],
                ['scenarios[0].answers.backup_retention_days', 'numeric-string']
            ]
        );
    });

    it('добавляет отсутствующие критичные ответы из fallback для ручной проверки после импорта', () => {
        const calc = {
            answers: {},
            dictionaries: {
                questions: [
                    { id: 'cache_size_gb', title: 'Кэш', type: 'number', min: 0, max: 1000, defaultIfUnknown: 20 },
                    { id: 'non_critical', title: 'Не критично', type: 'number', min: 0, max: 1000, defaultIfUnknown: 7 }
                ]
            }
        };

        const result = repairUnknownAnswersWithDefaults(calc);

        assert.equal(result.changed, true);
        assert.equal(calc.answers.cache_size_gb, 20);
        assert.equal(Object.prototype.hasOwnProperty.call(calc.answers, 'non_critical'), false);
        assert.deepEqual(
            result.repairs.map(r => [r.path, r.reason, r.fallbackSource]),
            [['answers.cache_size_gb', 'missing', 'defaultIfUnknown']]
        );
    });

    it('не легализует out-of-range значения не критичных полей', () => {
        const calc = {
            answers: { bad_q: -50 },
            dictionaries: {
                questions: [{
                    id: 'bad_q', title: 'Bad Q', type: 'number',
                    min: 0, max: 100, defaultValue: 50
                }]
            }
        };

        const result = repairUnknownAnswersWithDefaults(calc);

        assert.equal(result.changed, false);
        assert.equal(calc.answers.bad_q, -50);
        assert.deepEqual(result.repairs, []);
    });
});

describe('defaultAnswersFrom: unknown values', () => {
    it('новый расчёт использует defaultIfUnknown вместо искусственного 0', () => {
        const answers = defaultAnswersFrom(questions);

        assert.equal(answers.ram_per_vcpu_ratio, 4);
        assert.equal(answers.backup_retention_days, 30);
        assert.equal(answers.explicit_zero_allowed, 5);
    });
});
