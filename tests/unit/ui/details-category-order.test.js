/**
 * Детализация: группы ЭК сортируются по убыванию «ИТОГО / год».
 *
 * Пользовательский сценарий: если ЛИЦЕНЗИИ дают 22 млн ₽/год, а УСЛУГИ
 * 17 млн ₽/год, первой должна идти группа ЛИЦЕНЗИИ, затем УСЛУГИ.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    buildDetailsCategoryOrder,
    detailsCategoryAnnualOnActiveStands
} from '../../../js/ui/details.js';

function cell(costFinal) {
    return { costFinal };
}

const result = {
    items: {
        licenseDb: {
            stands: {
                PROD: cell(22_000_000 / 12),
                DEV: cell(1_000)
            }
        },
        servicesOps: {
            stands: {
                PROD: cell(17_000_000 / 12)
            }
        },
        hardware: {
            stands: {
                PROD: cell(6_000_000 / 12),
                DEV: cell(100_000_000 / 12)
            }
        },
        zeroSecurity: {
            stands: {
                PROD: cell(0)
            }
        },
        traffic: {
            stands: {
                PROD: cell(1_000)
            }
        },
        servicesTie: {
            stands: {
                PROD: cell(1_000)
            }
        }
    }
};

describe('Details: порядок групп ЭК по ИТОГО / год', () => {
    it('сортирует группы по убыванию годовой суммы на активных стендах', () => {
        const byCat = {
            LICENSE: [{ id: 'licenseDb' }],
            SERVICES: [{ id: 'servicesOps' }],
            HW: [{ id: 'hardware' }],
            SECURITY: [{ id: 'zeroSecurity' }]
        };

        assert.deepEqual(
            buildDetailsCategoryOrder(byCat, result, ['DEV']),
            ['LICENSE', 'SERVICES', 'HW', 'SECURITY']
        );
    });

    it('сумма группы для сортировки совпадает с «ИТОГО / год» и исключает disabled-стенды', () => {
        const annual = detailsCategoryAnnualOnActiveStands(
            [{ id: 'hardware' }],
            result,
            ['DEV']
        );

        assert.equal(annual, 6_000_000);
    });

    it('при равной сумме сохраняет канонический порядок категорий как tie-break', () => {
        const byCat = {
            SERVICES: [{ id: 'servicesTie' }],
            TRAFFIC: [{ id: 'traffic' }]
        };

        assert.deepEqual(
            buildDetailsCategoryOrder(byCat, result, []),
            ['TRAFFIC', 'SERVICES']
        );
    });
});
