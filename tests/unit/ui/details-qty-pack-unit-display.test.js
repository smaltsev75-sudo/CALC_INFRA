/**
 * Details qty: пакетные единицы не должны выглядеть как смешанные числа.
 *
 * Регрессия из UI: строки уведомлений показывали `16 1000 SMS` и
 * `465 1000 писем`. Это было корректно математически (qty в пакетах),
 * но визуально выглядело как склейка двух разных значений.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SEED_ITEMS } from '../../../js/domain/seed.js';
import {
    formatQtyDisplayParts,
    formatQtyDisplayUnit
} from '../../../js/ui/detailsSections.js';

describe('Details qty: пакетные единицы уведомлений', () => {
    it('legacy unit с ведущим множителем нормализуется для UI', () => {
        assert.deepEqual(formatQtyDisplayParts(16, '1000 SMS'), {
            valueText: '16',
            unitText: 'тыс. SMS'
        });
        assert.deepEqual(formatQtyDisplayParts(465, '1000 писем'), {
            valueText: '465',
            unitText: 'тыс. писем'
        });
        assert.deepEqual(formatQtyDisplayParts(5, '1 млн PUSH'), {
            valueText: '5',
            unitText: 'млн PUSH'
        });
    });

    it('seed хранит уведомления в человекочитаемых пакетных единицах', () => {
        const byId = new Map(SEED_ITEMS.map(item => [item.id, item]));

        assert.equal(byId.get('service-sms-per-1k')?.unit, 'тыс. SMS');
        assert.equal(byId.get('service-email-per-1k')?.unit, 'тыс. писем');
        assert.equal(byId.get('service-push-per-1m')?.unit, 'млн PUSH');

        for (const id of ['service-sms-per-1k', 'service-email-per-1k', 'service-push-per-1m']) {
            const unit = byId.get(id)?.unit || '';
            assert.doesNotMatch(unit, /^(?:1000|1\s+млн)\s+/);
            assert.equal(formatQtyDisplayUnit(unit), unit);
        }
    });
});
